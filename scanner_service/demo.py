"""Deterministic fictional history, including a split and a delisted equity."""

import json
import math
from pathlib import Path
import pandas as pd
from .schema import Bundle, Parameters, isin_valid
from .research import Context, REQUIRED_INDICES
from .backtest import outcomes


def example_isin(prefix):
    return next(
        prefix + str(digit) for digit in range(10) if isin_valid(prefix + str(digit))
    )


def make_demo():
    sessions = [str(d.date()) for d in pd.bdate_range("2025-01-02", periods=390)]
    securities = []
    bars = []
    actions = []
    facts = []
    memberships = []
    index_bars = []
    sectors = ["Technology", "Industrials", "Financials", "Healthcare"]
    for n in range(16):
        sid = f"DEMO_{n+1:02d}"
        symbol = f"EXAMPLE{n+1:02d}"
        exchange = "NSE" if n < 12 else "BSE"
        listing = f"{exchange}:{symbol}"
        end = 345 if n == 15 else len(sessions)
        securities.append(
            {
                "security_id": sid,
                "listing_id": listing,
                "isin": example_isin(f"INE{n:08d}"),
                "name": f"Example {sectors[n%4]} {n+1:02d}",
                "exchange": exchange,
                "symbol": symbol,
                "sector": sectors[n % 4],
                "instrument_type": "EQUITY",
                "valid_from": sessions[0],
                "valid_to": sessions[end] if end < len(sessions) else None,
                "known_on": sessions[0],
            }
        )
        for i in range(end):
            # Long declining cycles followed by higher-low recovery; latest dates
            # differ by phase so the dashboard is not filled with a single label.
            phase = (i + n * 11) % 150
            base = (
                150
                + n * 11
                + (
                    -0.55 * phase
                    if phase < 65
                    else (
                        -35.75 + 0.9 * (phase - 65)
                        if phase < 125
                        else 18.25 - 0.35 * (phase - 125)
                    )
                )
                + 0.04 * i
            )
            close = max(15, base + 7 * math.sin(i * 0.36 + n * 0.2))
            open_ = close * (1 + 0.006 * math.sin(i * 1.7 + n))
            high = max(open_, close) + 1.3 + abs(math.sin(i * 0.7))
            low = min(open_, close) - 1.3 - abs(math.cos(i * 0.6))
            volume = 100000 + int(40000 * (1 + math.sin(i * 0.6 + n)))
            if i % 17 == n % 17:
                volume *= 2
            if n == 0 and i >= 230:
                open_ /= 2
                high /= 2
                low /= 2
                close /= 2
                volume *= 2
            bars.append(
                {
                    "listing_id": listing,
                    "date": sessions[i],
                    "open": round(open_, 4),
                    "high": round(high, 4),
                    "low": round(low, 4),
                    "close": round(close, 4),
                    "volume": volume,
                    "is_final": True,
                    "delivery_pct": 42 + n if n % 3 == 0 else None,
                    "delivery_verified": n % 3 == 0,
                }
            )
        if n == 0:
            actions.append(
                {
                    "listing_id": listing,
                    "effective_on": sessions[230],
                    "known_on": sessions[220],
                    "kind": "split",
                    "price_factor": 0.5,
                    "volume_factor": 2,
                    "cash_per_share": 0,
                    "reference": "Fictional 1-for-2 split",
                    "verified": True,
                }
            )
        facts.append(
            {
                "security_id": sid,
                "period_end": sessions[200],
                "known_on": sessions[220],
                "source": "Illustrative fictional financials",
                "values": {
                    "pe": 15 + n,
                    "roe_pct": 10 + n * 0.5,
                    "debt_equity": 0.2 + n * 0.03,
                },
            }
        )
        for index in REQUIRED_INDICES + ["NIFTY_TECHNOLOGY"]:
            if n < 15 and (index != "NIFTY_TECHNOLOGY" or n % 4 == 0):
                memberships.append(
                    {
                        "index_id": index,
                        "security_id": sid,
                        "valid_from": sessions[0],
                        "valid_to": None,
                        "known_on": sessions[0],
                    }
                )
    # The same economic security also has a BSE listing; counted only once.
    alias = {
        **securities[1],
        "exchange": "BSE",
        "symbol": "590002",
        "listing_id": "BSE:590002",
    }
    securities.append(alias)
    for bar in list(bars):
        if bar["listing_id"] == "NSE:EXAMPLE02":
            bars.append({**bar, "listing_id": alias["listing_id"]})
    securities.append(
        {
            "security_id": "DEMO_ETF",
            "listing_id": "NSE:EXAMPLEETF",
            "isin": example_isin("INF00000000"),
            "name": "Example excluded ETF",
            "exchange": "NSE",
            "symbol": "EXAMPLEETF",
            "sector": "Other",
            "instrument_type": "ETF",
            "valid_from": sessions[0],
            "valid_to": None,
            "known_on": sessions[0],
        }
    )
    benchmarks = []
    for j, index in enumerate(REQUIRED_INDICES + ["NIFTY_TECHNOLOGY"]):
        benchmarks.append(
            {
                "index_id": index,
                "name": index.replace("_", " ").title() + " (synthetic)",
                "role": "sector" if j == 5 else "broad",
                "expected_members": 4 if j == 5 else 15,
            }
        )
        for i, day in enumerate(sessions):
            index_bars.append(
                {
                    "index_id": index,
                    "date": day,
                    "close": 10000 + 7 * i + 250 * math.sin(i * 0.06 + j),
                }
            )
    terminal = {
        "listing_id": securities[15]["listing_id"],
        "date": sessions[344],
        "cash_per_share": bars[
            next(
                i
                for i, b in enumerate(bars)
                if b["listing_id"] == securities[15]["listing_id"]
                and b["date"] == sessions[344]
            )
        ]["close"],
        "reference": "Fictional cash delisting settlement",
    }
    return Bundle.model_validate(
        {
            "manifest": {
                "name": "Illustrative EOD research lab",
                "source": "Deterministic synthetic fixtures; not actual NSE/BSE prices",
                "kind": "sample",
                "license_reference": "Synthetic test data generated by this project",
                "ohlcv_basis": "raw",
                "latest_complete_session": sessions[-1],
                "universe_history_complete": True,
                "corporate_actions_complete": True,
                "notes": "Fictional weekday calendar and constituents. Index labels identify calculation roles, not real constituent coverage.",
            },
            "sessions": sessions,
            "securities": securities,
            "bars": bars,
            "actions": actions,
            "benchmarks": benchmarks,
            "index_bars": index_bars,
            "memberships": memberships,
            "fundamentals": facts,
            "terminals": [terminal],
        }
    )


def build_public():
    bundle = make_demo()
    context = Context(bundle)
    day = bundle.manifest.latest_complete_session
    p = Parameters()
    print("Calculating end-of-day scan…", flush=True)
    scan = context.scan(day, p)
    print("Calculating historical cohorts…", flush=True)
    backtest = outcomes(context, day, p)
    details = {
        s.security_id: context.stock(s.security_id, day, p)
        for s, _ in context.active(day)
    }
    target = Path(__file__).resolve().parents[1] / "public"
    (target / "structure-demo.json").write_text(
        json.dumps(
            {"scan": scan, "backtest": backtest, "stocks": details},
            allow_nan=False,
            separators=(",", ":"),
        )
    )
    (target / "structure-import-example.json").write_text(bundle.model_dump_json())
    (target / "structure-import-schema.json").write_text(
        json.dumps(Bundle.model_json_schema(), indent=2)
    )
    print(scan["counts"], len(backtest["trades"]), "cohort outcomes", flush=True)


if __name__ == "__main__":
    build_public()
