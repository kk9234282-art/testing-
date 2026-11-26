"""Synthetic API contracts; real captures remain private and are not test fixtures."""

import copy
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from sqlalchemy import select
from scanner_service.demo import make_demo
from scanner_service.storage import Store
from scanner_service.market_data import MarketData, Usage
from scanner_service.tejhq import (
    Client,
    Settings,
    TejCall,
    TERMS,
    missing_spans,
    sync,
    write_private,
)


class TejTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(f"sqlite:///{self.root / 'db.sqlite3'}")
        self.client = Client(self.store, self.root / "cache")

    def tearDown(self):
        self.store.engine.dispose()
        self.temp.cleanup()

    def network(self, payload, status=200):
        handler = patch("scanner_service.tejhq.httpx.stream")
        network = handler.start()
        self.addCleanup(handler.stop)
        response = network.return_value.__enter__.return_value
        response.status_code = status
        response.iter_bytes.side_effect = lambda: [json.dumps(payload).encode()]
        return network

    def test_only_documented_keyless_urls_no_auth_billing_or_paid_fallback(self):
        for path in (
            "/v1/adjusted/nse/PNB",
            "/v1/billing/subscribe",
            "/v1/auth/request-link",
            "/v1/batch",
            "/v1/ohlcv/nse/../me",
            "/v1/actions/..",
            "/v1/ohlcv/nse/.",
            "https://evil.example/",
        ):
            with self.assertRaises(ValueError):
                self.client.get(path)
        with self.assertRaises(ValueError):
            self.client.get("/v1/status", {"key": "not-supported"})
        self.assertIn("M%26M", Client.url("/v1/ohlcv/nse/M&M"))
        with self.assertRaises(ValueError):
            Client(self.store, daily_limit=501)

    def test_cache_and_request_reservation_happen_once_without_credentials(self):
        network = self.network({"data": [], "meta": {"count": 0}})
        self.client.get("/v1/actions/PNB")
        self.client.get("/v1/actions/PNB")
        self.assertEqual(network.call_count, 1)
        self.assertNotIn("headers", network.call_args.kwargs)
        self.assertFalse(network.call_args.kwargs["follow_redirects"])
        with self.store.session() as db:
            self.assertEqual(len(list(db.scalars(select(TejCall)))), 1)
            self.assertEqual(db.scalar(select(Usage)).requests, 1)

    def test_shared_quota_uses_utc_reset_not_ist_midnight(self):
        stamp = datetime(2026, 11, 25, 23, 59, tzinfo=timezone.utc).timestamp()
        self.network({"data": [], "meta": {"count": 0}})
        with patch("scanner_service.tejhq.time.time", return_value=stamp):
            self.client.get("/v1/actions/PNB")
        with self.store.session() as db:
            self.assertIsNotNone(db.get(Usage, "tejhq-open:2026-11-25"))
            self.assertIsNone(db.get(Usage, "tejhq-open:2026-11-26"))

    def test_burst_pacing_preserves_five_per_ten_seconds(self):
        clock = [100000.0]
        self.network({"data": [], "meta": {"count": 0}})
        with patch(
            "scanner_service.tejhq.time.time", side_effect=lambda: clock[0]
        ), patch(
            "scanner_service.tejhq.time.sleep",
            side_effect=lambda seconds: clock.__setitem__(
                0, clock[0] + seconds + 0.001
            ),
        ):
            for i in range(6):
                self.client.get("/v1/actions/X" + str(i))
        with self.store.session() as db:
            stamps = [
                r.attempted_at
                for r in db.scalars(select(TejCall).order_by(TejCall.attempted_at))
            ]
        self.assertEqual(len(stamps), 6)
        self.assertGreater(stamps[5] - stamps[0], 10)

    def test_429_pauses_durably_and_counts_failed_request(self):
        network = self.network({}, 429)
        with self.assertRaisesRegex(ValueError, "429"):
            self.client.get("/v1/actions/PNB")
        with self.assertRaisesRegex(ValueError, "paused"):
            self.client.get("/v1/actions/HDFCLIFE")
        self.assertEqual(network.call_count, 1)
        with self.store.session() as db:
            row = db.scalar(select(Usage))
            self.assertTrue(row.paused)
            self.assertEqual(row.requests, 1)

    def test_daily_cap_and_schema_errors_never_trigger_extra_request(self):
        network = self.network({"data": [], "meta": {"count": 0}})
        client = Client(self.store, self.root / "tiny", daily_limit=1)
        client.get("/v1/actions/PNB")
        with self.assertRaisesRegex(ValueError, "allowance"):
            client.get("/v1/actions/HDFCLIFE")
        self.assertEqual(network.call_count, 1)

    def test_mismatched_envelope_is_paused_not_imported(self):
        self.network({"data": [], "meta": {"count": 100}})
        with self.assertRaisesRegex(ValueError, "envelope"):
            self.client.get("/v1/actions/PNB")
        self.assertEqual(list((self.root / "cache").glob("*.json")), [])

    def test_private_export_guard_and_missing_exchange_spans(self):
        public = (
            Path(__file__).resolve().parents[2]
            / "public"
            / "never-written-provider-data.json"
        )
        with self.assertRaises(ValueError):
            write_private(public, {"data": "fixture"})
        self.assertFalse(public.exists())
        sessions = ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"]
        self.assertEqual(
            missing_spans(
                sessions, {"2025-01-02", "2025-01-06"}, sessions[0], sessions[-1]
            ),
            [("2025-01-03", "2025-01-03"), ("2025-01-07", "2025-01-07")],
        )

    def setup_sync(self):
        demo = make_demo().model_dump(mode="json")
        security = demo["securities"][0]
        days = demo["sessions"][:3]
        metadata = {
            "manifest": {
                **demo["manifest"],
                "source": "TejHQ SYNTHETIC CONTRACT FIXTURE",
                "kind": "licensed",
                "license_reference": TERMS,
                "latest_complete_session": days[1],
                "universe_history_complete": False,
                "corporate_actions_complete": False,
            },
            "sessions": days[:2],
            "securities": [security],
            "actions": [],
        }
        metadata_file = self.root / "metadata.json"
        metadata_file.write_text(json.dumps(metadata))
        settings = {
            "feed_id": "tej-fixture",
            "metadata_path": str(metadata_file),
            "listings": [security["listing_id"]],
            "permission_verified_on": datetime.now(timezone.utc).date().isoformat(),
        }
        bars = [
            {
                "date": d,
                "open": 100,
                "high": 103,
                "low": 99,
                "close": 102,
                "volume": 1200,
            }
            for d in days
        ]

        class Fixture:
            calls = []
            action_rows = []

            def status(self):
                return {"trading_date": days[2]}

            def get(self, path, query=None, **kwargs):
                self.calls.append((path, query))
                rows = (
                    self.action_rows
                    if "/actions/" in path
                    else [b for b in bars if query["from"] <= b["date"] <= query["to"]]
                )
                return {"data": rows, "meta": {"count": len(rows)}}

        return settings, metadata, metadata_file, Fixture(), days

    def test_incremental_sync_uses_only_missing_dates_and_keeps_identical_dataset(self):
        settings, metadata, file, client, days = self.setup_sync()
        first = sync(settings, self.store, client)
        self.assertEqual(first["new_candles"], 2)
        client.calls = []
        second = sync(settings, self.store, client)
        self.assertEqual(first["dataset_id"], second["dataset_id"])
        self.assertFalse(any("/ohlcv/" in call[0] for call in client.calls))
        metadata["sessions"].append(days[2])
        metadata["manifest"]["latest_complete_session"] = days[2]
        file.write_text(json.dumps(metadata))
        client.calls = []
        third = sync(settings, self.store, client)
        self.assertEqual(third["new_candles"], 1)
        self.assertIn(
            {"from": days[2], "to": days[2]},
            [q for p, q in client.calls if "/ohlcv/" in p],
        )
        self.assertEqual(len(self.store.load(first["dataset_id"]).bars), 2)

    def test_actions_are_audited_not_turned_into_invented_availability_dates(self):
        settings, metadata, file, client, days = self.setup_sync()
        client.action_rows = [
            {
                "exchange": "NSE",
                "symbol": "EXAMPLE01",
                "ex_date": days[0],
                "type": "dividend",
                "cash_amount": 2,
            }
        ]
        result = sync(settings, self.store, client)
        self.assertEqual(result["unreviewed_financial_actions"], 1)
        self.assertFalse(result["actions_applied_automatically"])
        self.assertEqual(self.store.load(result["dataset_id"]).actions, [])
        self.assertTrue((self.root / "tejhq-action-review.json").exists())
        metadata["manifest"]["corporate_actions_complete"] = True
        file.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "completeness"):
            sync(settings, self.store, client)

    def test_stale_source_and_non_equity_master_block_sync(self):
        settings, metadata, file, client, days = self.setup_sync()
        metadata["manifest"]["latest_complete_session"] = "2099-01-01"
        file.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "freshness"):
            sync(settings, self.store, client)
        metadata["manifest"]["latest_complete_session"] = days[1]
        metadata["securities"][0]["instrument_type"] = "ETF"
        file.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "equity master"):
            sync(settings, self.store, client)

    def test_postgresql_sync_roundtrip_when_supplied(self):
        url = os.getenv("SCANNER_TEST_DATABASE_URL")
        if not url:
            self.skipTest("Disposable PostgreSQL URL not supplied")
        settings, _, _, client, _ = self.setup_sync()
        settings["feed_id"] = "tej-fixture-" + self.root.name.lower().replace("_", "-")
        store = Store(url)
        try:
            result = sync(settings, store, client)
            self.assertEqual(len(store.load(result["dataset_id"]).bars), 2)
        finally:
            store.engine.dispose()


class QualityAndCapture(unittest.TestCase):
    setUp = TejTests.setUp
    tearDown = TejTests.tearDown
    setup_sync = TejTests.setup_sync

    def test_same_day_eod_requires_closed_market_but_is_not_forced_to_t_plus_one(self):
        from zoneinfo import ZoneInfo
        from scanner_service.tejhq import capture_raw

        _, metadata, _, fixture, days = self.setup_sync()
        fixture.store = self.store
        fixture.status = lambda: {"trading_date": days[0]}
        observed = __import__("datetime").date.fromisoformat(days[0])
        with patch("scanner_service.tejhq.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime.combine(
                observed, __import__("datetime").time(15), ZoneInfo("Asia/Kolkata")
            )
            with self.assertRaisesRegex(ValueError, "market close"):
                capture_raw(
                    fixture, [metadata["securities"][0]["listing_id"]], observed
                )
            clock.now.return_value = datetime.combine(
                observed, __import__("datetime").time(16), ZoneInfo("Asia/Kolkata")
            )
            result = capture_raw(
                fixture, [metadata["securities"][0]["listing_id"]], observed
            )
            self.assertEqual(result["listings"][0]["bars"], 1)

    def test_real_incomplete_actions_cannot_publish_structure_or_annotations(self):
        from scanner_service.quality import gate_scan, raw_stock
        from scanner_service.schema import Bundle, Parameters
        from scanner_service.research import Context
        from scanner_service.validation import validate_history

        payload = make_demo().model_dump(mode="json")
        payload["manifest"].update(
            kind="licensed",
            corporate_actions_complete=False,
            universe_history_complete=False,
        )
        bundle = Bundle.model_validate(payload)
        context = Context(bundle)
        result = context.scan(bundle.manifest.latest_complete_session, Parameters())
        gated = gate_scan(result, payload["manifest"])
        self.assertTrue(
            all(r["status"] is None and r["rs63"] is None for r in gated["rows"])
        )
        self.assertEqual(gated["sectors"], [])
        detail = raw_stock(
            context,
            payload["securities"][0]["security_id"],
            bundle.manifest.latest_complete_session,
        )
        self.assertEqual(detail["pivots"], [])
        self.assertIn("RAW OHLCV", detail["price_basis"])
        self.assertEqual(detail["series"][0]["close"], payload["bars"][0]["close"])
        report = validate_history(bundle, symbols=[payload["securities"][0]["symbol"]])
        self.assertFalse(report["stocks"][0]["verified"])
        self.assertNotIn("episodes", report["stocks"][0])
        dataset = self.store.save(bundle)
        run = self.store.create_run(dataset, "scan", {"fixture": True})
        self.store.update(run, state="complete", result=result)
        self.assertIn("quality_warning", self.store.get_run(run)["result"])

    def test_raw_capture_is_not_an_approved_research_dataset_and_is_idempotent(self):
        from scanner_service.tejhq import capture_raw, RawCandle

        settings, metadata, file, fixture, days = self.setup_sync()
        fixture.store = self.store
        captured = capture_raw(
            fixture,
            [metadata["securities"][0]["listing_id"]],
            start=__import__("datetime").date.fromisoformat(days[0]),
        )
        self.assertEqual(captured["state"], "raw_staging_only")
        self.assertEqual(captured["listings"][0]["bars"], 3)
        self.assertFalse(captured["listings"][0]["actions_verified"])
        second = capture_raw(
            fixture,
            [metadata["securities"][0]["listing_id"]],
            start=__import__("datetime").date.fromisoformat(days[0]),
        )
        self.assertEqual(second["listings"][0]["new_bars"], 0)
        self.assertEqual(self.store.datasets(), [])
        with self.store.session() as db:
            self.assertEqual(len(list(db.scalars(select(RawCandle)))), 3)
