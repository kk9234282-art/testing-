"""Small synthetic Parquet fixtures; never public copies of actual source data."""

import copy
import csv
import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from scanner_service.bulk_review import review, verified_files, main


@unittest.skipUnless(
    importlib.util.find_spec("pyarrow"),
    "Install requirements.bulk.txt for offline Parquet review tests",
)
class BulkReview(unittest.TestCase):
    def setUp(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.days = [date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 5)]
        self.rows = [
            {
                "date": d,
                "symbol": "TESTEQ",
                "isin": "INE160A01022",
                "series": "EQ",
                "year": 2024,
                "open": 100.0,
                "high": 103.0,
                "low": 99.0,
                "close": 102.0,
                "volume": 1000,
            }
            for d in self.days
        ]
        self.history = [
            {
                "exchange": "NSE",
                "symbol": "TESTEQ",
                "isin": "INE160A01022",
                "valid_from": date(2014, 12, 19),
                "valid_to": self.days[-1],
                "trading_days": 100,
            }
        ]
        self.actions = [
            {
                "exchange": "NSE",
                "symbol": "TESTEQ",
                "isin": "INE160A01014",
                "company": "TEST ONLY Synthetic Corp",
                "ex_date": self.days[1],
                "record_date": self.days[1],
                "type": "dividend",
                "cash_amount": 2.0,
                "raw_subject": "TEST ONLY fixture",
            }
        ]
        self.files = {}
        for name, rows in [
            ("nse/year=2024/nse_2024.parquet", self.rows),
            ("symbol_history/nse.parquet", self.history),
            ("actions/nse_2024.parquet", self.actions),
        ]:
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            pq.write_table(pa.Table.from_pylist(rows), p)
            self.files[name] = p
        self.manifest = self.root / "manifest.json"
        self.rehash()
        self.capture = self.root / "TESTEQ-ohlcv.json"
        self.capture.write_text(
            json.dumps(
                {
                    "data": [
                        {
                            k: (str(v) if k == "date" else v)
                            for k, v in r.items()
                            if k in ("date", "open", "high", "low", "close", "volume")
                        }
                        for r in self.rows
                    ],
                    "meta": {
                        "symbol": "TESTEQ",
                        "exchange": "NSE",
                        "count": 3,
                        "from": str(self.days[0]),
                        "to": str(self.days[-1]),
                    },
                }
            )
        )
        self.master = self.root / "master.csv"
        self.master.write_text(
            "SYMBOL,NAME OF COMPANY, ISIN NUMBER\nTESTEQ,TEST ONLY Synthetic Corp,INE160A01022\n"
        )

    def tearDown(self):
        self.temp.cleanup()

    def rehash(self):
        entries = []
        for name, p in self.files.items():
            digest = hashlib.sha256(p.read_bytes()).hexdigest()
            entries.append(
                {
                    "path": name,
                    "local": str(p),
                    "bytes": p.stat().st_size,
                    "sha256": digest,
                    "published_lfs_sha256": digest,
                    "repository_revision": "a" * 40,
                }
            )
        self.manifest.write_text(json.dumps(entries))

    def audit(self):
        return review(self.manifest, self.root, self.master, ["TESTEQ"])[0]

    def test_matching_raw_interfaces_allow_only_raw_view_with_no_invented_actions(self):
        result = self.audit()
        self.assertTrue(result["price_interfaces_match"])
        self.assertEqual(result["promotion"], "raw_view_only")
        self.assertEqual(result["observed_market_sessions"], 3)
        self.assertFalse(
            result["metadata_candidate"]["manifest"]["corporate_actions_complete"]
        )
        self.assertEqual(result["metadata_candidate"]["actions"], [])
        self.assertFalse(result["publication_timestamps_present"])
        self.assertEqual(len(result["stocks"][0]["source_action_isin_mismatches"]), 1)
        self.assertNotIn("known_on", result["action_evidence"][0])

    def test_realistic_hive_year_directory_and_embedded_year_column_are_supported(self):
        # The published files include `year` while their parent is `year=2024`.
        result = self.audit()
        self.assertEqual(result["stocks"][0]["bulk_candles"], 3)

    def test_shared_selected_stock_gap_is_found_using_full_market_dates(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        rows = self.rows + [dict(self.rows[0], date=date(2024, 1, 4), symbol="CONTROL")]
        pq.write_table(
            pa.Table.from_pylist(rows), self.files["nse/year=2024/nse_2024.parquet"]
        )
        self.rehash()
        result = self.audit()
        self.assertFalse(result["price_interfaces_match"])
        self.assertEqual(result["stocks"][0]["missing_api_sessions"], ["2024-01-04"])
        self.assertEqual(result["promotion"], "blocked")

    def test_changed_prices_and_duplicate_candles_are_not_silently_accepted(self):
        payload = json.loads(self.capture.read_text())
        payload["data"][0]["close"] = 101.5
        self.capture.write_text(json.dumps(payload))
        self.assertEqual(self.audit()["stocks"][0]["different_candles"], ["2024-01-02"])
        payload["data"].append(payload["data"][0])
        payload["meta"]["count"] = 4
        self.capture.write_text(json.dumps(payload))
        with self.assertRaisesRegex(ValueError, "Duplicate API"):
            self.audit()

    def test_requested_bounds_find_shared_missing_first_and_last_sessions(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        extra = [
            dict(self.rows[0], date=day, symbol="CONTROL")
            for day in (date(2024, 1, 1), date(2024, 1, 8))
        ]
        pq.write_table(
            pa.Table.from_pylist(self.rows + extra),
            self.files["nse/year=2024/nse_2024.parquet"],
        )
        self.rehash()
        payload = json.loads(self.capture.read_text())
        payload["meta"].update({"from": "2024-01-01", "to": "2024-01-08"})
        self.capture.write_text(json.dumps(payload))
        self.assertEqual(
            self.audit()["stocks"][0]["missing_api_sessions"],
            ["2024-01-01", "2024-01-08"],
        )

    def test_publication_field_is_preserved_but_does_not_auto_verify_actions(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        from datetime import datetime, timezone

        stamp = datetime(2023, 12, 15, 12, 30, tzinfo=timezone.utc)
        self.actions[0]["published_at"] = stamp
        pq.write_table(
            pa.Table.from_pylist(self.actions), self.files["actions/nse_2024.parquet"]
        )
        self.rehash()
        result = self.audit()
        self.assertTrue(result["publication_timestamps_present"])
        self.assertFalse(result["publication_timestamps_verified"])
        self.assertEqual(
            result["action_evidence"][0]["published_at"], stamp.isoformat()
        )
        self.assertFalse(
            result["metadata_candidate"]["manifest"]["corporate_actions_complete"]
        )

    def test_hash_size_revision_and_path_checks_precede_parquet_read(self):
        entries = json.loads(self.manifest.read_text())
        entries[0]["sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(entries))
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            verified_files(self.manifest)
        self.rehash()
        entries = json.loads(self.manifest.read_text())
        entries[0]["local"] = str(self.root.parent / "outside.parquet")
        self.manifest.write_text(json.dumps(entries))
        with self.assertRaisesRegex(ValueError, "escapes"):
            verified_files(self.manifest)
        self.rehash()
        entries = json.loads(self.manifest.read_text())
        entries[0]["repository_revision"] = "b" * 40
        self.manifest.write_text(json.dumps(entries))
        with self.assertRaisesRegex(ValueError, "one pinned"):
            verified_files(self.manifest)

    def test_file_budget_is_checked_before_loading_or_hashing_large_input(self):
        path = self.files["nse/year=2024/nse_2024.parquet"]
        with path.open("r+b") as stream:
            stream.truncate(25_000_001)
        with self.assertRaisesRegex(ValueError, "budget exceeded"):
            verified_files(self.manifest)

    def test_future_identity_and_missing_stock_ids_block_promotion(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        self.history[0]["valid_from"] = date(2024, 1, 3)
        pq.write_table(
            pa.Table.from_pylist(self.history), self.files["symbol_history/nse.parquet"]
        )
        self.rehash()
        result = self.audit()
        self.assertFalse(result["stocks"][0]["identity_source_consistent"])
        self.assertEqual(result["promotion"], "blocked")

    def test_bulk_duplicate_symbol_session_is_rejected(self):
        import pyarrow as pa
        import pyarrow.parquet as pq

        pq.write_table(
            pa.Table.from_pylist(self.rows + [self.rows[0]]),
            self.files["nse/year=2024/nse_2024.parquet"],
        )
        self.rehash()
        with self.assertRaisesRegex(ValueError, "Duplicate selected"):
            self.audit()

    def test_symbol_selection_and_capture_identity_are_explicit(self):
        with self.assertRaisesRegex(ValueError, "unique equity"):
            review(self.manifest, self.root, self.master, ["../SECRET"])
        payload = json.loads(self.capture.read_text())
        payload["meta"]["symbol"] = "OTHER"
        self.capture.write_text(json.dumps(payload))
        with self.assertRaisesRegex(ValueError, "identity/count"):
            self.audit()

    def test_action_interfaces_are_compared_without_approving_availability(self):
        path = self.root / "TESTEQ-actions.json"
        rows = [
            {k: v.isoformat() if isinstance(v, date) else v for k, v in row.items()}
            for row in self.actions
        ]
        path.write_text(
            json.dumps({"data": rows, "meta": {"symbol": "TESTEQ", "count": len(rows)}})
        )
        result = self.audit()
        self.assertTrue(result["stocks"][0]["action_interfaces_match"])
        self.assertFalse(result["publication_timestamps_verified"])
        rows[0]["cash_amount"] = 99
        path.write_text(
            json.dumps({"data": rows, "meta": {"symbol": "TESTEQ", "count": len(rows)}})
        )
        self.assertFalse(self.audit()["stocks"][0]["action_interfaces_match"])
        self.assertFalse(
            self.audit()["metadata_candidate"]["manifest"]["corporate_actions_complete"]
        )
