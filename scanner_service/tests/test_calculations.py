import unittest
from datetime import date
from types import SimpleNamespace as NS
import numpy as np
import pandas as pd
from scanner_service.indicators import indicators, wilder
from scanner_service.schema import Parameters
from scanner_service.structure import analyse
from scanner_service.backtest import outcomes


def frame(closes):
    c = np.array(closes, dtype=float)
    return pd.DataFrame(
        {"open": c, "high": c + 1, "low": c - 1, "close": c, "volume": 100.0},
        index=pd.bdate_range("2025-01-02", periods=len(c)),
    )


class Indicators(unittest.TestCase):
    def test_wilder_seed_and_reference_values(self):
        f = indicators(frame(np.arange(100, 340)))
        self.assertTrue(np.isnan(f.atr.iloc[12]))
        self.assertAlmostEqual(f.atr.iloc[13], 2)
        self.assertAlmostEqual(f.sma50.iloc[49], 124.5)
        self.assertAlmostEqual(f.sma200.iloc[199], 199.5)
        self.assertEqual(f.rsi14.iloc[14], 100)
        self.assertAlmostEqual(f.adx14.iloc[28], 100)
        self.assertAlmostEqual(f.macd.iloc[-1], 7, places=5)

    def test_flat_rsi_and_missing_warmups(self):
        f = indicators(frame([100] * 40))
        self.assertEqual(f.rsi14.iloc[-1], 50)
        self.assertEqual(f.adx14.iloc[-1], 0)
        self.assertTrue(np.isnan(f.sma50.iloc[-1]))
        self.assertTrue(np.isnan(f.sma200.iloc[-1]))
        self.assertEqual(indicators(frame(range(200, 160, -1))).rsi14.iloc[-1], 0)

    def test_volume_excludes_current_bar_and_rs_uses_matching_history(self):
        f = frame(100 * 1.01 ** np.arange(100))
        f.iloc[-1, f.columns.get_loc("volume")] = 200
        benchmark = pd.Series(100 * 1.005 ** np.arange(100), index=f.index)
        output = indicators(f, benchmark)
        self.assertEqual(output.volume_ratio.iloc[-1], 2)
        self.assertAlmostEqual(output.rs63.iloc[-1], (1.01**63 - 1.005**63) * 100)
        self.assertTrue(output.rs63.iloc[:63].isna().all())

    def test_relative_strength_does_not_compare_dividend_total_return_to_price_index(
        self,
    ):
        f = frame([95] * 100)
        f["relative_close"] = [100] * 50 + [95] * 50
        result = indicators(f, pd.Series(100.0, index=f.index))
        self.assertAlmostEqual(result.rs63.iloc[-1], -5)


class CausalStructure(unittest.TestCase):
    def setUp(self):
        self.f = frame(
            [130 - i * 0.8 for i in range(18)]
            + [
                114,
                116,
                120,
                116,
                112,
                108,
                112,
                116,
                110,
                106,
                102,
                106,
                110,
                105,
                100,
                104,
                109,
                113,
                121,
                118,
                114,
                118,
                123,
                119,
                116,
                120,
                126,
                124,
                119,
                123,
                128,
                126,
                121,
                125,
                130,
                128,
                122,
                126,
                132,
                130,
                124,
                128,
                134,
                132,
                125,
                130,
                136,
            ]
        )
        self.p = Parameters(pivot_left=2, pivot_right=2, swing_atr=0.25, break_atr=0)

    def test_pivots_only_exist_on_confirmation_session(self):
        full = analyse(self.f, self.p)
        self.assertGreater(len(full["pivots"]), 5)
        for pivot in full["pivots"]:
            pivot_pos = self.f.index.get_loc(pivot["pivot_date"])
            known_pos = self.f.index.get_loc(pivot["confirmed_on"])
            self.assertEqual(known_pos - pivot_pos, 2)
            self.assertNotIn(
                pivot["id"],
                {p["id"] for p in analyse(self.f.iloc[:known_pos], self.p)["pivots"]},
            )

    def test_no_repainting_for_every_prefix(self):
        full = analyse(self.f, self.p)
        for end in range(20, len(self.f) + 1):
            prefix = analyse(self.f.iloc[:end], self.p)
            self.assertEqual(prefix["timeline"], full["timeline"][:end])
            known = str(self.f.index[end - 1].date())
            self.assertEqual(
                prefix["events"], [e for e in full["events"] if e["date"] <= known]
            )

    def test_structure_not_indicators_creates_confirmation(self):
        monotonic = frame(100 * 1.01 ** np.arange(260))
        monotonic["volume"] = np.arange(260) + 100
        output = analyse(monotonic, benchmark=pd.Series(100.0, index=monotonic.index))
        self.assertFalse(
            any(
                r["status"] in ("Confirmed Bullish", "Strong Bullish")
                for r in output["timeline"]
            )
        )
        output = analyse(self.f, self.p)
        events = [e for e in output["events"] if e["type"] == "CHOCH_UP"]
        self.assertGreater(len(events), 0)
        states = [r for r in output["timeline"] if r["confirmation_date"]]
        self.assertGreater(len(states), 0)
        self.assertLess(
            states[0]["initial_signal_date"], states[0]["confirmation_date"]
        )

    def test_retests_and_failed_breakouts_are_later_close_confirmed_events(self):
        output = analyse(self.f, self.p)
        signal = next(
            event for event in output["events"] if event["type"] == "CHOCH_UP"
        )
        pos = self.f.index.get_loc(signal["date"])
        for failed in (False, True):
            prefix = self.f.iloc[: pos + 2].copy()
            level = signal["level"]
            close = level - 3 if failed else level + 0.2
            prefix.iloc[-1] = [
                close,
                max(close, level) + 1,
                min(close, level) - 0.5,
                close,
                100,
            ]
            events = analyse(prefix, self.p)["events"]
            target = "FAILED_BREAKOUT" if failed else "RETEST"
            event = next(
                item
                for item in events
                if item["type"] == target and item["episode"] == signal["episode"]
            )
            self.assertGreater(event["date"], signal["date"])

    def test_uniform_price_volume_rebasing_preserves_dates(self):
        a = analyse(self.f, self.p)
        f = self.f.copy()
        f[["open", "high", "low", "close"]] *= 0.5
        f["volume"] *= 2
        b = analyse(f, self.p)
        self.assertEqual(
            [(e["date"], e["type"]) for e in a["events"]],
            [(e["date"], e["type"]) for e in b["events"]],
        )


class CohortContext:
    def __init__(self, actions=False, missing=False, terminal=False):
        self.sessions = [d.date() for d in pd.bdate_range("2025-01-02", periods=90)]
        self.security = NS(
            security_id="EQ1", listing_id="NSE:ONE", instrument_type="EQUITY"
        )
        self.bundle = NS(
            manifest=NS(
                universe_history_complete=True,
                corporate_actions_complete=True,
                latest_complete_session=self.sessions[-1],
            ),
            securities=[self.security],
            actions=[],
            terminals=[],
        )
        f = frame([100] * 90)
        if actions:
            f.iloc[30:, f.columns.get_indexer(["open", "high", "low", "close"])] *= 0.5
            f.iloc[40:, f.columns.get_indexer(["open", "high", "low", "close"])] -= 5
            self.bundle.actions = [
                NS(
                    listing_id="NSE:ONE",
                    effective_on=self.sessions[30],
                    kind="split",
                    price_factor=0.5,
                ),
                NS(
                    listing_id="NSE:ONE",
                    effective_on=self.sessions[40],
                    kind="dividend",
                    cash_per_share=5,
                ),
            ]
        if missing:
            f = f.drop(f.index[25])
        if terminal:
            f = f.iloc[:25]
            self.bundle.terminals = [
                NS(listing_id="NSE:ONE", date=self.sessions[25], cash_per_share=80)
            ]
        self.raw = {"NSE:ONE": f}

    def analysis(self, *args):
        day = str(self.sessions[10])
        return {
            "timeline": [
                {"initial_signal_date": day, "confirmation_date": day, "episode": day}
            ],
            "events": [],
        }

    def active(self, day):
        return [(self.security, ["NSE"])]

    def gaps(self, *args):
        return []

    def regime(self, day):
        return {
            "indices": [
                {
                    "index_id": "NIFTY_500",
                    "regime": "Defensive" if day == self.sessions[10] else "Risk-on",
                }
            ]
        }


class HistoricalOutcomes(unittest.TestCase):
    def test_entry_is_next_session_and_friction_is_not_ignored(self):
        c = CohortContext()
        r = outcomes(c, c.sessions[-1], fee_bps=10, slippage_bps=5)
        expected = ((1 - 0.0005) * (1 - 0.001) / ((1 + 0.0005) * (1 + 0.001)) - 1) * 100
        for trade in r["trades"]:
            self.assertEqual(trade["entry_date"], str(c.sessions[11]))
            self.assertAlmostEqual(trade["return_pct"], expected, places=5)
            self.assertEqual(trade["regime"], "Defensive")

    def test_split_and_dividend_conserve_economic_value(self):
        c = CohortContext(actions=True)
        r = outcomes(c, c.sessions[-1], fee_bps=0, slippage_bps=0)
        for trade in r["trades"]:
            self.assertAlmostEqual(trade["return_pct"], 0)
            self.assertAlmostEqual(trade["drawdown_pct"], 0)

    def test_entry_on_ex_date_does_not_receive_prior_entitlements(self):
        for kind in ("split", "dividend"):
            c = CohortContext()
            if kind == "split":
                c.raw["NSE:ONE"].iloc[
                    11:,
                    c.raw["NSE:ONE"].columns.get_indexer(
                        ["open", "high", "low", "close"]
                    ),
                ] *= 0.5
                c.bundle.actions = [
                    NS(
                        listing_id="NSE:ONE",
                        effective_on=c.sessions[11],
                        kind="split",
                        price_factor=0.5,
                    )
                ]
            else:
                c.raw["NSE:ONE"].iloc[
                    11:,
                    c.raw["NSE:ONE"].columns.get_indexer(
                        ["open", "high", "low", "close"]
                    ),
                ] -= 5
                c.bundle.actions = [
                    NS(
                        listing_id="NSE:ONE",
                        effective_on=c.sessions[11],
                        kind="dividend",
                        cash_per_share=5,
                    )
                ]
            self.assertTrue(
                all(
                    t["return_pct"] == 0
                    for t in outcomes(c, c.sessions[-1], fee_bps=0, slippage_bps=0)[
                        "trades"
                    ]
                )
            )

    def test_simultaneous_split_and_dividend_use_post_split_share_basis(self):
        c = CohortContext()
        c.raw["NSE:ONE"].iloc[
            30:, c.raw["NSE:ONE"].columns.get_indexer(["open", "high", "low", "close"])
        ] = 45
        # Deliberately reverse input order to exercise deterministic action order.
        c.bundle.actions = [
            NS(
                listing_id="NSE:ONE",
                effective_on=c.sessions[30],
                kind="dividend",
                cash_per_share=5,
            ),
            NS(
                listing_id="NSE:ONE",
                effective_on=c.sessions[30],
                kind="split",
                price_factor=0.5,
            ),
        ]
        self.assertTrue(
            all(
                t["return_pct"] == 0
                for t in outcomes(c, c.sessions[-1], fee_bps=0, slippage_bps=0)[
                    "trades"
                ]
            )
        )

    def test_delisting_cash_loss_is_included(self):
        c = CohortContext(terminal=True)
        r = outcomes(c, c.sessions[-1], fee_bps=0, slippage_bps=0)
        self.assertTrue(all(t["return_pct"] == -20 for t in r["trades"]))

    def test_gaps_and_unmatured_horizons_are_censored(self):
        c = CohortContext(missing=True)
        r = outcomes(c, c.sessions[-1])
        self.assertTrue(all(t["return_pct"] is None for t in r["trades"]))
        self.assertTrue(
            all(row["completed"] == 0 and row["censored"] == 1 for row in r["summary"])
        )
        c = CohortContext()
        r = outcomes(c, c.sessions[40])
        self.assertEqual(r["summary"][0]["completed"], 1)
        self.assertEqual(r["summary"][1]["censored"], 1)

    def test_zero_volume_cannot_invent_an_entry_or_exit(self):
        c = CohortContext()
        c.raw["NSE:ONE"].iloc[11, c.raw["NSE:ONE"].columns.get_loc("volume")] = 0
        self.assertTrue(
            all(t["return_pct"] is None for t in outcomes(c, c.sessions[-1])["trades"])
        )
        c = CohortContext()
        c.raw["NSE:ONE"].iloc[30, c.raw["NSE:ONE"].columns.get_loc("volume")] = 0
        results = outcomes(c, c.sessions[-1])["trades"]
        self.assertIsNone(results[0]["return_pct"])
        self.assertIsNotNone(results[1]["return_pct"])

    def test_future_or_non_session_asof_is_rejected(self):
        c = CohortContext()
        with self.assertRaises(ValueError):
            outcomes(c, date(2030, 1, 1))

    def test_incomplete_source_history_blocks_a_backtest(self):
        c = CohortContext()
        c.bundle.manifest.universe_history_complete = False
        with self.assertRaises(ValueError):
            outcomes(c, c.sessions[-1])


if __name__ == "__main__":
    unittest.main()
