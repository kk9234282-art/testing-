"""Audits imported prices without fitting the algorithm to example dates."""

from collections import defaultdict
from datetime import date
import numpy as np
from .schema import Parameters
from .research import Context, active_interval
from .backtest import outcomes
from .structure import analyse, number, BULLISH
from .version import provenance
from .quality import needs_action_review

EXAMPLES = ("PNB", "HDFCLIFE", "PTCIL", "KIRLOSENG")


def validate_history(bundle, day=None, symbols=EXAMPLES, every_prefix=False):
    day = day or bundle.manifest.latest_complete_session
    context, parameters = Context(bundle), Parameters()
    if day not in bundle.sessions or day > bundle.manifest.latest_complete_session:
        raise ValueError("Choose a finalized imported session")
    records = []
    for symbol in symbols:
        selected = next((s for s, _ in context.active(day) if s.symbol == symbol), None)
        if selected is None:
            records.append(
                {
                    "symbol": symbol,
                    "verified": False,
                    "reason": "No imported active equity with this symbol; no dates/prices inferred",
                }
            )
            continue
        if needs_action_review(bundle.manifest.model_dump()):
            raw = context.raw.get(selected.listing_id)
            records.append(
                {
                    "symbol": symbol,
                    "listing_id": selected.listing_id,
                    "verified": False,
                    "reason": "Actual raw history imported; corporate-action availability/factors unverified. Structural dates and prefix validation withheld; no invented known_on timestamps.",
                    "raw_prices": (
                        []
                        if raw is None
                        else [
                            {
                                "date": str(d.date()),
                                **{
                                    k: float(row[k])
                                    for k in ("open", "high", "low", "close", "volume")
                                },
                            }
                            for d, row in raw.loc[: str(day)].iterrows()
                        ]
                    ),
                }
            )
            continue
        gaps = context.gaps(selected.listing_id, day)
        if gaps:
            records.append(
                {
                    "symbol": symbol,
                    "verified": False,
                    "reason": "Missing candles; structure validation withheld",
                    "missing_sessions": list(map(str, gaps)),
                }
            )
            continue
        analysis = context.analysis(selected.listing_id, day, parameters)
        if not analysis:
            records.append(
                {"symbol": symbol, "verified": False, "reason": "No imported candles"}
            )
            continue
        frame, episodes = analysis["frame"], []
        starts = sorted(
            {
                s["initial_signal_date"]
                for s in analysis["timeline"]
                if s["initial_signal_date"]
            }
        )
        for start in starts:
            states = [s for s in analysis["timeline"] if s["episode"] == start]
            events = [e for e in analysis["events"] if e["episode"] == start]
            confirmed = next(
                (s["confirmation_date"] for s in states if s["confirmation_date"]), None
            )
            first_developing = next(
                (s["date"] for s in states if s["status"] == "Structure Developing"),
                None,
            )
            # HL's availability is its confirmed_on date, never the earlier pivot date.
            higher_low = next(
                (
                    p
                    for p in analysis["pivots"]
                    if p["label"] == "HL"
                    and start < p["confirmed_on"]
                    and (not confirmed or p["confirmed_on"] <= confirmed)
                    and p["confirmed_on"] <= states[-1]["date"]
                ),
                None,
            )
            first_strong = next(
                (s["date"] for s in states if s["status"] == "Strong Bullish"), None
            )
            signal_day = confirmed or start
            metrics = frame.loc[signal_day]
            episodes.append(
                {
                    "initial_reversal_date": start,
                    "first_higher_low": higher_low,
                    "first_developing_date": first_developing,
                    "first_bos_date": next(
                        (e["date"] for e in events if e["type"] == "BOS_UP"), None
                    ),
                    "confirmed_bullish_date": confirmed,
                    "strong_trend_date": first_strong,
                    "measurement_date": signal_day,
                    "raw_close": number(metrics.raw_close),
                    "volume_ratio": number(metrics.volume_ratio),
                    "volume_confirmation_1_2x": bool(
                        number(metrics.volume_ratio) is not None
                        and metrics.volume_ratio >= 1.2
                    ),
                    "relative_strength_63_sessions_pp": number(metrics.rs63),
                    "events": events,
                }
            )
        # Historical actions after an earlier as-of rebase old levels. Compare causal
        # decisions/labels/dates, not absolute rebased price levels.
        checkpoints = (
            list(frame.index.date)
            if every_prefix
            else sorted(
                {date.fromisoformat(e["date"]) for e in analysis["events"]} | {day}
            )
        )
        checks = 0
        for cut in checkpoints:
            if cut > day:
                continue
            prefix_frame = context.frames(cut)[selected.listing_id]
            prefix = analyse(prefix_frame, parameters, context.benchmark(cut))

            def decisions(data, end):
                return [
                    {k: e.get(k) for k in ("type", "date", "episode", "status")}
                    for e in data["events"]
                    if e["date"] <= str(end)
                ]

            def pivots(data, end):
                return [
                    {
                        k: p[k]
                        for k in ("id", "kind", "label", "pivot_date", "confirmed_on")
                    }
                    for p in data["pivots"]
                    if p["confirmed_on"] <= str(end)
                ]

            if decisions(prefix, cut) != decisions(analysis, cut) or pivots(
                prefix, cut
            ) != pivots(analysis, cut):
                raise ValueError(f"Historical prefix invariance failed: {symbol} {cut}")
            if any(p["confirmed_on"] > str(cut) for p in prefix["pivots"]):
                raise ValueError("Future pivot available in prefix")
            checks += 1
        prices = [
            {
                "date": str(d.date()),
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for d, row in context.raw[selected.listing_id].loc[: str(day)].iterrows()
        ]
        records.append(
            {
                "symbol": symbol,
                "listing_id": selected.listing_id,
                "verified": True,
                "verification_scope": "Calculations reproduced from supplied source; price accuracy and completeness depend on source evidence, not independently certified",
                "raw_prices": prices,
                "episodes": episodes,
                "prefix_checkpoints_passed": checks,
                "prefix_mode": (
                    "every session" if every_prefix else "event sessions plus as-of"
                ),
                "latest": analysis["latest"],
                "pivots": analysis["pivots"],
            }
        )
    result = {
        "as_of": str(day),
        "source": bundle.manifest.model_dump(mode="json"),
        "provenance": provenance(),
        "sample_data": bundle.manifest.kind == "sample",
        "stocks": records,
        "method": "Original default parameters; no dates fitted. Volume threshold 1.2x is a confirmation cohort, not a new entry rule. Prices are raw INR; annotations use existing effective action factors.",
    }
    # Do not weaken the existing completeness gate just to obtain attractive results.
    if (
        not bundle.manifest.universe_history_complete
        or not bundle.manifest.corporate_actions_complete
    ):
        result["backtests"] = {
            "state": "blocked",
            "reason": "Historical universe and corporate-action completeness not attested; no survivorship-safe claims",
        }
    else:
        reports = {}
        for signal in ("initial", "confirmed"):
            backtest = outcomes(context, day, parameters, signal)
            cohorts = defaultdict(list)
            for trade in backtest["trades"]:
                a = context.analysis(
                    trade["listing_id"],
                    date.fromisoformat(trade["signal_date"]),
                    parameters,
                )
                ratio = number(a["frame"].iloc[-1].volume_ratio)
                group = (
                    "volume_unavailable"
                    if ratio is None
                    else "volume_ge_1_2" if ratio >= 1.2 else "volume_lt_1_2"
                )
                cohorts[(trade["horizon"], group)].append(trade)
            comparison = []
            for (horizon, group), trades in sorted(cohorts.items()):
                complete = [t for t in trades if t["return_pct"] is not None]
                comparison.append(
                    {
                        "horizon": horizon,
                        "cohort": group,
                        "signals": len(trades),
                        "completed": len(complete),
                        "censored": len(trades) - len(complete),
                        "mean_return_pct": (
                            float(np.mean([t["return_pct"] for t in complete]))
                            if complete
                            else None
                        ),
                        "win_rate_pct": (
                            sum(t["return_pct"] > 0 for t in complete)
                            / len(complete)
                            * 100
                            if complete
                            else None
                        ),
                        "worst_trade_drawdown_pct": min(
                            (t["drawdown_pct"] for t in complete), default=None
                        ),
                        "failed_breakout_pct": (
                            sum(t["failed_breakout"] for t in complete)
                            / len(complete)
                            * 100
                            if complete
                            else None
                        ),
                    }
                )
            reports[signal] = {**backtest, "volume_cohorts": comparison}
        result["backtests"] = reports
    return result


def supplementary_breadth(bundle, day):
    """Extra requested diagnostics; does not alter existing regime score weights."""
    context = Context(bundle)
    if day not in bundle.sessions or day > bundle.manifest.latest_complete_session:
        raise ValueError("Choose a finalized imported session")
    scan = context.scan(day, Parameters())
    rows = {r["security_id"]: r for r in scan["rows"]}
    frames, reports = context.frames(day), []
    for index in bundle.benchmarks:
        members = {
            m.security_id
            for m in bundle.memberships
            if m.index_id == index.index_id and active_interval(m, day)
        }
        eligible, above = 0, 0
        for sid in members:
            row = rows.get(sid)
            f = frames.get(row["listing_id"]) if row else None
            if f is None or row["data_quality"] != "Complete" or len(f) < 20:
                continue
            closes = f.relative_close
            eligible += 1
            above += int(
                closes.iloc[-1]
                > closes.ewm(span=20, adjust=False, min_periods=20).mean().iloc[-1]
            )
        original = next(
            r for r in scan["regime"]["indices"] if r["index_id"] == index.index_id
        )
        reports.append(
            {
                **original,
                "above20_ema_pct": above / eligible * 100 if eligible else None,
                "above20_eligible": eligible,
                "advance_decline_ratio": (
                    original["advances"] / original["declines"]
                    if original["declines"]
                    else None
                ),
                "zero_declines": original["declines"] == 0,
                "bullish_structure_count": sum(
                    rows[s]["status"] in BULLISH for s in members if s in rows
                ),
                "bearish_structure_count": sum(
                    rows[s]["status"] == "Bearish" for s in members if s in rows
                ),
            }
        )
    sectors = []
    for sector in sorted({r["sector"] for r in rows.values()}):
        values = [
            r["rs63"]
            for r in rows.values()
            if r["sector"] == sector
            and r["data_quality"] == "Complete"
            and r["rs63"] is not None
        ]
        sectors.append(
            {
                "sector": sector,
                "eligible_rs_stocks": len(values),
                "equal_weight_mean_stock_rs63_pp": (
                    float(np.mean(values)) if values else None
                ),
            }
        )
    return {
        "as_of": str(day),
        "indices": reports,
        "sector_relative_strength": sectors,
        "note": "Supplementary diagnostics only; existing regime score unchanged. Sector statistic is mean covered-stock RS, not a sector-index return. Missing PIT membership prevents representative broad-market claims.",
    }
