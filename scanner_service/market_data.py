"""Zero-cost, private EOD file ingestion. Never changes the structure algorithm.

Network ingestion is opt-in, restricted to official archive hosts, and requires
an explicit operator record of verified free personal-use permission. No broker,
paid fallback, authentication, scraping bypass or public-data publishing exists.
"""

import csv
import hashlib
import io
import json
import os
import zipfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from pydantic import Field, model_validator
from sqlalchemy import String, JSON, select, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .schema import Bundle, Model, Security, Bar, IndexBar
from .storage import Base, Dataset, Run

JSON_DATA = JSON().with_variant(JSONB, "postgresql")
MAX_FILE = 50_000_000
OFFICIAL_HOSTS = {
    "nse": {"nsearchives.nseindia.com"},
    "bse": {"www.bseindia.com"},
    "indices": {"www.niftyindices.com"},
}


class Permission(Model):
    provider: Literal["nse", "bse", "indices", "manual"]
    reference: str = Field(min_length=8, max_length=500)
    verified_on: date
    free_personal_use_confirmed: Literal[True]
    zero_cost_confirmed: Literal[True]
    redistribution_permitted: Literal[False] = False
    network_download_permitted: bool = False
    written_automation_permission_reference: str | None = Field(
        default=None, min_length=8, max_length=500
    )
    daily_request_limit: int = Field(default=0, ge=0, le=1000)
    daily_download_bytes: int = Field(default=0, ge=0, le=100_000_000)

    @model_validator(mode="after")
    def verified(self):
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        if not 0 <= (today - self.verified_on).days <= 90:
            raise ValueError("Permission verification must be within the last 90 days")
        if self.network_download_permitted and (
            self.provider == "manual"
            or not self.daily_request_limit
            or not self.daily_download_bytes
        ):
            raise ValueError(
                "Network access requires official host and verified free budgets"
            )
        if (
            self.provider == "indices"
            and self.network_download_permitted
            and not self.written_automation_permission_reference
        ):
            raise ValueError(
                "Nifty Indices terms require express written consent for automated collection; personal use alone is insufficient"
            )
        return self


class InputFile(Model):
    format: Literal[
        "nse-legacy", "nse-udiff", "bse-legacy", "bse-udiff", "bars", "indices"
    ]
    path: str | None = None
    url: str | None = None
    session: date | None = None
    index_id: str | None = None
    zip_member: str | None = None
    delivery_verified: bool = False

    @model_validator(mode="after")
    def location(self):
        if bool(self.path) == bool(self.url):
            raise ValueError("Supply exactly one private path or official URL")
        if self.url and not self.session:
            raise ValueError(
                "Remote inputs require an explicit finalized exchange session"
            )
        return self


class UpdateConfig(Model):
    feed_id: str = Field(pattern=r"^[a-z0-9_-]{1,60}$")
    permission: Permission
    # Metadata-only Bundle: sessions, PIT master, actions and constituents supplied
    # by operator. Never derive a historical universe from today's symbol list.
    metadata: dict
    files: list[InputFile] = Field(min_length=1, max_length=3000)
    storage_limit_bytes: int = Field(default=100_000_000, ge=1_000_000, le=500_000_000)


class Feed(Base):
    __tablename__ = "structure_market_feeds"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    dataset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    permission: Mapped[dict] = mapped_column(JSON_DATA)
    last_success_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)


class ImportRecord(Base):
    __tablename__ = "structure_market_imports"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    feed_id: Mapped[str] = mapped_column(String(60), index=True)
    created_at: Mapped[str] = mapped_column(String(40))
    detail: Mapped[dict] = mapped_column(JSON_DATA)


class Usage(Base):
    __tablename__ = "structure_market_usage"
    id: Mapped[str] = mapped_column(String(90), primary_key=True)
    requests: Mapped[int] = mapped_column(default=0)
    bytes: Mapped[int] = mapped_column(default=0)
    paused: Mapped[bool] = mapped_column(default=False)


class ImportAttempt(Base):
    __tablename__ = "structure_market_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    feed_id: Mapped[str] = mapped_column(String(60), index=True)
    created_at: Mapped[str] = mapped_column(String(40))
    state: Mapped[str] = mapped_column(String(20))
    detail: Mapped[str] = mapped_column(String(300))


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode()


def iso_day(value):
    for form in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(value.strip(), form).date()
        except ValueError:
            pass
    raise ValueError("Unrecognized session date; ambiguous dates are not guessed")


def unpack(raw, member=None):
    if len(raw) > MAX_FILE:
        raise ValueError("Input exceeds 50 MB private import limit")
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = [
                x for x in archive.infolist() if x.filename.lower().endswith(".csv")
            ]
            if member:
                entries = [x for x in entries if x.filename == member]
            if len(entries) != 1 or entries[0].file_size > MAX_FILE:
                raise ValueError("ZIP needs one bounded CSV, or explicit zip_member")
            raw = archive.read(entries[0])  # no extraction / path traversal
    return raw.decode("utf-8-sig")


def parse_file(raw, spec, securities):
    master = {}
    for item in securities:
        security = Security.model_validate(item)
        master.setdefault(security.listing_id, []).append(security)
    bars, indices, skipped = [], [], 0
    reader = csv.DictReader(io.StringIO(unpack(raw, spec.zip_member)))
    if not reader.fieldnames:
        raise ValueError("Empty CSV")
    for line, original in enumerate(reader, 2):
        row = {
            key.strip().upper(): (value or "").strip()
            for key, value in original.items()
            if key
        }

        def get(*keys):
            return next((row[k] for k in keys if row.get(k)), "")

        try:
            stamp = get("DATE", "TIMESTAMP", "TRADDT", "TRADE_DATE")
            day = iso_day(stamp) if stamp else spec.session
            if not day:
                raise ValueError("CSV date or explicit session is required")
            if spec.session and day != spec.session:
                raise ValueError(
                    "Row date differs from declared daily artifact session"
                )
            if spec.format == "indices":
                identifier = spec.index_id or get("INDEX_ID")
                if not identifier:
                    raise ValueError("Explicit canonical index_id required")
                indices.append(
                    IndexBar(
                        index_id=identifier,
                        date=day,
                        close=get("CLOSE", "CLOSING INDEX VALUE", "CLSINDXVAL"),
                    ).model_dump(mode="json")
                )
                continue
            if spec.format == "bars":
                listing = get("LISTING_ID")
                vol = get("VOLUME")
            elif spec.format.endswith("udiff"):
                exchange = "NSE" if spec.format.startswith("nse") else "BSE"
                if get("SGMT") != "CM" or get("FININSTRMTP") != "STK":
                    skipped += 1
                    continue
                if exchange == "NSE" and get("SCTYSRS") != "EQ":
                    skipped += 1
                    continue
                listing = (
                    exchange
                    + ":"
                    + get("TCKRSYMB" if exchange == "NSE" else "FININSTRMID")
                )
                vol = get("TTLTRADGVOL")
            elif spec.format == "nse-legacy":
                if get("SERIES") != "EQ":
                    skipped += 1
                    continue
                listing, vol = "NSE:" + get("SYMBOL"), get("TOTTRDQTY")
            else:
                listing, vol = "BSE:" + get("SC_CODE"), get("NO_OF_SHRS")
            versions = master.get(listing, [])
            selected = next(
                (
                    s
                    for s in versions
                    if s.valid_from <= day and (not s.valid_to or day < s.valid_to)
                ),
                None,
            )
            if not selected or selected.instrument_type != "EQUITY":
                skipped += 1
                continue
            if get("ISIN") and get("ISIN") != selected.isin:
                raise ValueError("ISIN differs from point-in-time security master")
            delivery = get("DELIV_PER", "DELIVERY_PCT")
            bars.append(
                Bar(
                    listing_id=listing,
                    date=day,
                    open=get("OPEN", "OPNPRIC"),
                    high=get("HIGH", "HGHPRIC"),
                    low=get("LOW", "LWPRIC"),
                    close=get("CLOSE", "CLSPRIC"),
                    volume=vol,
                    is_final=True,
                    delivery_pct=None if delivery in ("", "-") else delivery,
                    delivery_verified=bool(
                        spec.delivery_verified and delivery not in ("", "-")
                    ),
                ).model_dump(mode="json")
            )
        except (ValueError, TypeError) as error:
            # Do not log potentially sensitive raw row values or file paths.
            raise ValueError(
                f"Invalid {spec.format} CSV at row {line}: {type(error).__name__}"
            ) from error
    if not bars and not indices:
        raise ValueError(
            "No supported tracked equity/index rows; check schema and master"
        )
    return bars, indices, skipped


def union_records(old, new, keys):
    result = {tuple(row[k] for k in keys): row for row in old}
    for row in new:
        key = tuple(row[k] for k in keys)
        if key in result and result[key] != row:
            raise ValueError(
                "Conflicting historical record; explicit reviewed source revision required"
            )
        result[key] = row
    return list(result.values())


def merge_bundle(previous, metadata, bars, index_bars):
    if metadata.get("bars") or metadata.get("index_bars"):
        raise ValueError(
            "Metadata must not embed candles; use declared source artifacts"
        )
    payload = dict(metadata)
    if previous:
        if previous.manifest.kind == "sample":
            raise ValueError("Real feed cannot extend a synthetic dataset")
        old = previous.model_dump(mode="json")
        for field, keys in {
            "securities": ("listing_id", "valid_from"),
            "actions": ("listing_id", "effective_on", "kind", "reference"),
            "benchmarks": ("index_id",),
            "memberships": ("index_id", "security_id", "valid_from"),
            "fundamentals": ("security_id", "period_end", "known_on"),
            "terminals": ("listing_id",),
        }.items():
            payload[field] = union_records(
                old.get(field, []), metadata.get(field, []), keys
            )
        if not set(old["sessions"]).issubset(metadata["sessions"]):
            raise ValueError(
                "Incremental calendar cannot drop previously declared sessions"
            )
        if (
            metadata["manifest"]["latest_complete_session"]
            < old["manifest"]["latest_complete_session"]
        ):
            raise ValueError("Incremental watermark cannot move backwards")
        bars = old["bars"] + bars
        index_bars = old["index_bars"] + index_bars
    payload["bars"] = union_records([], bars, ("listing_id", "date"))
    payload["index_bars"] = union_records([], index_bars, ("index_id", "date"))
    if payload["manifest"]["kind"] != "licensed":
        raise ValueError(
            "Real feeds require kind=licensed (permission may be free); samples stay separate"
        )
    result = Bundle.model_validate(payload)
    if any(b.date > result.manifest.latest_complete_session for b in result.index_bars):
        raise ValueError("Index bars cannot extend past finalized EOD watermark")
    return result


class MarketData:
    def __init__(self, store, cache=None):
        self.store = store
        self.cache = Path(
            cache or os.getenv("SCANNER_MARKET_CACHE", ".scanner-private/cache")
        )
        Base.metadata.create_all(store.engine)

    def storage_bytes(self):
        return self.store.storage_bytes()

    def statuses(self):
        with self.store.session() as db:
            feeds = db.scalars(select(Feed)).all()
            reports = []
            for f in feeds:
                dataset = db.get(Dataset, f.dataset_id) if f.dataset_id else None
                manifest = dataset.manifest if dataset else None
                latest = manifest["latest_complete_session"] if manifest else None
                stale = (
                    not latest
                    or (
                        datetime.now(ZoneInfo("Asia/Kolkata")).date()
                        - date.fromisoformat(latest)
                    ).days
                    > 3
                )
                reports.append(
                    {
                        "feed_id": f.id,
                        "dataset_id": f.dataset_id,
                        "source": manifest["source"] if manifest else None,
                        "last_success_at": f.last_success_at,
                        "latest_complete_session": latest,
                        "stale": stale,
                        "last_error": f.last_error,
                        "permission": f.permission,
                        "usage_today": self._usage(db, f.id),
                        "recent_attempts": [
                            {
                                "created_at": a.created_at,
                                "state": a.state,
                                "detail": a.detail,
                            }
                            for a in db.scalars(
                                select(ImportAttempt)
                                .where(ImportAttempt.feed_id == f.id)
                                .order_by(ImportAttempt.created_at.desc())
                                .limit(10)
                            )
                        ],
                        "warning": "Staleness uses calendar days; inspect the supplied exchange calendar and missing candles, especially long holidays.",
                    }
                )
            return {
                "feeds": reports,
                "storage_bytes": self.storage_bytes(),
                "paid_fallback": False,
                "scheduler": "Manual/offline by default; no hosted scheduler provisioned",
            }

    def _usage(self, db, feed):
        day = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
        u = db.get(Usage, f"{feed}:{day}")
        return {
            "requests": u.requests if u else 0,
            "bytes": u.bytes if u else 0,
            "paused": u.paused if u else False,
        }

    def _download(self, config, spec):
        permission = config.permission
        parsed = urlsplit(spec.url)
        if (
            not permission.network_download_permitted
            or parsed.scheme != "https"
            or parsed.hostname not in OFFICIAL_HOSTS.get(permission.provider, set())
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or parsed.fragment
            or parsed.query
        ):
            raise ValueError(
                "Download requires approved official HTTPS archive URL without credentials/query"
            )
        if spec.session not in [
            date.fromisoformat(d) for d in config.metadata["sessions"]
        ]:
            raise ValueError(
                "Remote artifact session must be in the supplied exchange calendar"
            )
        if str(spec.session) > config.metadata["manifest"]["latest_complete_session"]:
            raise ValueError("Cannot request unfinalized future artifact")
        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        if spec.session > now.date() or (spec.session == now.date() and now.hour < 16):
            raise ValueError(
                "Archive updates must run after 16:00 IST on a finalized session"
            )
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        cache_file = self.cache / hashlib.sha256(spec.url.encode()).hexdigest()
        if cache_file.exists():
            if cache_file.stat().st_size > MAX_FILE:
                raise ValueError("Cached input exceeds private file limit")
            return cache_file.read_bytes()
        cache_bytes = sum(p.stat().st_size for p in self.cache.iterdir() if p.is_file())
        if (
            self.storage_bytes() + cache_bytes + permission.daily_download_bytes
            > config.storage_limit_bytes
        ):
            raise ValueError("Private database/cache budget reached; download paused")
        day = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
        key = f"{config.feed_id}:{day}"
        # Reserve before sending; failed/limited requests count too. Serialize by DB row.
        with self.store.session() as db:
            usage = db.scalar(select(Usage).where(Usage.id == key).with_for_update())
            if usage is None:
                usage = Usage(id=key, requests=0, bytes=0, paused=False)
                db.add(usage)
            if (
                usage.paused
                or usage.requests >= permission.daily_request_limit
                or usage.bytes >= permission.daily_download_bytes
            ):
                raise ValueError(
                    "Free request/download quota exhausted; operation paused until next IST day"
                )
            usage.requests += 1
            remaining = min(MAX_FILE, permission.daily_download_bytes - usage.bytes)
            db.commit()
        body = bytearray()
        try:
            with httpx.stream(
                "GET", spec.url, timeout=30, follow_redirects=False
            ) as response:
                if response.status_code != 200:
                    raise ValueError(
                        f"Provider returned HTTP {response.status_code}; no retries or fallback"
                    )
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > remaining:
                        raise ValueError(
                            "Free download byte limit reached; operation paused"
                        )
            # Validate archive/text before caching; malformed data is not a successful download.
            unpack(body, spec.zip_member)
            descriptor = os.open(
                cache_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            with os.fdopen(descriptor, "wb") as file:
                file.write(body)
        except Exception:
            with self.store.session() as db:
                usage = db.get(Usage, key)
                usage.bytes += len(body)
                usage.paused = True
                db.commit()
            raise
        with self.store.session() as db:
            usage = db.get(Usage, key)
            usage.bytes += len(body)
            db.commit()
        return bytes(body)

    def update(self, config):
        config = UpdateConfig.model_validate(config)
        with self.store.session() as db:
            feed = db.get(Feed, config.feed_id)
            if feed is None:
                feed = Feed(
                    id=config.feed_id,
                    permission=config.permission.model_dump(mode="json"),
                )
                db.add(feed)
            db.commit()
            previous_id = feed.dataset_id
            previous_permission = feed.permission
        try:
            if previous_id and any(
                previous_permission.get(k)
                != config.permission.model_dump(mode="json").get(k)
                for k in ("provider", "reference")
            ):
                raise ValueError(
                    "Changing data-source permission requires a reviewed new feed version"
                )
            if self.storage_bytes() >= config.storage_limit_bytes:
                raise ValueError(
                    "Private database budget reached; import paused, no upgrade"
                )
            previous = self.store.load(previous_id) if previous_id else None
            metadata = config.metadata
            if (
                metadata.get("manifest", {}).get("license_reference")
                != config.permission.reference
            ):
                raise ValueError(
                    "Manifest permission reference must match verified free-use policy"
                )
            securities = union_records(
                previous.model_dump(mode="json")["securities"] if previous else [],
                metadata["securities"],
                ("listing_id", "valid_from"),
            )
            master_hash = hashlib.sha256(canonical(securities)).hexdigest()
            bars, indices, artifacts, skipped = [], [], [], 0
            for spec in config.files:
                if spec.path and Path(spec.path).stat().st_size > MAX_FILE:
                    raise ValueError("Input exceeds 50 MB private import limit")
                raw = (
                    self._download(config, spec)
                    if spec.url
                    else Path(spec.path).read_bytes()
                )
                digest = hashlib.sha256(raw).hexdigest()
                artifact_id = hashlib.sha256(
                    canonical(
                        {
                            "feed": config.feed_id,
                            "sha256": digest,
                            "master_sha256": master_hash,
                            "parser": spec.model_dump(
                                mode="json", exclude={"path", "url"}
                            ),
                        }
                    )
                ).hexdigest()
                with self.store.session() as db:
                    if db.get(ImportRecord, artifact_id):
                        continue
                parsed_bars, parsed_indices, ignored = parse_file(raw, spec, securities)
                bars.extend(parsed_bars)
                indices.extend(parsed_indices)
                skipped += ignored
                artifacts.append(
                    {
                        "id": artifact_id,
                        "sha256": digest,
                        "source": spec.url or Path(spec.path).name,
                        "format": spec.format,
                        "rows": len(parsed_bars) + len(parsed_indices),
                        "ignored": ignored,
                        "session": str(spec.session) if spec.session else None,
                    }
                )
            bundle = merge_bundle(previous, metadata, bars, indices)
            payload = bundle.model_dump(mode="json")
            identity = hashlib.sha256(canonical(payload)).hexdigest()
            with self.store.session() as db:
                exists = db.get(Dataset, identity) is not None
            # Full immutable input versions are retained deliberately for old run reproduction.
            if (
                not exists
                and self.storage_bytes() + len(canonical(payload)) * 2
                > config.storage_limit_bytes
            ):
                raise ValueError(
                    "New immutable snapshot would exceed database budget; paused, no upgrade"
                )
            if not exists:
                self.store.check_storage_budget(len(canonical(payload)) * 2)
            with self.store.session() as db:
                feed = db.scalar(
                    select(Feed).where(Feed.id == config.feed_id).with_for_update()
                )
                if feed.dataset_id != previous_id:
                    raise ValueError(
                        "Concurrent update detected; retry against latest committed dataset"
                    )
                if not exists:
                    db.add(
                        Dataset(
                            id=identity, manifest=payload["manifest"], payload=payload
                        )
                    )
                stamp = datetime.now(timezone.utc).isoformat()
                for artifact in artifacts:
                    db.add(
                        ImportRecord(
                            id=artifact["id"],
                            feed_id=config.feed_id,
                            created_at=stamp,
                            detail=artifact,
                        )
                    )
                feed.dataset_id, feed.last_success_at, feed.last_error = (
                    identity,
                    stamp,
                    None,
                )
                feed.permission = config.permission.model_dump(mode="json")
                db.add(
                    ImportAttempt(
                        id=str(uuid.uuid4()),
                        feed_id=config.feed_id,
                        created_at=stamp,
                        state="complete",
                        detail=f"Dataset {identity}; {len(artifacts)} new artifacts",
                    )
                )
                db.commit()
            return {
                "dataset_id": identity,
                "new_artifacts": len(artifacts),
                "new_candles": len(bundle.bars)
                - (len(previous.bars) if previous else 0),
                "new_index_candles": len(bundle.index_bars)
                - (len(previous.index_bars) if previous else 0),
                "ignored_untracked_or_non_equity_rows": skipped,
                "last_success_at": stamp,
                "notice": "Private real-data import, source permission operator-verified. No redistribution; no invented actions or memberships.",
            }
        except Exception as error:
            with self.store.session() as db:
                feed = db.get(Feed, config.feed_id)
                feed.last_error = (
                    str(error)[:250]
                    if isinstance(error, ValueError)
                    else f"Import failed: {type(error).__name__}; inspect local input/configuration"
                )
                db.add(
                    ImportAttempt(
                        id=str(uuid.uuid4()),
                        feed_id=config.feed_id,
                        created_at=datetime.now(timezone.utc).isoformat(),
                        state="failed",
                        detail=feed.last_error,
                    )
                )
                db.commit()
            raise
