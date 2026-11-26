"""Private keyless TejHQ fetcher. Only documented free read endpoints are allowed.

No API-key, email, billing, authentication or paid-plan support is present.
Conversion uses the existing raw CSV importer and an operator-reviewed master,
calendar and action metadata; it never invents them from observed stock bars.
"""

import argparse
import hashlib
import json
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urlencode

import httpx
from pydantic import Field
from sqlalchemy import String, Float, JSON, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .schema import Model, Security, Bar
from .storage import Base, Store
from .market_data import Feed, Usage, MarketData, Permission

ORIGIN = "https://api.tejhq.dev"
TERMS = "https://tejhq.dev/data-terms"
MAX_RESPONSE = 10_000_000


class TejCall(Base):
    __tablename__ = "structure_tejhq_calls"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    attempted_at: Mapped[float] = mapped_column(Float, index=True)
    path: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30))


class Settings(Model):
    feed_id: str = Field(pattern=r"^[a-z0-9_-]{1,60}$")
    metadata_path: str
    # Operator-selected master records must be actual equities, not ETF guesses.
    listings: list[str] = Field(min_length=1, max_length=50)
    daily_request_limit: int = Field(default=40, ge=1, le=400)
    daily_download_bytes: int = Field(default=25_000_000, ge=1000, le=100_000_000)
    permission_verified_on: date
    terms_reference: str = TERMS


def write_private(path, payload):
    path = Path(path)
    root = Path(__file__).resolve().parents[1]
    destination = path.resolve()
    for public in (root / "public", root / "dist"):
        if destination == public or public in destination.parents:
            raise ValueError("Real provider data cannot be written to public/ or dist/")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + str(uuid.uuid4()) + ".tmp")
    try:
        with os.fdopen(
            os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w"
        ) as stream:
            json.dump(payload, stream, sort_keys=True, allow_nan=False)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Client:
    def __init__(self, store, cache=None, daily_limit=40, byte_limit=25_000_000):
        if not 1 <= daily_limit <= 400 or not 1000 <= byte_limit <= 100_000_000:
            raise ValueError("Invalid conservative free-request budget")
        self.store, self.daily_limit, self.byte_limit = store, daily_limit, byte_limit
        default_cache = (
            Path(os.getenv("SCANNER_MARKET_CACHE", ".scanner-private/cache")) / "tejhq"
        )
        self.cache = Path(cache or os.getenv("SCANNER_TEJHQ_CACHE", str(default_cache)))
        Base.metadata.create_all(store.engine)

    @staticmethod
    def url(path, query=None):
        # Status and the three documented keyless data routes only.
        if not re.fullmatch(
            r"/v1/(?:status|ohlcv/(?:nse|bse)/[A-Z0-9&_.!-]{1,40}|snapshot/(?:nse|bse)|actions/[A-Z0-9&_.!-]{1,40})",
            path,
        ):
            raise ValueError("Only documented keyless TejHQ endpoints are allowed")
        if path.rsplit("/", 1)[-1] in (".", ".."):
            raise ValueError("Ticker cannot normalize into a different endpoint")
        query = query or {}
        allowed = (
            {"from", "to"}
            if "/ohlcv/" in path
            else {"date"} if "/snapshot/" in path else set()
        )
        if set(query) - allowed:
            raise ValueError("Unsupported keyless query parameter")
        for value in query.values():
            date.fromisoformat(str(value))
        from urllib.parse import quote

        return (
            ORIGIN
            + quote(path, safe="/!._-")
            + ("?" + urlencode(query) if query else "")
        )

    def _reserve(self, path):
        # Provider reset is 05:30 IST = midnight UTC, shared across all feeds.
        while True:
            now = time.time()
            key = (
                "tejhq-open:"
                + datetime.fromtimestamp(now, timezone.utc).date().isoformat()
            )
            with self.store.session() as db:
                row = db.get(Usage, key)
                if row is None:
                    db.add(Usage(id=key, requests=0, bytes=0, paused=False))
                    db.commit()
            with self.store.session() as db:
                usage = db.scalar(
                    select(Usage).where(Usage.id == key).with_for_update()
                )
                if (
                    usage.paused
                    or usage.requests >= self.daily_limit
                    or usage.bytes >= self.byte_limit
                ):
                    raise ValueError(
                        "TejHQ free allowance paused; next reset is 05:30 IST. No paid fallback."
                    )
                recent = list(
                    db.scalars(
                        select(TejCall)
                        .where(TejCall.attempted_at > now - 10.1)
                        .order_by(TejCall.attempted_at)
                    )
                )
                wait = max(0, recent[-1].attempted_at + 2.2 - now) if recent else 0
                if len(recent) >= 5:
                    wait = max(wait, recent[0].attempted_at + 10.1 - now)
                if not wait:
                    identifier = str(uuid.uuid4())
                    usage.requests += 1
                    remaining = min(MAX_RESPONSE, self.byte_limit - usage.bytes)
                    db.add(
                        TejCall(
                            id=identifier,
                            attempted_at=now,
                            path=path,
                            status="reserved",
                        )
                    )
                    db.commit()
                    return key, identifier, remaining
            # Local pacing only, never a retry of an HTTP request; no DB lock held.
            time.sleep(min(wait, 10.1))

    def get(self, path, query=None, cache_tag="immutable", ttl=None):
        url = self.url(path, query)
        identity = hashlib.sha256((url + "\n" + cache_tag).encode()).hexdigest()
        cache_file = self.cache / (identity + ".json")
        if cache_file.exists() and (
            ttl is None or time.time() - cache_file.stat().st_mtime < ttl
        ):
            cached = json.loads(cache_file.read_text())
            if cached["url"] != url:
                raise ValueError("Provider cache identity mismatch")
            return cached["payload"]
        size = (
            sum(p.stat().st_size for p in self.cache.glob("*.json"))
            if self.cache.exists()
            else 0
        )
        if size + MAX_RESPONSE > 100_000_000:
            raise ValueError(
                "TejHQ private cache budget reached; stopped without upgrading"
            )
        self.store.check_storage_budget()
        key, identifier, remaining = self._reserve(path)
        body = bytearray()
        status = "failed"
        try:
            with httpx.stream(
                "GET", url, timeout=30, follow_redirects=False
            ) as response:
                status = str(response.status_code)
                if response.status_code != 200:
                    raise ValueError(
                        f"TejHQ HTTP {response.status_code}; paused, no retry or paid fallback"
                    )
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > remaining:
                        raise ValueError("TejHQ free byte budget reached; stopped")
            payload = json.loads(body)
            if path == "/v1/status":
                date.fromisoformat(payload["trading_date"])
            elif not isinstance(payload.get("data"), list) or payload.get(
                "meta", {}
            ).get("count") != len(payload["data"]):
                raise ValueError(
                    "Unexpected TejHQ envelope/count; response not imported"
                )
            write_private(
                cache_file,
                {
                    "url": url,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "payload": payload,
                },
            )
            return payload
        except Exception:
            with self.store.session() as db:
                db.get(Usage, key).paused = True
                db.commit()
            raise
        finally:
            with self.store.session() as db:
                db.get(Usage, key).bytes += len(body)
                db.get(TejCall, identifier).status = status
                db.commit()

    def status(self):
        return self.get("/v1/status", cache_tag="status", ttl=1800)


def missing_spans(sessions, existing, start, end):
    """Only consecutive missing exchange-session blocks, never full-history refetch."""
    spans, opened, last = [], None, None
    for day in sessions:
        if not start <= day <= end:
            continue
        if day not in existing:
            opened = opened or day
            last = day
        elif opened:
            spans.append((opened, last))
            opened = last = None
    if opened:
        spans.append((opened, last))
    return spans


def sync(settings, store, client=None):
    import csv
    import io

    settings = Settings.model_validate(settings)
    if settings.terms_reference != TERMS:
        raise ValueError("Review the actual TejHQ personal-use terms before syncing")
    Permission(
        provider="tejhq",
        reference=TERMS,
        verified_on=settings.permission_verified_on,
        free_personal_use_confirmed=True,
        zero_cost_confirmed=True,
    )
    metadata = json.loads(Path(settings.metadata_path).read_text())
    if metadata.get("manifest", {}).get("source", "").lower().find("tejhq") < 0:
        raise ValueError("Source metadata must identify TejHQ")
    if metadata["manifest"]["license_reference"] != TERMS:
        raise ValueError("Manifest must record the actual data-terms reference")
    if (
        metadata["manifest"].get("kind") != "licensed"
        or metadata["manifest"].get("ohlcv_basis") != "raw"
    ):
        raise ValueError(
            "TejHQ sync requires real, raw-only metadata; no synthetic mixing"
        )
    client = client or Client(
        store,
        daily_limit=settings.daily_request_limit,
        byte_limit=settings.daily_download_bytes,
    )
    status = client.status()
    as_of = metadata["manifest"]["latest_complete_session"]
    if as_of > status["trading_date"]:
        raise ValueError("Requested finalized watermark exceeds provider freshness")
    with store.session() as db:
        previous = db.get(Feed, settings.feed_id)
        prior_id = previous.dataset_id if previous else None
    previous = store.load(prior_id) if prior_id else None
    master = [Security.model_validate(s) for s in metadata["securities"]]
    normalized, reviews = [], []
    for listing in settings.listings:
        versions = [
            s
            for s in master
            if s.listing_id == listing and s.instrument_type == "EQUITY"
        ]
        if not versions:
            raise ValueError(
                "Every requested listing needs a reviewed equity master record"
            )
        symbol = versions[-1].symbol
        exchange = versions[-1].exchange.lower()
        existing = (
            {str(b.date) for b in previous.bars if b.listing_id == listing}
            if previous
            else set()
        )
        sessions = [
            d
            for d in metadata["sessions"]
            if any(
                str(s.valid_from) <= d and (s.valid_to is None or d < str(s.valid_to))
                for s in versions
            )
        ]
        spans = missing_spans(
            sessions, existing, str(min(s.valid_from for s in versions)), as_of
        )
        for first, last in spans:
            response = client.get(
                f"/v1/ohlcv/{exchange}/{symbol}", {"from": first, "to": last}
            )
            for raw in response["data"]:
                day = raw["date"]
                if not first <= day <= last:
                    raise ValueError(
                        "Provider returned candles outside requested range"
                    )
                normalized.append(
                    Bar(
                        listing_id=listing,
                        date=day,
                        **{
                            k: raw[k]
                            for k in ("open", "high", "low", "close", "volume")
                        },
                        is_final=True,
                    ).model_dump(mode="json")
                )
        actions = client.get(
            f"/v1/actions/{symbol}", cache_tag="actions:" + status["trading_date"]
        )
        financial = [
            a
            for a in actions["data"]
            if a.get("exchange", "").lower() == exchange
            and a.get("type") != "agm"
            and metadata["sessions"][0] <= a["ex_date"] <= as_of
        ]
        # Ex dates do not prove announcement timestamps. Never fabricate known_on,
        # identity resolutions or factors; keep the full source audit privately.
        reviews.append(
            {
                "listing_id": listing,
                "financial_actions": financial,
                "publication_timestamps": "not supplied by documented source schema",
            }
        )
    folder = Path(settings.metadata_path).resolve().parent
    write_private(
        folder / "tejhq-action-review.json",
        {
            "source_status": status,
            "reviews": reviews,
            "notice": "Corporate actions require reviewed source factors and availability dates; not automatically applied.",
        },
    )
    missing_actions = [
        (r["listing_id"], a)
        for r in reviews
        for a in r["financial_actions"]
        if not any(
            x.get("listing_id") == r["listing_id"]
            and x.get("effective_on") == a["ex_date"]
            and x.get("kind") == a["type"]
            for x in metadata.get("actions", [])
        )
    ]
    if metadata["manifest"]["corporate_actions_complete"] and missing_actions:
        raise ValueError(
            "Source financial actions are missing from reviewed metadata; completeness attestation rejected"
        )
    # If no new bars, retain original input identity and still check metadata changes.
    if not normalized:
        if previous is None:
            raise ValueError("No price candles returned; no dataset created")
        one = previous.bars[0].model_dump(mode="json")
        normalized = [one]
    header = ["listing_id", "date", "open", "high", "low", "close", "volume"]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=header)
    writer.writeheader()
    writer.writerows({k: row[k] for k in header} for row in normalized)
    csv_path = folder / "tejhq-new-candles.csv"
    csv_path.write_text(stream.getvalue())
    csv_path.chmod(0o600)
    result = MarketData(store).update(
        {
            "feed_id": settings.feed_id,
            "permission": {
                "provider": "tejhq",
                "reference": TERMS,
                "verified_on": str(settings.permission_verified_on),
                "free_personal_use_confirmed": True,
                "zero_cost_confirmed": True,
                "network_download_permitted": False,
                "daily_request_limit": settings.daily_request_limit,
                "daily_download_bytes": settings.daily_download_bytes,
            },
            "metadata": metadata,
            "files": [{"format": "bars", "path": str(csv_path)}],
        }
    )
    return {
        **result,
        "provider_status": status,
        "unreviewed_financial_actions": len(missing_actions),
        "actions_applied_automatically": False,
        "warning": "Actual provider prices; corporate actions/universe/index completeness must be reviewed before validating signals or backtests.",
    }


def main():
    parser = argparse.ArgumentParser(
        description="Private zero-cost TejHQ keyless sync; no paid endpoints"
    )
    parser.add_argument(
        "config",
        nargs="?",
        help="Private JSON settings with reviewed metadata/calendar",
    )
    parser.add_argument(
        "--capture",
        nargs="+",
        metavar="EXCHANGE:SYMBOL",
        help="Import raw prices into quarantine without inventing research metadata",
    )
    parser.add_argument(
        "--from-date", type=date.fromisoformat, default=date(2024, 1, 1)
    )
    parser.add_argument("--output", help="Private capture report JSON")
    args = parser.parse_args()
    if args.capture:
        result = capture_raw(Client(Store()), args.capture, args.from_date)
    elif args.config:
        result = sync(json.loads(Path(args.config).read_text()), Store())
    else:
        parser.error("Supply a reviewed sync config or --capture listings")
    if args.output:
        write_private(args.output, result)
        print("Private provider report written")
    else:
        print(json.dumps(result, indent=2, allow_nan=False))


class RawCandle(Base):
    """Quarantine actual prices until master/calendar/action metadata is reviewed."""

    __tablename__ = "structure_tejhq_raw_candles"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    listing_id: Mapped[str] = mapped_column(String(60), index=True)
    session: Mapped[str] = mapped_column(String(10), index=True)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))


class Capture(Base):
    __tablename__ = "structure_tejhq_captures"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"))


def capture_raw(client, listings, start=date(2024, 1, 1)):
    """Raw-source import, explicitly not an approved research Bundle.

    No backward-dated master intervals, exchange calendar or action knowledge
    timestamps are manufactured to make a strict Bundle validate.
    """
    if not 1 <= len(listings) <= 50 or any(
        not re.fullmatch(r"(NSE|BSE):[A-Z0-9&_.!-]{1,40}", listing)
        for listing in listings
    ):
        raise ValueError("Supply 1–50 explicit valid exchange listings")
    status = client.status()
    latest = date.fromisoformat(status["trading_date"])
    india_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    if latest > india_now.date() or (
        latest == india_now.date() and india_now.hour < 16
    ):
        raise ValueError("Wait for finalized source data after market close")
    result = {
        "state": "raw_staging_only",
        "source": "TejHQ keyless API",
        "terms": TERMS,
        "provider_status": status,
        "listings": [],
        "warning": "Actual prices, not synthetic. Research promotion withheld until calendar, historical identities and corporate-action availability are reviewed. No structure dates or returns certified.",
    }
    for listing in listings:
        if not re.fullmatch(r"(NSE|BSE):[A-Z0-9&_.!-]{1,40}", listing):
            raise ValueError("Invalid explicit exchange listing")
        exchange, symbol = listing.split(":", 1)
        with client.store.session() as db:
            old = list(
                db.scalars(
                    select(RawCandle)
                    .where(RawCandle.listing_id == listing)
                    .order_by(RawCandle.session)
                )
            )
        first = (
            max(start, date.fromisoformat(old[-1].session) + timedelta(days=1))
            if old
            else start
        )
        rows = []
        if first <= latest:
            response = client.get(
                f"/v1/ohlcv/{exchange.lower()}/{symbol}",
                {"from": str(first), "to": str(latest)},
            )
            for raw in response["data"]:
                bar = Bar(
                    listing_id=listing,
                    date=raw["date"],
                    **{k: raw[k] for k in ("open", "high", "low", "close", "volume")},
                    is_final=True,
                )
                if not first <= bar.date <= latest:
                    raise ValueError("Out-of-range raw source bar")
                rows.append(bar.model_dump(mode="json"))
        actions = client.get(
            f"/v1/actions/{symbol}", cache_tag="actions:" + str(latest)
        )["data"]
        client.store.check_storage_budget(sum(len(json.dumps(r)) for r in rows) * 3)
        with client.store.session() as db:
            for row in rows:
                key = listing + ":" + row["date"]
                previous = db.get(RawCandle, key)
                if previous is not None and previous.payload != row:
                    raise ValueError(
                        "Conflicting raw candle; source revision needs review"
                    )
                if previous is None:
                    db.add(
                        RawCandle(
                            id=key, listing_id=listing, session=row["date"], payload=row
                        )
                    )
            db.commit()
            stored = list(
                db.scalars(
                    select(RawCandle)
                    .where(RawCandle.listing_id == listing)
                    .order_by(RawCandle.session)
                )
            )
        dates = [r.session for r in stored]
        result["listings"].append(
            {
                "listing_id": listing,
                "bars": len(stored),
                "new_bars": len(rows),
                "first_session": dates[0] if dates else None,
                "last_session": dates[-1] if dates else None,
                "raw_actions": actions,
                "calendar_verified": False,
                "historical_master_verified": False,
                "actions_verified": False,
            }
        )
    identity = str(uuid.uuid4())
    client.store.check_storage_budget(len(json.dumps(result)) * 3)
    with client.store.session() as db:
        db.add(
            Capture(
                id=identity,
                created_at=datetime.now(timezone.utc).isoformat(),
                payload=result,
            )
        )
        db.commit()
    return {"capture_id": identity, **result}


if __name__ == "__main__":
    main()
