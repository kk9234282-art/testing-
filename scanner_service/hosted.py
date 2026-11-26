"""Hosted-only adapter: protected daily batch, no paid services or data promotion."""

import hmac
import os
import re
import time
from datetime import date, datetime, timezone
from sqlalchemy import String, JSON, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.engine import make_url
from fastapi import Header, HTTPException
from .storage import Base
from .tejhq import Client, capture_raw, TERMS
from .worker import run_pending


class DailyBatch(Base):
    __tablename__ = "structure_daily_batches"
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    state: Mapped[str] = mapped_column(String(20))
    summary: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))


def validate_hosted_settings():
    if os.getenv("SCANNER_JOB_MODE") != "external":
        raise ValueError("Hosted deployment requires SCANNER_JOB_MODE=external")
    try:
        url = make_url(os.environ["SCANNER_DATABASE_URL"])
        if url.drivername != "postgresql+psycopg" or not url.host or not url.username or not url.password:
            raise ValueError()
        if url.query.get("sslmode") not in ("require", "verify-ca", "verify-full"):
            raise ValueError()
    except Exception:
        raise ValueError("Set a private postgresql+psycopg database URL with TLS enabled") from None
    admin = os.getenv("SCANNER_ADMIN_TOKEN", "")
    cron = os.getenv("CRON_SECRET", "")
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{24,200}", value) or value.startswith("replace-with") for value in (admin, cron)) or hmac.compare_digest(admin, cron):
        raise ValueError("Set different random SCANNER_ADMIN_TOKEN and CRON_SECRET values (24–200 URL-safe characters)")
    # A short-lived function may write only ephemeral private cache files.
    os.environ.setdefault("SCANNER_MARKET_CACHE", "/tmp/tickr-scanner-cache")


def capture_configuration():
    listings = [value.strip() for value in os.getenv("SCANNER_TEJHQ_RAW_LISTINGS", "").split(",") if value.strip()]
    if not listings:
        return None
    if len(listings) > 4 or len(set(listings)) != len(listings) or any(not re.fullmatch(r"(NSE|BSE):[A-Z0-9&_.!-]{1,40}", value) for value in listings) or any(value.split(":", 1)[1] in (".", "..") for value in listings):
        raise ValueError("Hosted MVP accepts up to four unique explicit raw listings")
    reviewed = date.fromisoformat(os.getenv("SCANNER_TEJHQ_TERMS_REVIEWED_ON", ""))
    age = (datetime.now(timezone.utc).date() - reviewed).days
    if not 0 <= age <= 90 or os.getenv("SCANNER_TEJHQ_PERMISSION_REFERENCE") != TERMS:
        raise ValueError("Record a current reviewed TejHQ permission reference before enabling raw capture")
    return listings, date.fromisoformat(os.getenv("SCANNER_TEJHQ_START_DATE", "2024-01-01"))


def daily_batch(store):
    """Reserve once per UTC day; errors/crashes never trigger an automatic replay."""
    started = time.monotonic()
    day = datetime.now(timezone.utc).date().isoformat()
    # Check optional configuration before reserving a day or contacting a provider.
    capture = capture_configuration()
    store.check_storage_budget(10_000)
    with store.session() as db:
        db.add(DailyBatch(day=day, state="running", summary={}))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return {"day": day, "state": "already_reserved", "replayed": False}
    try:
        summary = {"raw_capture": "disabled", "research_promotion": False}
        if capture:
            result = capture_raw(Client(store), capture[0], capture[1])
            # Never return source prices, actions or publication payloads from cron.
            summary["raw_capture"] = {"capture_id": result["capture_id"], "listings": len(result["listings"])}
        remaining = 240 - int(time.monotonic() - started)
        summary["worker"] = run_pending(store, max_jobs=2, start_budget_seconds=remaining) if remaining > 0 else {"processed": [], "notice": "No remaining start budget"}
        with store.session() as db:
            record = db.get(DailyBatch, day)
            record.state, record.summary = "complete", summary
            db.commit()
        return {"day": day, "state": "complete", **summary}
    except Exception:
        with store.session() as db:
            record = db.get(DailyBatch, day)
            record.state, record.summary = "failed", {"error": "Daily batch failed; inspect private service and quota status before operator recovery"}
            db.commit()
        raise


def latest_daily_status(store):
    with store.session() as db:
        record = db.scalar(select(DailyBatch).order_by(DailyBatch.day.desc()).limit(1))
        if record is None:
            return None
        return {"day": record.day, "state": record.state,
                "processed_jobs": record.summary.get("worker", {}).get("processed", []),
                "research_promotion": False}


def attach_daily_route(app, store, cron_secret):
    app.state.daily_status = lambda: latest_daily_status(store)
    @app.get("/api/structure/internal/eod")
    def eod(authorization: str = Header(default="")):
        if not cron_secret:
            raise HTTPException(503, "Configure the private daily-job secret")
        if not hmac.compare_digest(authorization.encode(), f"Bearer {cron_secret}".encode()):
            raise HTTPException(401, "Invalid daily-job token")
        try:
            return daily_batch(store)
        except Exception:
            raise HTTPException(503, "Daily batch unavailable; no paid fallback or synthetic results") from None
    return app


def create_hosted_app():
    validate_hosted_settings()
    # Import only after checking settings: never create a hosted SQLite fallback.
    from .app import app
    if app.state.job_mode != "external":
        raise ValueError("The hosted API must start in external mode")
    return attach_daily_route(app, app.state.store, os.environ["CRON_SECRET"])
