"""Immutable versioned input bundles and reproducible research runs in PostgreSQL.

JSONB retains the complete provider master/action/membership history atomically;
source hashes and run parameters make each calculation reproducible.
"""

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    URL,
    create_engine,
    String,
    DateTime,
    JSON,
    ForeignKey,
    select,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from .schema import Bundle


class Base(DeclarativeBase):
    pass


class Dataset(Base):
    __tablename__ = "structure_datasets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    manifest: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))


class Run(Base):
    __tablename__ = "structure_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("structure_datasets.id"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))
    state: Mapped[str] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    request: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))
    result: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Store:
    def __init__(self, url=None):
        if url is None:
            url = os.getenv("SCANNER_DATABASE_URL")
            if not url and os.getenv("SCANNER_DATABASE_HOST"):
                url = URL.create(
                    "postgresql+psycopg",
                    username=os.getenv("SCANNER_DATABASE_USER", "postgres"),
                    password=os.getenv("SCANNER_DATABASE_PASSWORD"),
                    host=os.getenv("SCANNER_DATABASE_HOST"),
                    port=int(os.getenv("SCANNER_DATABASE_PORT", "5432")),
                    database=os.getenv("SCANNER_DATABASE_NAME", "structure"),
                )
            url = url or "sqlite:////tmp/tickr-structure-dev.sqlite3"
        self.engine = create_engine(
            url,
            connect_args=(
                {"check_same_thread": False} if str(url).startswith("sqlite") else {}
            ),
            pool_pre_ping=True,
        )
        self.session = sessionmaker(self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)

    def storage_bytes(self):
        with self.session() as db:
            if self.engine.dialect.name == "postgresql":
                return int(
                    db.scalar(select(func.pg_database_size(func.current_database())))
                )
            total = sum(
                len(json.dumps(d.payload).encode()) for d in db.scalars(select(Dataset))
            )
            return total + sum(
                len(json.dumps(r.result).encode())
                for r in db.scalars(select(Run))
                if r.result
            )

    def check_storage_budget(self, additional_bytes=0):
        limit = int(os.getenv("SCANNER_STORAGE_LIMIT_BYTES", "100000000"))
        if not 1_000_000 <= limit <= 500_000_000:
            raise ValueError(
                "SCANNER_STORAGE_LIMIT_BYTES must be between 1 MB and 500 MB"
            )
        if self.storage_bytes() + additional_bytes >= limit:
            raise ValueError(
                "Private database budget reached; operation paused. No automatic upgrade or paid fallback."
            )

    def save(self, bundle):
        payload = bundle.model_dump(mode="json")
        identity = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        with self.session() as db:
            if db.get(Dataset, identity) is None:
                self.check_storage_budget(len(json.dumps(payload).encode()) * 2)
                db.add(
                    Dataset(id=identity, manifest=payload["manifest"], payload=payload)
                )
                db.commit()
        return identity

    def load(self, dataset_id):
        with self.session() as db:
            row = db.get(Dataset, dataset_id)
            if row is None:
                raise ValueError("Unknown dataset")
            return Bundle.model_validate(row.payload)

    def datasets(self):
        with self.session() as db:
            return [
                {
                    "id": d.id,
                    "manifest": d.manifest,
                    "created_at": d.created_at.isoformat(),
                }
                for d in db.scalars(select(Dataset).order_by(Dataset.created_at.desc()))
            ]

    def create_run(self, dataset_id, kind, request):
        self.check_storage_budget()
        self.load(dataset_id)
        with self.session() as db:
            active = db.scalars(
                select(Run).where(Run.state.in_(["queued", "running"]))
            ).all()
            if len(active) >= 2:
                raise ValueError("Two research jobs are already queued or running")
            identity = str(uuid.uuid4())
            db.add(
                Run(
                    id=identity,
                    dataset_id=dataset_id,
                    kind=kind,
                    state="queued",
                    request=request,
                )
            )
            db.commit()
            return identity

    def update(self, run_id, **values):
        if values.get("result") is not None:
            self.check_storage_budget(len(json.dumps(values["result"]).encode()) * 2)
        with self.session() as db:
            run = db.get(Run, run_id)
            for key, value in values.items():
                setattr(run, key, value)
            db.commit()

    def get_run(self, run_id):
        with self.session() as db:
            r = db.get(Run, run_id)
            if r is None:
                raise ValueError("Unknown run")
            return {
                "id": r.id,
                "dataset_id": r.dataset_id,
                "kind": r.kind,
                "state": r.state,
                "request": r.request,
                "result": r.result,
                "error": r.error,
                "created_at": r.created_at.isoformat(),
            }
