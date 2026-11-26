import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import delete
from scanner_service.app import create_app
from scanner_service.storage import Store
from scanner_service.hosted import DailyBatch, attach_daily_route, capture_configuration, daily_batch, validate_hosted_settings
from scanner_service.tejhq import TERMS


class HostedSettings(unittest.TestCase):
    def settings(self):
        return {"SCANNER_JOB_MODE": "external", "SCANNER_DATABASE_URL": "postgresql+psycopg://fixture:fake@db.example.invalid/db?sslmode=require", "SCANNER_ADMIN_TOKEN": "a" * 32, "CRON_SECRET": "b" * 32}

    def test_tls_postgres_and_separate_strong_secrets_required(self):
        with patch.dict(os.environ, self.settings()):
            validate_hosted_settings()
        for change in [{"SCANNER_JOB_MODE": "embedded"}, {"SCANNER_DATABASE_URL": "sqlite:////tmp/no.sqlite"}, {"SCANNER_DATABASE_URL": "postgresql+psycopg://fixture:fake@db.example.invalid/db"}, {"CRON_SECRET": "a" * 32}, {"CRON_SECRET": "short"}]:
            with patch.dict(os.environ, {**self.settings(), **change}):
                with self.assertRaises(ValueError):
                    validate_hosted_settings()

    def test_optional_raw_capture_requires_current_permission_and_small_explicit_scope(self):
        today = datetime.now(timezone.utc).date()
        settings = {"SCANNER_TEJHQ_RAW_LISTINGS": "NSE:PNB,NSE:HDFCLIFE", "SCANNER_TEJHQ_TERMS_REVIEWED_ON": str(today), "SCANNER_TEJHQ_PERMISSION_REFERENCE": TERMS}
        with patch.dict(os.environ, settings):
            self.assertEqual(capture_configuration()[0], ["NSE:PNB", "NSE:HDFCLIFE"])
        for change in [{"SCANNER_TEJHQ_RAW_LISTINGS": "NSE:PNB,NSE:PNB"}, {"SCANNER_TEJHQ_RAW_LISTINGS": "NSE:A,NSE:B,NSE:C,NSE:D,NSE:E"}, {"SCANNER_TEJHQ_TERMS_REVIEWED_ON": str(today - timedelta(days=91))}, {"SCANNER_TEJHQ_TERMS_REVIEWED_ON": str(today + timedelta(days=1))}, {"SCANNER_TEJHQ_PERMISSION_REFERENCE": "unverified"}]:
            with patch.dict(os.environ, {**settings, **change}):
                with self.assertRaises(ValueError):
                    capture_configuration()


class HostedDailyBatch(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(os.getenv("SCANNER_TEST_DATABASE_URL", f"sqlite:///{self.temp.name}/hosted.sqlite3"))
        with self.store.session() as db:
            db.execute(delete(DailyBatch));db.commit()
        with patch.dict(os.environ, {"SCANNER_JOB_MODE": "external"}):
            self.app = attach_daily_route(create_app(self.store, token="fixture-admin-token"), self.store, "fixture-cron-token")
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer fixture-cron-token"}
        self.path = "/api/structure/internal/eod"
        self.env = patch.dict(os.environ, {"SCANNER_TEJHQ_RAW_LISTINGS": ""})
        self.env.start()

    def tearDown(self):
        self.env.stop();self.store.engine.dispose();self.temp.cleanup()

    def test_only_cron_secret_can_reserve_and_repeat_never_replays(self):
        with patch("scanner_service.hosted.run_pending", return_value={"processed": [], "provider_requests": 0}) as worker:
            for headers in [{}, {"Authorization": "Bearer fixture-admin-token"}]:
                self.assertEqual(self.client.get(self.path, headers=headers).status_code, 401)
            worker.assert_not_called()
            first = self.client.get(self.path, headers=self.headers)
            self.assertEqual(first.status_code, 200)
            self.assertFalse(first.json()["research_promotion"])
            self.assertEqual(first.json()["raw_capture"], "disabled")
            self.assertEqual(self.client.get(self.path, headers=self.headers).json()["state"], "already_reserved")
            self.assertEqual(worker.call_count, 1)
            self.assertEqual(self.client.get("/api/structure/market-data/status").status_code, 401)
            status = self.client.get("/api/structure/market-data/status", headers={"Authorization": "Bearer fixture-admin-token"})
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["daily_batch"]["state"], "complete")
            self.assertFalse(status.json()["daily_batch"]["research_promotion"])

    def test_failure_is_private_and_never_automatically_retried(self):
        with patch("scanner_service.hosted.run_pending", side_effect=RuntimeError("private-database-secret")) as worker:
            failed = self.client.get(self.path, headers=self.headers)
            self.assertEqual(failed.status_code, 503)
            self.assertNotIn("private-database-secret", failed.text)
            self.assertEqual(self.client.get(self.path, headers=self.headers).json()["state"], "already_reserved")
            self.assertEqual(worker.call_count, 1)
        with self.store.session() as db:
            record = db.get(DailyBatch, datetime.now(timezone.utc).date().isoformat())
            self.assertEqual(record.state, "failed")
            self.assertNotIn("private-database-secret", json.dumps(record.summary))

    def test_optional_capture_returns_no_prices_or_actions_and_never_promotes_inputs(self):
        before = self.store.datasets()
        today = str(datetime.now(timezone.utc).date())
        settings = {"SCANNER_TEJHQ_RAW_LISTINGS": "NSE:PNB", "SCANNER_TEJHQ_TERMS_REVIEWED_ON": today, "SCANNER_TEJHQ_PERMISSION_REFERENCE": TERMS}
        with patch.dict(os.environ, settings), patch("scanner_service.hosted.Client") as client, patch("scanner_service.hosted.capture_raw", return_value={"capture_id": "fixture-capture", "listings": [{"raw_actions": "private-action-data", "close": 123}]}), patch("scanner_service.hosted.run_pending", return_value={"processed": [], "provider_requests": 0}):
            result = self.client.get(self.path, headers=self.headers)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["raw_capture"], {"capture_id": "fixture-capture", "listings": 1})
            self.assertNotIn("private-action-data", result.text)
            self.assertNotIn("close", result.text)
            self.assertFalse(result.json()["research_promotion"])
            client.assert_called_once()
        self.assertEqual(self.store.datasets(), before)

    def test_invalid_capture_settings_do_not_contact_provider_or_reserve_day(self):
        with patch.dict(os.environ, {"SCANNER_TEJHQ_RAW_LISTINGS": "NSE:PNB", "SCANNER_TEJHQ_PERMISSION_REFERENCE": "unverified"}), patch("scanner_service.hosted.capture_raw") as capture:
            self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 503)
            capture.assert_not_called()
        with self.store.session() as db:
            self.assertIsNone(db.get(DailyBatch, datetime.now(timezone.utc).date().isoformat()))

    def test_postgres_concurrent_invocations_reserve_once(self):
        if self.store.engine.dialect.name != "postgresql":
            self.skipTest("Concurrent cron reservation requires PostgreSQL")
        with patch("scanner_service.hosted.run_pending", return_value={"processed": [], "provider_requests": 0}) as worker:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: daily_batch(self.store), range(2)))
            self.assertEqual(sorted(result["state"] for result in results), ["already_reserved", "complete"])
            self.assertEqual(worker.call_count, 1)
