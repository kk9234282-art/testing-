"""Contract fixtures are synthetic, never evidence of verified exchange prices."""

import copy
import io
import json
import os
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient
from scanner_service.demo import make_demo
from scanner_service.schema import Bundle, Parameters
from scanner_service.storage import Store
from scanner_service.market_data import (
    MarketData,
    InputFile,
    Permission,
    parse_file,
    merge_bundle,
    UpdateConfig,
)
from scanner_service.validation import validate_history, supplementary_breadth
from scanner_service.app import create_app


class MarketDataTests(unittest.TestCase):
    def test_nifty_automation_requires_written_consent_not_personal_use_alone(self):
        policy = {
            "provider": "indices",
            "reference": "https://www.niftyindices.com/terms-of-use",
            "verified_on": datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat(),
            "free_personal_use_confirmed": True,
            "zero_cost_confirmed": True,
            "network_download_permitted": True,
            "daily_request_limit": 1,
            "daily_download_bytes": 1000,
        }
        with self.assertRaisesRegex(ValueError, "written consent"):
            Permission.model_validate(policy)
        policy["network_download_permitted"] = False
        self.assertFalse(Permission.model_validate(policy).network_download_permitted)
        policy.update(
            network_download_permitted=True,
            written_automation_permission_reference="fixture-only: explicit source consent record",
        )
        self.assertTrue(Permission.model_validate(policy).network_download_permitted)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(f"sqlite:///{self.root / 'db.sqlite3'}")
        self.service = MarketData(self.store, self.root / "cache")
        self.demo = make_demo().model_dump(mode="json")
        self.master = self.demo["securities"]
        self.symbol = self.master[0]["symbol"]
        self.listing = self.master[0]["listing_id"]
        self.day = self.demo["sessions"][0]
        self.today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()

    def tearDown(self):
        self.store.engine.dispose()
        self.temp.cleanup()

    def permission(self):
        return {
            "provider": "manual",
            "reference": "fixture-test-permission-only",
            "verified_on": self.today,
            "free_personal_use_confirmed": True,
            "zero_cost_confirmed": True,
        }

    def metadata(self):
        metadata = copy.deepcopy(self.demo)
        metadata.pop("bars")
        metadata.pop("index_bars")
        metadata["manifest"].update(
            kind="licensed",
            source="SYNTHETIC TEST FIXTURE, NOT REAL PRICES",
            license_reference="fixture-test-permission-only",
            latest_complete_session=self.day,
            universe_history_complete=False,
            corporate_actions_complete=False,
        )
        metadata["sessions"] = [self.day]
        metadata["actions"] = []
        metadata["terminals"] = []
        return metadata

    def config(self, csv=None):
        path = self.root / "daily.csv"
        path.write_text(
            csv
            or f"listing_id,date,open,high,low,close,volume\n{self.listing},{self.day},100,103,99,102,1200\n"
        )
        return {
            "feed_id": "fixture",
            "permission": self.permission(),
            "metadata": self.metadata(),
            "files": [{"format": "bars", "path": str(path)}],
        }

    def test_nse_legacy_raw_prices_and_verified_delivery(self):
        raw = f"SYMBOL,SERIES,TIMESTAMP,OPEN,HIGH,LOW,CLOSE,TOTTRDQTY,DELIV_PER\n{self.symbol},EQ,{self.day},100,103,99,102,1200,45\nETF,EQ,{self.day},10,11,9,10,100,25\n".encode()
        rows, indices, ignored = parse_file(
            raw, InputFile(format="nse-legacy", path="fixture"), self.master
        )
        self.assertEqual((len(rows), len(indices), ignored), (1, 0, 1))
        self.assertEqual(rows[0]["volume"], 1200)
        self.assertFalse(rows[0]["delivery_verified"])
        rows, _, _ = parse_file(
            raw,
            InputFile(format="nse-legacy", path="fixture", delivery_verified=True),
            self.master,
        )
        self.assertTrue(rows[0]["delivery_verified"])

    def test_udiff_equity_filter_isin_and_bse_identity(self):
        raw = f'TradDt,Sgmt,FinInstrmTp,TckrSymb,SctySrs,ISIN,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol\n{self.day},CM,STK,{self.symbol},EQ,{self.master[0]["isin"]},100,103,99,102,1200\n{self.day},FO,FUT,FOO,EQ,,10,11,9,10,120\n'.encode()
        rows, _, skipped = parse_file(
            raw, InputFile(format="nse-udiff", path="fixture"), self.master
        )
        self.assertEqual((len(rows), skipped), (1, 1))
        with self.assertRaises(ValueError):
            parse_file(
                raw.replace(self.master[0]["isin"].encode(), b"INE009A01021"),
                InputFile(format="nse-udiff", path="fixture"),
                self.master,
            )
        bse = next(s for s in self.master if s["exchange"] == "BSE")
        raw = f'TradDt,Sgmt,FinInstrmTp,FinInstrmId,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol\n{self.day},CM,STK,{bse["symbol"]},100,103,99,102,1200\n'.encode()
        rows, _, _ = parse_file(
            raw, InputFile(format="bse-udiff", path="fixture"), self.master
        )
        self.assertEqual(rows[0]["listing_id"], bse["listing_id"])

    def test_bse_legacy_explicit_session_and_indices(self):
        bse = next(s for s in self.master if s["exchange"] == "BSE")
        raw = f'SC_CODE,OPEN,HIGH,LOW,CLOSE,NO_OF_SHRS\n{bse["symbol"]},100,103,99,102,1200\n'.encode()
        with self.assertRaises(ValueError):
            parse_file(raw, InputFile(format="bse-legacy", path="fixture"), self.master)
        rows, _, _ = parse_file(
            raw,
            InputFile(
                format="bse-legacy",
                path="fixture",
                session=date.fromisoformat(self.day),
            ),
            self.master,
        )
        self.assertEqual(rows[0]["date"], self.day)
        _, indices, _ = parse_file(
            f"Date,Close\n{self.day},22000\n".encode(),
            InputFile(format="indices", path="fixture", index_id="NIFTY_500"),
            self.master,
        )
        self.assertEqual(indices[0]["close"], 22000)

    def test_bad_volume_geometry_session_and_adjusted_source_rejected(self):
        config = self.config()
        raw = Path(config["files"][0]["path"]).read_bytes()
        for bad in (raw.replace(b"1200", b"-1"), raw.replace(b"103", b"90")):
            with self.assertRaises(ValueError):
                parse_file(bad, InputFile(**config["files"][0]), self.master)
        with self.assertRaises(ValueError):
            parse_file(
                raw,
                InputFile(**{**config["files"][0], "session": "2020-01-01"}),
                self.master,
            )
        config["metadata"]["manifest"]["ohlcv_basis"] = "adjusted"
        with self.assertRaises(ValueError):
            self.service.update(config)

    def test_zip_is_bounded_and_never_extracts_paths(self):
        raw = Path(self.config()["files"][0]["path"]).read_bytes()
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("../../daily.csv", raw)
        rows, _, _ = parse_file(
            archive.getvalue(), InputFile(format="bars", path="fixture"), self.master
        )
        self.assertEqual(len(rows), 1)
        self.assertFalse(
            (self.root / "daily.csv").parent.parent.joinpath("daily.csv").exists()
        )
        with zipfile.ZipFile(archive, "a") as zipped:
            zipped.writestr("second.csv", raw)
        with self.assertRaises(ValueError):
            parse_file(
                archive.getvalue(),
                InputFile(format="bars", path="fixture"),
                self.master,
            )

    def test_idempotent_incremental_import_retains_old_run_inputs(self):
        config = self.config()
        first = self.service.update(config)
        second = self.service.update(config)
        self.assertEqual(first["dataset_id"], second["dataset_id"])
        self.assertEqual(second["new_artifacts"], 0)
        nextday = self.demo["sessions"][1]
        config["metadata"]["sessions"].append(nextday)
        config["metadata"]["manifest"]["latest_complete_session"] = nextday
        Path(config["files"][0]["path"]).write_text(
            f"listing_id,date,open,high,low,close,volume\n{self.listing},{nextday},102,105,101,104,1000\n"
        )
        latest = self.service.update(config)
        self.assertNotEqual(first["dataset_id"], latest["dataset_id"])
        self.assertEqual(len(self.store.load(first["dataset_id"]).bars), 1)
        self.assertEqual(len(self.store.load(latest["dataset_id"]).bars), 2)
        self.assertEqual(len(self.service.statuses()["feeds"]), 1)
        self.assertFalse(self.service.statuses()["paid_fallback"])

    def test_conflict_rolls_back_watermark_and_preserves_error(self):
        config = self.config()
        first = self.service.update(config)
        Path(config["files"][0]["path"]).write_text(
            f"listing_id,date,open,high,low,close,volume\n{self.listing},{self.day},100,104,99,103,1200\n"
        )
        with self.assertRaises(ValueError):
            self.service.update(config)
        feed = self.service.statuses()["feeds"][0]
        self.assertEqual(feed["dataset_id"], first["dataset_id"])
        self.assertIn("Conflicting historical", feed["last_error"])

    def test_source_permission_and_storage_gates(self):
        for field in ("free_personal_use_confirmed", "zero_cost_confirmed"):
            policy = self.permission()
            policy[field] = False
            with self.assertRaises(ValueError):
                Permission.model_validate(policy)
        policy = self.permission()
        policy["verified_on"] = "2000-01-01"
        with self.assertRaises(ValueError):
            Permission.model_validate(policy)
        config = self.config()
        config["metadata"]["manifest"]["license_reference"] = "different-source"
        with self.assertRaises(ValueError):
            self.service.update(config)
        config = self.config()
        with patch.object(self.service, "storage_bytes", return_value=100_000_001):
            with self.assertRaisesRegex(ValueError, "budget"):
                self.service.update(config)

    def test_original_import_and_result_writes_also_obey_storage_budget(self):
        with patch.object(self.store, "storage_bytes", return_value=100_000_001):
            with self.assertRaisesRegex(ValueError, "budget"):
                self.store.save(Bundle.model_validate(self.demo))
            with self.assertRaisesRegex(ValueError, "budget"):
                self.store.update("unused-test-id", result={"fixture": True})

    def test_cli_runs_default_parameters_and_reuses_only_matching_scan(self):
        from scanner_service.market_cli import main

        config = self.config()
        first = self.service.update(config)
        custom = self.store.create_run(
            first["dataset_id"],
            "scan",
            {"as_of": self.day, "parameters": Parameters(pivot_left=4).model_dump()},
        )
        self.store.update(
            custom, state="complete", result={"fixture": "custom parameter run"}
        )
        config_file = self.root / "update.json"
        config_file.write_text(json.dumps(config))

        def invoke():
            out = io.StringIO()
            with patch(
                "sys.argv", ["market_cli", "update", str(config_file), "--scan"]
            ), patch(
                "scanner_service.market_cli.Store", return_value=self.store
            ), redirect_stdout(
                out
            ):
                main()
            return json.loads(out.getvalue())

        result = invoke()
        self.assertNotEqual(result["scan_run_id"], custom)
        self.assertEqual(result["scan_run_id"], invoke()["scan_run_id"])

    def test_remote_disabled_and_arbitrary_hosts_blocked(self):
        config = self.config()
        config["files"] = [
            {
                "format": "nse-udiff",
                "url": "https://nsearchives.nseindia.com/example.csv",
                "session": self.day,
            }
        ]
        with patch("scanner_service.market_data.httpx.stream") as network:
            with self.assertRaises(ValueError):
                self.service.update(config)
            network.assert_not_called()
        config["permission"].update(
            provider="nse",
            network_download_permitted=True,
            daily_request_limit=1,
            daily_download_bytes=1000,
        )
        for url in (
            "http://nsearchives.nseindia.com/a.csv",
            "https://127.0.0.1/a.csv",
            "https://nsearchives.nseindia.com@evil.example/a.csv",
            "https://nsearchives.nseindia.com/a.csv?token=secret",
        ):
            config["files"][0]["url"] = url
            with self.assertRaises(ValueError):
                self.service.update(config)

    def test_quota_counts_failed_requests_and_prevents_retry(self):
        config = self.config()
        config["permission"].update(
            provider="nse",
            network_download_permitted=True,
            daily_request_limit=1,
            daily_download_bytes=1000,
        )
        config["files"] = [
            {
                "format": "nse-udiff",
                "url": "https://nsearchives.nseindia.com/example.csv",
                "session": self.day,
            }
        ]
        with patch("scanner_service.market_data.httpx.stream") as network:
            network.return_value.__enter__.return_value.status_code = 429
            with self.assertRaisesRegex(ValueError, "429"):
                self.service.update(config)
            with self.assertRaisesRegex(ValueError, "quota"):
                self.service.update(config)
            self.assertEqual(network.call_count, 1)
        self.assertTrue(self.service.statuses()["feeds"][0]["usage_today"]["paused"])

    def test_cached_remote_is_not_downloaded_twice(self):
        config = self.config()
        raw = Path(config["files"][0]["path"]).read_bytes()
        config["permission"].update(
            provider="nse",
            network_download_permitted=True,
            daily_request_limit=1,
            daily_download_bytes=1000,
        )
        config["files"] = [
            {
                "format": "bars",
                "url": "https://nsearchives.nseindia.com/example.csv",
                "session": self.day,
            }
        ]
        with patch("scanner_service.market_data.httpx.stream") as network:
            response = network.return_value.__enter__.return_value
            response.status_code = 200
            response.iter_bytes.return_value = [raw]
            first = self.service.update(config)
            second = self.service.update(config)
            self.assertEqual(first["dataset_id"], second["dataset_id"])
            self.assertEqual(network.call_count, 1)

    def test_status_api_is_private(self):
        config = self.config()
        self.service.update(config)
        app = create_app(self.store, token="fixture-only-token")
        with TestClient(app) as client:
            self.assertEqual(
                client.get("/api/structure/market-data/status").status_code, 401
            )
            response = client.get(
                "/api/structure/market-data/status",
                headers={"Authorization": "Bearer fixture-only-token"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["feeds"][0]["feed_id"], "fixture")
        app.state.executor.shutdown()

    def test_validation_does_not_fit_missing_examples_or_bypass_completeness(self):
        result = validate_history(
            Bundle.model_validate(self.demo), symbols=["PNB", self.symbol]
        )
        self.assertFalse(result["stocks"][0]["verified"])
        self.assertTrue(result["stocks"][1]["verified"])
        self.assertGreater(result["stocks"][1]["prefix_checkpoints_passed"], 1)
        data = copy.deepcopy(self.demo)
        data["manifest"]["universe_history_complete"] = False
        result = validate_history(Bundle.model_validate(data), symbols=["PNB"])
        self.assertEqual(result["backtests"]["state"], "blocked")

    def test_supplementary_metrics_do_not_change_regime_score(self):
        bundle = Bundle.model_validate(self.demo)
        result = supplementary_breadth(bundle, bundle.manifest.latest_complete_session)
        self.assertGreaterEqual(result["indices"][0]["above20_ema_pct"], 0)
        from scanner_service.research import Context

        original = Context(bundle).regime(bundle.manifest.latest_complete_session)
        self.assertEqual(
            [r["score"] for r in original["indices"]],
            [r["score"] for r in result["indices"]],
        )

    def test_postgresql_incremental_roundtrip_when_configured(self):
        url = os.getenv("SCANNER_TEST_DATABASE_URL")
        if not url:
            self.skipTest("PostgreSQL URL not supplied; SQLite coverage is separate")
        store = Store(url)
        try:
            config = self.config()
            config["feed_id"] = "fixture-" + self.root.name.lower().replace("_", "-")
            config["storage_limit_bytes"] = 500_000_000
            result = MarketData(store, self.root / "pg-cache").update(config)
            self.assertEqual(len(store.load(result["dataset_id"]).bars), 1)
            repeated = MarketData(store, self.root / "pg-cache").update(config)
            self.assertEqual(repeated["dataset_id"], result["dataset_id"])
            self.assertEqual(repeated["new_artifacts"], 0)
        finally:
            store.engine.dispose()
