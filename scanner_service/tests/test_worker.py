import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from scanner_service.app import create_app
from scanner_service.demo import make_demo
from scanner_service.schema import Bundle
from scanner_service.storage import Store
from scanner_service.worker import run_pending


class BatchWorker(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(os.getenv("SCANNER_TEST_DATABASE_URL", f"sqlite:///{self.temp.name}/worker.sqlite3"))
        # Shared PostgreSQL fixture DB: retire only test jobs before this case.
        from scanner_service.storage import Run
        from sqlalchemy import select
        with self.store.session() as db:
            for run in db.scalars(select(Run).where(Run.state.in_(["queued", "running"]))):
                run.state = "failed"
                run.error = "Disposable worker fixture reset"
            db.commit()
        data = make_demo().model_dump(mode="json")
        data["sessions"] = data["sessions"][:120]
        data["securities"] = [s for s in data["securities"] if s["listing_id"] == "NSE:EXAMPLE01"]
        data["bars"] = [b for b in data["bars"] if b["listing_id"] == "NSE:EXAMPLE01" and b["date"] in data["sessions"]]
        for field in ["actions", "benchmarks", "index_bars", "memberships", "fundamentals", "terminals"]:
            data[field] = []
        data["manifest"]["latest_complete_session"] = data["sessions"][-1]
        data["manifest"]["name"] = "Disposable external worker fixture"
        self.bundle = Bundle.model_validate(data)
        self.dataset = self.store.save(self.bundle)
        self.request = {"dataset_id": self.dataset, "as_of": str(self.bundle.manifest.latest_complete_session)}

    def tearDown(self):
        self.store.engine.dispose()
        self.temp.cleanup()

    def queue(self, kind="scan", request=None):
        return self.store.create_run(self.dataset, kind, request or self.request)

    def test_external_api_keeps_queued_and_running_work_on_restart(self):
        queued = self.queue()
        running = self.queue()
        self.store.update(running, state="running")
        with patch.dict(os.environ, {"SCANNER_JOB_MODE": "external"}):
            for _ in range(2):
                app = create_app(self.store, token="external-fixture-token")
                self.assertIsNone(app.state.executor)
                self.assertEqual(TestClient(app).get("/api/structure/health").json()["job_mode"], "external")
        self.assertEqual(self.store.get_run(queued)["state"], "queued")
        self.assertEqual(self.store.get_run(running)["state"], "running")

    def test_external_api_auth_queue_then_worker_executes_once(self):
        with patch.dict(os.environ, {"SCANNER_JOB_MODE": "external"}):
            client = TestClient(create_app(self.store, token="external-fixture-token"))
        self.assertEqual(client.post("/api/structure/runs/scan", json=self.request).status_code, 401)
        response = client.post("/api/structure/runs/scan", json=self.request, headers={"Authorization": "Bearer external-fixture-token"})
        self.assertEqual(response.status_code, 202)
        identity = response.json()["run_id"]
        self.assertEqual(self.store.get_run(identity)["state"], "queued")
        result = run_pending(self.store)
        self.assertEqual(result["processed"], [{"run_id": identity, "state": "complete"}])
        self.assertEqual(result["provider_requests"], 0)
        self.assertEqual(len(self.store.get_run(identity)["result"]["rows"]), 1)
        self.assertEqual(run_pending(self.store)["processed"], [])

    def test_real_unverified_scan_and_backtest_keep_existing_gates(self):
        data = self.bundle.model_dump(mode="json")
        data["manifest"].update(kind="licensed", corporate_actions_complete=False, universe_history_complete=False)
        self.dataset = self.store.save(Bundle.model_validate(data))
        self.request["dataset_id"] = self.dataset
        scan, backtest = self.queue(), self.queue("backtest")
        run_pending(self.store)
        row = self.store.get_run(scan)["result"]["rows"][0]
        self.assertIsNone(row["status"])
        self.assertIsNone(row["initial_signal_date"])
        self.assertIsNone(row["ema20"])
        self.assertEqual(self.store.get_run(backtest)["state"], "failed")
        self.assertIsNone(self.store.get_run(backtest)["result"])

    def test_worker_start_budget_and_count_bounds_leave_unclaimed_work(self):
        first, second = self.queue(), self.queue()
        result = run_pending(self.store, max_jobs=1)
        self.assertEqual(len(result["processed"]), 1)
        remaining = [self.store.get_run(identity)["state"] for identity in [first, second]]
        self.assertEqual(sorted(remaining), ["complete", "queued"])
        for count, budget in [(0, 300), (21, 300), (1, 0), (1, 3601)]:
            with self.assertRaises(ValueError):
                run_pending(self.store, count, budget)

    def test_crashed_running_job_is_not_replayed(self):
        identity = self.queue()
        self.store.claim_run()
        self.assertEqual(run_pending(self.store)["processed"], [])
        self.assertEqual(self.store.get_run(identity)["state"], "running")

    def test_interrupted_recovery_does_not_touch_queued_or_completed_jobs(self):
        identity = self.queue()
        with self.assertRaises(ValueError):
            self.store.fail_interrupted(identity)
        self.store.claim_run()
        self.store.fail_interrupted(identity)
        self.assertEqual(self.store.get_run(identity)["state"], "failed")
        with self.assertRaises(ValueError):
            self.store.fail_interrupted(identity)
        done = self.queue()
        run_pending(self.store)
        with self.assertRaises(ValueError):
            self.store.fail_interrupted(done)
        self.assertEqual(self.store.get_run(done)["state"], "complete")

    def test_bad_stored_request_fails_without_stopping_batch(self):
        identity = self.queue(request={"dataset_id": "bad", "secret_field": "never-log-this"})
        good = self.queue()
        run_pending(self.store)
        result = self.store.get_run(identity)
        self.assertEqual(result["state"], "failed")
        self.assertNotIn("never-log-this", result["error"])
        self.assertEqual(self.store.get_run(good)["state"], "complete")

    def test_multiple_postgres_workers_claim_distinct_jobs(self):
        if self.store.engine.dialect.name != "postgresql":
            self.skipTest("Concurrent claims require the PostgreSQL integration fixture")
        expected = {self.queue(), self.queue()}
        with ThreadPoolExecutor(max_workers=2) as pool:
            claimed = list(pool.map(lambda _: self.store.claim_run(), range(2)))
        self.assertEqual({item["id"] for item in claimed}, expected)
        self.assertIsNone(self.store.claim_run())

    def test_postgres_queue_admission_is_bounded_across_instances(self):
        if self.store.engine.dialect.name != "postgresql":
            self.skipTest("Concurrent admission requires the PostgreSQL integration fixture")
        def admit(_):
            try:
                return self.queue()
            except ValueError:
                return None
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(admit, range(4)))
        self.assertEqual(sum(value is not None for value in results), 2)
