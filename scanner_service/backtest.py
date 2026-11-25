from collections import defaultdict
from datetime import date
import numpy as np
import pandas as pd
from .schema import Parameters
from .research import Context
from .version import provenance


def outcomes(
    context: Context,
    day: date,
    parameters=None,
    signal="confirmed",
    fee_bps=10.0,
    slippage_bps=5.0,
):
    if (
        day not in context.sessions
        or day > context.bundle.manifest.latest_complete_session
    ):
        raise ValueError("Backtest as-of date must be a finalized dataset session")
    if (
        not context.bundle.manifest.universe_history_complete
        or not context.bundle.manifest.corporate_actions_complete
    ):
        raise ValueError(
            "Backtests require attested complete historical universe and corporate-action coverage"
        )
    if (
        signal not in ("initial", "confirmed")
        or not 0 <= fee_bps <= 100
        or not 0 <= slippage_bps <= 100
    ):
        raise ValueError("Invalid backtest settings")
    p = parameters or Parameters()
    sessions = [d for d in context.sessions if d <= day]
    schedule = {d: i for i, d in enumerate(sessions)}
    trades = []
    # Includes inactive/delisted listings, not just today's universe.
    for listing in sorted(
        {
            s.listing_id
            for s in context.bundle.securities
            if s.instrument_type == "EQUITY"
        }
    ):
        analysis = context.analysis(listing, day, p)
        if not analysis:
            continue
        entries = {}
        for state in analysis["timeline"]:
            date_string = (
                state["initial_signal_date"]
                if signal == "initial"
                else state["confirmation_date"]
            )
            if date_string:
                entries.setdefault(state["episode"], date.fromisoformat(date_string))
        for episode, signal_day in entries.items():
            chosen = next(
                (s for s, _ in context.active(signal_day) if s.listing_id == listing),
                None,
            )
            if not chosen or context.gaps(listing, signal_day):
                continue
            regime = next(
                (
                    r["regime"]
                    for r in context.regime(signal_day)["indices"]
                    if r["index_id"] == "NIFTY_500"
                ),
                "Unavailable",
            )
            raw = context.raw[listing]
            entry_index = schedule[signal_day] + 1
            for horizon in (20, 40, 60):
                trade = {
                    "security_id": chosen.security_id,
                    "listing_id": listing,
                    "signal_date": str(signal_day),
                    "episode": episode,
                    "horizon": horizon,
                    "regime": regime,
                    "entry_date": (
                        str(sessions[entry_index])
                        if entry_index < len(sessions)
                        else None
                    ),
                    "return_pct": None,
                    "drawdown_pct": None,
                    "failed_breakout": False,
                    "reason": None,
                }
                end = entry_index + horizon - 1
                if end >= len(sessions):
                    trade["reason"] = "Horizon not matured"
                    trades.append(trade)
                    continue
                entry_day = sessions[entry_index]
                if pd.Timestamp(entry_day) not in raw.index:
                    trade["reason"] = "No next-session executable open"
                    trades.append(trade)
                    continue
                if raw.loc[pd.Timestamp(entry_day)].volume <= 0:
                    trade["reason"] = "No positive-volume next-session open"
                    trades.append(trade)
                    continue
                entry = (
                    float(raw.loc[pd.Timestamp(entry_day)].open)
                    * (1 + slippage_bps / 10000)
                    * (1 + fee_bps / 10000)
                )
                shares, cash, terminal = 1.0, 0.0, False
                equity = [1.0]
                for d in sessions[entry_index : end + 1]:
                    for a in sorted(
                        context.bundle.actions,
                        key=lambda action: action.kind == "dividend",
                    ):
                        # A new position bought at the ex-date open has no prior
                        # split/dividend entitlement; raw open is already rebased.
                        if (
                            d > entry_day
                            and a.listing_id == listing
                            and a.effective_on == d
                        ):
                            if a.kind in ("split", "bonus"):
                                shares /= a.price_factor
                            elif a.kind == "dividend":
                                cash += shares * a.cash_per_share
                    settlement = next(
                        (
                            t
                            for t in context.bundle.terminals
                            if t.listing_id == listing and t.date == d
                        ),
                        None,
                    )
                    if terminal:
                        equity.append(cash / entry)
                        continue
                    if settlement:
                        cash += shares * settlement.cash_per_share
                        shares = 0
                        terminal = True
                        equity.append(cash / entry)
                        continue
                    if pd.Timestamp(d) not in raw.index:
                        trade["reason"] = (
                            "Missing holding-period bar / unresolved delisting"
                        )
                        break
                    mark = shares * float(raw.loc[pd.Timestamp(d)].close)
                    if d == sessions[end]:
                        if raw.loc[pd.Timestamp(d)].volume <= 0:
                            trade["reason"] = "No positive-volume horizon exit"
                            break
                        mark *= (1 - slippage_bps / 10000) * (1 - fee_bps / 10000)
                    equity.append((cash + mark) / entry)
                if not trade["reason"]:
                    path = np.array(equity)
                    trade["return_pct"] = round((path[-1] - 1) * 100, 6)
                    trade["drawdown_pct"] = round(
                        float((path / np.maximum.accumulate(path) - 1).min() * 100), 6
                    )
                    trade["exit_date"] = str(sessions[end])
                    trade["failed_breakout"] = any(
                        e["type"] == "FAILED_BREAKOUT"
                        and e["episode"] == episode
                        and entry_day <= date.fromisoformat(e["date"]) <= sessions[end]
                        for e in analysis["events"]
                    )
                trades.append(trade)

    def summarize(items, horizon, regime="All"):
        complete = [t for t in items if t["return_pct"] is not None]
        return {
            "horizon": horizon,
            "regime": regime,
            "signals": len(items),
            "completed": len(complete),
            "censored": len(items) - len(complete),
            "mean_return_pct": (
                float(np.mean([t["return_pct"] for t in complete]))
                if complete
                else None
            ),
            "win_rate_pct": (
                sum(t["return_pct"] > 0 for t in complete) / len(complete) * 100
                if complete
                else None
            ),
            "worst_trade_drawdown_pct": min(
                (t["drawdown_pct"] for t in complete), default=None
            ),
            "failed_breakout_pct": (
                sum(t["failed_breakout"] for t in complete) / len(complete) * 100
                if complete
                else None
            ),
        }

    summary = [
        summarize([t for t in trades if t["horizon"] == h], h) for h in (20, 40, 60)
    ]
    regimes = [
        summarize(
            [t for t in trades if t["horizon"] == h and t["regime"] == regime],
            h,
            regime,
        )
        for h in (20, 40, 60)
        for regime in sorted({t["regime"] for t in trades})
    ]
    return {
        "provenance": provenance(),
        "parameters": p.model_dump(),
        "as_of": str(day),
        "signal": signal,
        "fee_bps_per_side": fee_bps,
        "slippage_bps_per_side": slippage_bps,
        "summary": summary,
        "by_regime": regimes,
        "trades": trades,
        "method": "Next-session open; one entry per structural episode; gross dividend receivables without reinvestment; split/bonus share accounting. Drawdown is worst individual close-marked trade, not a portfolio equity curve. Source completeness is user-attested, not independently certified.",
    }
