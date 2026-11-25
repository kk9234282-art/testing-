import copy
import os
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from fastapi.testclient import TestClient
from scanner_service.schema import Bundle, Parameters, isin_valid
from scanner_service.demo import make_demo
from scanner_service.research import Context
from scanner_service.backtest import outcomes
from scanner_service.storage import Store
from scanner_service.app import create_app


class ImportAndPointInTime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = make_demo()

    def payload(self):
        return self.bundle.model_dump(mode="json")

    def test_identifiers_duplicates_ohlc_and_entity_exclusions(self):
        self.assertTrue(isin_valid("INE009A01021"))
        for mutate in [
            lambda d: d["bars"].append(d["bars"][0]),
            lambda d: d["bars"][0].update(high=1),
            lambda d: d["securities"][0].update(isin="INE000000009"),
            lambda d: d["bars"][0].update(is_final=False),
            lambda d: d["bars"][0].update(date="1900-01-01"),
        ]:
            d = self.payload()
            mutate(d)
            with self.assertRaises(ValueError):
                Bundle.model_validate(d)
        context = Context(self.bundle)
        rows = context.active(self.bundle.manifest.latest_complete_session)
        self.assertEqual(len(rows), 15)
        self.assertEqual(sum(s.security_id == "DEMO_02" for s, _ in rows), 1)
        self.assertNotIn("DEMO_ETF", [s.security_id for s, _ in rows])

    def test_future_master_fundamentals_and_membership_never_leak(self):
        context = Context(self.bundle)
        early = self.bundle.sessions[100]
        self.assertIsNone(context.fundamentals("DEMO_01", early))
        self.assertIsNotNone(context.fundamentals("DEMO_01", self.bundle.sessions[-1]))
        self.assertIn("DEMO_16", [s.security_id for s, _ in context.active(early)])
        self.assertNotIn(
            "DEMO_16",
            [s.security_id for s, _ in context.active(self.bundle.sessions[-1])],
        )
        d = self.payload()
        d["memberships"][0]["known_on"] = str(self.bundle.sessions[200])
        d["memberships"][0]["valid_from"] = str(self.bundle.sessions[200])
        changed = Context(Bundle.model_validate(d)).regime(early)
        report = next(i for i in changed["indices"] if i["index_id"] == "NIFTY_500")
        self.assertEqual(report["members"], 14)
        self.assertIsNone(report["score"])

    def test_future_name_and_sector_versions_do_not_rewrite_the_past(self):
        d = self.payload()
        old = d["securities"][0]
        new = copy.deepcopy(old)
        old["valid_to"] = str(self.bundle.sessions[200])
        new["valid_from"] = old["valid_to"]
        new["known_on"] = str(self.bundle.sessions[180])
        new["name"] = "Future company name"
        new["sector"] = "Future sector"
        d["securities"].append(new)
        c = Context(Bundle.model_validate(d))
        before = next(
            s
            for s, _ in c.active(self.bundle.sessions[100])
            if s.security_id == "DEMO_01"
        )
        after = next(
            s
            for s, _ in c.active(self.bundle.sessions[250])
            if s.security_id == "DEMO_01"
        )
        self.assertNotEqual(before.name, after.name)
        self.assertNotEqual(before.sector, after.sector)

    def test_split_adjustment_prefix_preserves_historical_signal_dates(self):
        c = Context(self.bundle)
        listing = "NSE:EXAMPLE01"
        early = self.bundle.sessions[220]
        late = self.bundle.sessions[-1]
        before = c.analysis(listing, early, Parameters())
        after = c.analysis(listing, late, Parameters())
        old = [(e["date"], e["type"]) for e in before["events"]]
        revised = [
            (e["date"], e["type"]) for e in after["events"] if e["date"] <= str(early)
        ]
        self.assertEqual(old, revised)
        self.assertAlmostEqual(
            c.frames(late)[listing].iloc[0].close,
            c.frames(early)[listing].iloc[0].close * 0.5,
        )

    def test_unverified_actions_and_overlapping_master_are_rejected(self):
        d = self.payload()
        d["actions"][0]["verified"] = False
        with self.assertRaises(ValueError):
            Bundle.model_validate(d)
        d = self.payload()
        d["securities"].append(d["securities"][0])
        with self.assertRaises(ValueError):
            Bundle.model_validate(d)

    def test_missing_session_withholds_stock_annotations_and_regime_coverage(self):
        d = self.payload()
        d["bars"] = [
            b
            for b in d["bars"]
            if not (
                b["listing_id"] == "NSE:EXAMPLE01"
                and b["date"] == str(self.bundle.sessions[100])
            )
        ]
        c = Context(Bundle.model_validate(d))
        with self.assertRaises(ValueError):
            c.stock("DEMO_01", self.bundle.sessions[-1], Parameters())
        self.assertEqual(len(c.gaps("NSE:EXAMPLE01", self.bundle.sessions[-1])), 1)

    def test_missing_benchmark_session_does_not_shrink_the_sma_window(self):
        d = self.payload()
        missing = str(self.bundle.sessions[-10])
        d["index_bars"] = [
            b
            for b in d["index_bars"]
            if not (b["index_id"] == "NIFTY_500" and b["date"] == missing)
        ]
        c = Context(Bundle.model_validate(d))
        report = next(
            i
            for i in c.regime(self.bundle.sessions[-1])["indices"]
            if i["index_id"] == "NIFTY_500"
        )
        self.assertIsNone(report["score"])

    def test_historical_cohorts_include_delisted_equities_without_dual_listing_duplicates(
        self,
    ):
        c = Context(self.bundle)
        result = outcomes(c, self.bundle.sessions[-1])
        self.assertTrue(any(t["security_id"] == "DEMO_16" for t in result["trades"]))
        self.assertFalse(any(t["listing_id"] == "BSE:590002" for t in result["trades"]))


class PersistenceAndAPI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.url = os.getenv(
            "SCANNER_TEST_DATABASE_URL", f"sqlite:///{self.temp.name}/research.sqlite3"
        )
        self.store = Store(self.url)
        bundle = make_demo().model_dump(mode="json")
        keep = {"NSE:EXAMPLE01"}
        bundle["securities"] = [
            s for s in bundle["securities"] if s["listing_id"] in keep
        ]
        bundle["bars"] = [b for b in bundle["bars"] if b["listing_id"] in keep][:120]
        bundle["sessions"] = bundle["sessions"][:120]
        bundle["manifest"]["latest_complete_session"] = bundle["sessions"][-1]
        bundle["actions"] = []
        bundle["benchmarks"] = []
        bundle["index_bars"] = []
        bundle["memberships"] = []
        bundle["fundamentals"] = []
        bundle["terminals"] = []
        self.bundle = Bundle.model_validate(bundle)
        self.app = create_app(self.store, "scanner-test-token")
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer scanner-test-token"}

    def tearDown(self):
        self.app.state.executor.shutdown(wait=True)
        self.store.engine.dispose()
        self.temp.cleanup()

    def test_private_auth_idempotent_import_and_completed_job(self):
        self.assertEqual(self.client.get("/api/structure/datasets").status_code, 401)
        self.assertEqual(self.client.get("/api/structure/health").status_code, 200)
        response = self.client.post(
            "/api/structure/import",
            headers=self.headers,
            json=self.bundle.model_dump(mode="json"),
        )
        self.assertEqual(response.status_code, 200, response.text)
        identity = response.json()["dataset_id"]
        self.assertEqual(self.store.save(self.bundle), identity)
        restored = Store(self.url)
        if restored:
            self.assertEqual(
                restored.load(identity).manifest.name, self.bundle.manifest.name
            )
            restored.engine.dispose()
        queued = self.client.post(
            "/api/structure/runs/scan",
            headers=self.headers,
            json={
                "dataset_id": identity,
                "as_of": str(self.bundle.manifest.latest_complete_session),
            },
        )
        self.assertEqual(queued.status_code, 202, queued.text)
        run_id = queued.json()["run_id"]
        result = None
        for _ in range(200):
            result = self.client.get(
                "/api/structure/runs/" + run_id, headers=self.headers
            ).json()
            if result["state"] in ("complete", "failed"):
                break
            time.sleep(0.02)
        self.assertEqual(result["state"], "complete", result)
        self.assertEqual(len(result["result"]["rows"]), 1)
        detail = self.client.get(
            f"/api/structure/runs/{run_id}/stocks/DEMO_01", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(len(detail.json()["series"]), 120)
        self.assertEqual(
            self.client.get("/api/structure/runs/" + run_id).status_code, 401
        )

    def test_bad_import_and_parameter_bounds(self):
        payload = self.bundle.model_dump(mode="json")
        payload["bars"][0]["close"] = -1
        self.assertEqual(
            self.client.post(
                "/api/structure/import", headers=self.headers, json=payload
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/structure/runs/scan",
                headers=self.headers,
                json={
                    "dataset_id": "a" * 64,
                    "as_of": "2025-01-01",
                    "parameters": {"pivot_right": 0},
                },
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/structure/import", headers=self.headers, content="x" * 3_000_001
            ).status_code,
            413,
        )


if __name__ == "__main__":
    unittest.main()
