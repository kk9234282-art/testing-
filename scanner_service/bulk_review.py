"""Offline cross-check of verified TejHQ Parquet against captured API candles.

Optional PyArrow dependency. This emits a raw-view dataset only: no assumed
corporate-action availability dates, signals or backtest-completeness claims.
"""

import argparse
import csv
import hashlib
import json
import math
import re
import os
import uuid
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from .schema import Bar, Security
from .tejhq import TERMS, write_private

SYMBOLS = ("PNB", "HDFCLIFE", "PTCIL", "KIRLOSENG")
BAR_FIELDS = ("open", "high", "low", "close", "volume")
ACTION_FIELDS = (
    "exchange",
    "symbol",
    "isin",
    "ex_date",
    "record_date",
    "type",
    "ratio_num",
    "ratio_den",
    "cash_amount",
    "face_value_from",
    "face_value_to",
    "raw_subject",
)


def action_counts(rows):
    return Counter(tuple(row.get(k) for k in ACTION_FIELDS) for row in rows)


def verified_files(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    records = json.loads(manifest_path.read_text())
    result = {}
    revisions = set()
    total_bytes = 0
    for entry in records:
        name = entry["path"]
        if not re.fullmatch(
            r"(?:nse/year=(\d{4})/nse_\1\.parquet|actions/nse_\d{4}\.parquet|symbol_history/nse\.parquet)",
            name,
        ):
            raise ValueError("Unexpected provider artifact path")
        if name in result:
            raise ValueError("Duplicate artifact path")
        path = Path(entry["local"]).resolve()
        if not path.is_relative_to(manifest_path.parent):
            raise ValueError("Artifact escapes its private snapshot directory")
        size = path.stat().st_size
        total_bytes += size
        if size > 25_000_000 or total_bytes > 100_000_000:
            raise ValueError(
                "Bulk review file/cache budget exceeded; stop and review scope"
            )
        if size != entry["bytes"]:
            raise ValueError("Artifact size mismatch")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry["sha256"] or digest != entry["published_lfs_sha256"]:
            raise ValueError("Artifact does not match published SHA-256")
        revision = entry["repository_revision"]
        if not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise ValueError("Missing immutable provider revision")
        revisions.add(revision)
        result[name] = path
    if len(revisions) != 1:
        raise ValueError("Bulk files must come from one pinned repository revision")
    return result, revisions.pop()


def same_candle(left, right):
    return all(
        math.isfinite(float(left[k]))
        and math.isfinite(float(right[k]))
        and math.isclose(float(left[k]), float(right[k]), rel_tol=0, abs_tol=1e-8)
        for k in BAR_FIELDS
    )


def review(manifest_path, capture_dir, master_path, symbols=SYMBOLS):
    import pyarrow.parquet as pq

    files, revision = verified_files(manifest_path)
    capture_dir = Path(capture_dir)
    symbols = tuple(symbols)
    if (
        not 1 <= len(symbols) <= 50
        or len(set(symbols)) != len(symbols)
        or any(
            not re.fullmatch(r"[A-Z0-9&_.!-]{1,40}", s) or s in (".", "..")
            for s in symbols
        )
    ):
        raise ValueError("Select explicit unique equity symbols")
    with open(master_path) as stream:
        master = {
            row["SYMBOL"]: {k.strip(): v.strip() for k, v in row.items()}
            for row in csv.DictReader(stream)
        }
    captures, capture_hashes, start, end = {}, {}, None, None
    for symbol in symbols:
        if symbol not in master:
            raise ValueError(
                "Selected symbol is absent from the supplied NSE equity master"
            )
        capture_path = capture_dir / f"{symbol}-ohlcv.json"
        capture_hashes[symbol] = hashlib.sha256(capture_path.read_bytes()).hexdigest()
        envelope = json.loads(capture_path.read_text())
        if (
            envelope["meta"]["symbol"] != symbol
            or envelope["meta"]["exchange"] != "NSE"
            or envelope["meta"]["count"] != len(envelope["data"])
        ):
            raise ValueError("Captured response identity/count mismatch")
        records = {}
        for raw in envelope["data"]:
            bar = Bar(
                listing_id="NSE:" + symbol,
                date=raw["date"],
                is_final=True,
                **{k: raw[k] for k in BAR_FIELDS},
            )
            day = str(bar.date)
            if day in records:
                raise ValueError("Duplicate API candle")
            records[day] = bar.model_dump(mode="json")
        if not records:
            raise ValueError("Empty capture cannot define a raw-view period")
        captures[symbol] = records
        if not envelope["meta"].get("from") or not envelope["meta"].get("to"):
            raise ValueError(
                "Capture needs explicit request bounds; do not infer scope from returned candles"
            )
        first = str(date.fromisoformat(envelope["meta"]["from"]))
        last = str(date.fromisoformat(envelope["meta"]["to"]))
        if first > last:
            raise ValueError("Invalid captured request bounds")
        if start is not None and (start, end) != (first, last):
            raise ValueError(
                "Selected captures must cover the same explicit review period"
            )
        start, end = first, last
    bulk = {s: {} for s in symbols}
    sessions, total_rows = set(), 0
    for year in range(date.fromisoformat(start).year, date.fromisoformat(end).year + 1):
        name = f"nse/year={year}/nse_{year}.parquet"
        if name not in files:
            raise ValueError("Missing annual raw file for the requested period")
        file = pq.ParquetFile(files[name])
        if file.metadata.num_rows > 5_000_000:
            raise ValueError("Annual row budget exceeded")
        total_rows += file.metadata.num_rows
        for day in file.read(columns=["date"]).column("date").unique().to_pylist():
            day = str(day)[:10]
            if start <= day <= end:
                sessions.add(day)
        selected_table = pq.read_table(
            files[name],
            partitioning=None,
            filters=[("symbol", "in", list(symbols))],
            columns=["date", "symbol", "isin", "series", *BAR_FIELDS],
        )
        if selected_table.num_rows > 366 * len(symbols):
            raise ValueError(
                "Selected daily row budget exceeded; inspect duplicate/invalid sessions"
            )
        selected = selected_table.to_pylist()
        for raw in selected:
            day, symbol = str(raw["date"])[:10], raw["symbol"]
            if not start <= day <= end:
                continue
            if day in bulk[symbol]:
                raise ValueError("Duplicate selected symbol/session in bulk data")
            Bar(
                listing_id="NSE:" + symbol,
                date=day,
                is_final=True,
                **{k: raw[k] for k in BAR_FIELDS},
            )
            bulk[symbol][day] = {**raw, "date": day}
    history = pq.read_table(files["symbol_history/nse.parquet"]).to_pylist()
    actions = []
    action_columns = set()
    for name, path in files.items():
        if name.startswith("actions/"):
            action_columns.update(pq.ParquetFile(path).schema_arrow.names)
            for raw in pq.read_table(path).to_pylist():
                if (
                    raw["symbol"] in symbols
                    and start <= str(raw["ex_date"])[:10] <= end
                ):
                    actions.append(
                        {
                            k: (v.isoformat() if isinstance(v, (date, datetime)) else v)
                            for k, v in raw.items()
                        }
                    )
    reports, securities, action_capture_hashes = [], [], {}
    for symbol in symbols:
        api, data = captures[symbol], bulk[symbol]
        missing_api = sorted(sessions - set(api))
        missing_bulk = sorted(sessions - set(data))
        different = [
            day
            for day in sorted(set(api) & set(data))
            if not same_candle(api[day], data[day])
        ]
        outside_api = sorted(set(api) - sessions)
        source_isins = {r["isin"] for r in data.values() if r["isin"]}
        source_series = sorted({r["series"] for r in data.values()})
        identity = [
            h
            for h in history
            if h["symbol"] == symbol
            and str(h["valid_from"])[:10] <= start
            and str(h["valid_to"])[:10] >= end
        ]
        identity_ok = (
            len(identity) == 1
            and source_isins == {master[symbol]["ISIN NUMBER"]}
            and identity[0]["isin"] == master[symbol]["ISIN NUMBER"]
            and all(r["isin"] for r in data.values())
        )
        if identity_ok:
            # Historical identity was already observed before this dataset's start.
            # No action publication/known_on timestamps are manufactured here.
            source_first_observed = str(identity[0]["valid_from"])[:10]
            security = Security(
                security_id=master[symbol]["ISIN NUMBER"],
                listing_id="NSE:" + symbol,
                isin=master[symbol]["ISIN NUMBER"],
                name=master[symbol]["NAME OF COMPANY"],
                exchange="NSE",
                symbol=symbol,
                sector="Unclassified",
                instrument_type="EQUITY",
                valid_from=start,
                known_on=source_first_observed,
            )
            securities.append(security.model_dump(mode="json"))
        mismatched_actions = [
            a
            for a in actions
            if a["symbol"] == symbol and a["isin"] != master[symbol]["ISIN NUMBER"]
        ]
        action_file = capture_dir / f"{symbol}-actions.json"
        actions_match = None
        if action_file.exists():
            action_capture_hashes[symbol] = hashlib.sha256(
                action_file.read_bytes()
            ).hexdigest()
            envelope = json.loads(action_file.read_text())
            if envelope["meta"]["symbol"] != symbol or envelope["meta"]["count"] != len(
                envelope["data"]
            ):
                raise ValueError("Captured action identity/count mismatch")
            api_actions = [
                a
                for a in envelope["data"]
                if a["exchange"] == "NSE" and start <= a["ex_date"] <= end
            ]
            actions_match = action_counts(api_actions) == action_counts(
                [a for a in actions if a["symbol"] == symbol]
            )
        reports.append(
            {
                "symbol": symbol,
                "api_candles": len(api),
                "bulk_candles": len(data),
                "missing_api_sessions": missing_api,
                "missing_bulk_sessions": missing_bulk,
                "api_dates_outside_market_observations": outside_api,
                "different_candles": different,
                "series": source_series,
                "identity_source_consistent": identity_ok,
                "historical_identity_intervals": [
                    {
                        k: str(v)[:10] if k in ("valid_from", "valid_to") else v
                        for k, v in h.items()
                    }
                    for h in history
                    if h["symbol"] == symbol
                ],
                "source_action_isin_mismatches": mismatched_actions,
                "action_interfaces_match": actions_match,
                "signals_verified": False,
            }
        )
    prices_match = all(
        not r["different_candles"]
        and not r["missing_api_sessions"]
        and not r["missing_bulk_sessions"]
        and not r["api_dates_outside_market_observations"]
        for r in reports
    )
    metadata = {
        "manifest": {
            "name": "TejHQ actual NSE candles — strict raw-only review",
            "source": "TejHQ keyless API and SHA-verified bulk snapshot " + revision,
            "kind": "licensed",
            "license_reference": TERMS,
            "ohlcv_basis": "raw",
            "latest_complete_session": end,
            "universe_history_complete": False,
            "corporate_actions_complete": False,
            "notes": "Personal-use source permission, not an exchange licence. Raw-view dataset only: no approved action publication timestamps/factors, signals or backtests. Sessions are observed across full NSE Parquet, not an independently certified holiday calendar. Selected source ISIN histories agree with the supplied current NSE master; identity known_on records the earlier historical observation, not announcement timing. Sectors are unclassified; observed trading series are recorded in the review. Nifty index/constituent history is absent.",
        },
        "sessions": sorted(sessions),
        "securities": securities,
        "actions": [],
        "benchmarks": [],
        "index_bars": [],
        "memberships": [],
        "fundamentals": [],
        "terminals": [],
    }
    return {
        "repository_revision": revision,
        "api_capture_sha256": capture_hashes,
        "api_action_capture_sha256": action_capture_hashes,
        "current_master_sha256": hashlib.sha256(
            Path(master_path).read_bytes()
        ).hexdigest(),
        "source_sha256": {
            name: hashlib.sha256(path.read_bytes()).hexdigest()
            for name, path in files.items()
        },
        "source_rows_inspected": total_rows,
        "period": {"from": start, "to": end},
        "observed_market_sessions": len(sessions),
        "price_interfaces_match": prices_match,
        "scope": "Four selected NSE equities; consistency within one provider, not independent exchange certification",
        "calendar_basis": "All dates observed in full-market annual NSE Parquet files; simultaneous missing source days cannot be ruled out",
        "publication_fields_present": sorted(
            action_columns
            & {
                "announced_at",
                "announced_on",
                "announcement_date",
                "publication_date",
                "published_at",
                "broadcast_date",
                "broadcast_datetime",
            }
        ),
        "publication_timestamps_present": any(
            a.get(k) is not None
            for a in actions
            for k in (
                "announced_at",
                "announced_on",
                "announcement_date",
                "publication_date",
                "published_at",
                "broadcast_date",
                "broadcast_datetime",
            )
        ),
        "publication_timestamps_verified": False,
        "actions_applied": False,
        "stocks": reports,
        "promotion": (
            "raw_view_only"
            if prices_match and len(securities) == len(symbols)
            else "blocked"
        ),
        "metadata_candidate": metadata,
        "action_evidence": actions,
    }, captures


def main():
    parser = argparse.ArgumentParser(
        description="Offline strict raw-view audit of published-hash-verified TejHQ files"
    )
    parser.add_argument("manifest")
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--master", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--symbols", nargs="+", default=list(SYMBOLS))
    parser.add_argument("--metadata-output")
    parser.add_argument("--csv-output")
    args = parser.parse_args()
    report, captures = review(
        args.manifest, args.capture_dir, args.master, args.symbols
    )
    metadata = report.pop("metadata_candidate")
    write_private(args.output, report)
    if args.metadata_output or args.csv_output:
        if report["promotion"] != "raw_view_only":
            raise ValueError(
                "Source comparison/identity checks failed; no research import files emitted"
            )
        if args.metadata_output:
            write_private(args.metadata_output, metadata)
        if args.csv_output:
            path = Path(args.csv_output).resolve()
            root = Path(__file__).resolve().parents[1]
            if any(
                path == p or p in path.parents for p in (root / "public", root / "dist")
            ):
                raise ValueError(
                    "Private candles cannot be exported into public/ or dist/"
                )
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = path.with_name(path.name + "." + str(uuid.uuid4()) + ".tmp")
            try:
                with os.fdopen(
                    os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                    "w",
                    newline="",
                ) as stream:
                    fields = ["listing_id", "date", *BAR_FIELDS]
                    writer = csv.DictWriter(stream, fieldnames=fields)
                    writer.writeheader()
                    for symbol in args.symbols:
                        for day, row in sorted(captures[symbol].items()):
                            writer.writerow({k: row[k] for k in fields})
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
    print(
        json.dumps(
            {
                "promotion": report["promotion"],
                "stocks": len(report["stocks"]),
                "observed_market_sessions": report["observed_market_sessions"],
                "price_interfaces_match": report["price_interfaces_match"],
                "signals_verified": False,
            }
        )
    )


if __name__ == "__main__":
    main()
