import math
import pandas as pd
from .indicators import indicators
from .schema import Parameters

BULLISH = {"Confirmed Bullish", "Strong Bullish"}


def number(value):
    return float(value) if value is not None and math.isfinite(float(value)) else None


def analyse(frame, parameters=None, benchmark=None):
    """Single forward pass. A candidate at t is usable only at t + right."""
    p = parameters or Parameters()
    f = indicators(frame, benchmark)
    pivots, events, timeline = [], [], []
    highs, lows, broken_highs, broken_lows = [], [], set(), set()
    status, initial, confirmation, episode = None, None, None, None
    support, pending, developing = None, None, False
    for i, (day, row) in enumerate(f.iterrows()):
        today = str(day)[:10]
        newly = []
        candidate = i - p.pivot_right
        if candidate >= p.pivot_left and number(f.iloc[candidate].atr) is not None:
            window = f.iloc[candidate - p.pivot_left : i + 1]
            center = f.iloc[candidate]
            for kind, column, records, opposite in (
                ("high", "high", highs, lows),
                ("low", "low", lows, highs),
            ):
                value = float(center[column])
                extreme = (
                    window[column].max() if kind == "high" else window[column].min()
                )
                if value != extreme or int((window[column] == extreme).sum()) != 1:
                    continue
                if (
                    opposite
                    and abs(value - opposite[-1]["price"]) < p.swing_atr * center.atr
                ):
                    continue
                if records and abs(value - records[-1]["price"]) < 0.25 * center.atr:
                    continue
                label = (
                    ("H" if kind == "high" else "L")
                    if not records
                    else (
                        ("HH" if value > records[-1]["price"] else "LH")
                        if kind == "high"
                        else ("HL" if value > records[-1]["price"] else "LL")
                    )
                )
                pivot = {
                    "id": f"{kind}:{candidate}",
                    "kind": kind,
                    "label": label,
                    "price": value,
                    "pivot_date": str(f.index[candidate])[:10],
                    "confirmed_on": today,
                }
                records.append(pivot)
                pivots.append(pivot)
                newly.append(pivot)
        atr = number(row.atr)
        previous_status = status
        if atr is not None and i:
            close, previous = float(row.close), float(f.iloc[i - 1].close)
            if (
                pending
                and i > pending["index"]
                and i - pending["index"] <= p.retest_bars
            ):
                if close < pending["level"] - 0.25 * atr:
                    events.append(
                        {
                            "type": "FAILED_BREAKOUT",
                            "date": today,
                            "level": pending["level"],
                            "episode": episode,
                            "reason": "Close returned below the broken level within the retest window",
                        }
                    )
                    status = "Weakening"
                    developing = False
                    pending = None
                elif (
                    not pending["retested"]
                    and row.low <= pending["level"] + 0.25 * atr
                    and close >= pending["level"]
                ):
                    events.append(
                        {
                            "type": "RETEST",
                            "date": today,
                            "level": pending["level"],
                            "episode": episode,
                            "reason": "Later session tested the broken level and closed above it",
                        }
                    )
                    pending["retested"] = True
            for pivot in newly:
                if (
                    pivot["label"] == "HL"
                    and initial
                    and today > initial
                    and status in {"Early Reversal", "Structure Developing", *BULLISH}
                ):
                    support = pivot["price"]
                    developing = True
                    if not confirmation:
                        status = "Structure Developing"
            if highs:
                high = highs[-1]
                if (
                    high["id"] not in broken_highs
                    and previous <= high["price"] + p.break_atr * atr
                    and close > high["price"] + p.break_atr * atr
                ):
                    broken_highs.add(high["id"])
                    if status not in {
                        "Early Reversal",
                        "Structure Developing",
                        *BULLISH,
                    }:
                        initial = today
                        confirmation = None
                        episode = today
                        developing = False
                        support = lows[-1]["price"] if lows else None
                        status = "Early Reversal"
                        event = "CHOCH_UP"
                    else:
                        event = "BOS_UP"
                        if developing and confirmation is None:
                            confirmation = today
                            status = "Confirmed Bullish"
                    events.append(
                        {
                            "type": event,
                            "date": today,
                            "level": high["price"],
                            "episode": episode,
                            "reason": "Daily close broke a previously confirmed swing high with ATR buffer",
                        }
                    )
                    pending = {"index": i, "level": high["price"], "retested": False}
            low_level = (
                support if support is not None else lows[-1]["price"] if lows else None
            )
            low_id = str(low_level)
            if (
                low_level is not None
                and low_id not in broken_lows
                and previous >= low_level - p.break_atr * atr
                and close < low_level - p.break_atr * atr
            ):
                broken_lows.add(low_id)
                events.append(
                    {
                        "type": "CHOCH_DOWN" if confirmation else "BOS_DOWN",
                        "date": today,
                        "level": low_level,
                        "episode": episode,
                        "reason": "Daily close broke confirmed structural support",
                    }
                )
                status = "Weakening" if confirmation else "Bearish"
                developing = False
            if (
                len(highs) >= 2
                and len(lows) >= 2
                and highs[-1]["label"] == "LH"
                and lows[-1]["label"] == "LL"
                and status not in {"Early Reversal", "Structure Developing", *BULLISH}
            ):
                status = "Bearish"
            if status in BULLISH:
                strong = (
                    all(
                        number(row[k]) is not None
                        for k in (
                            "ema20",
                            "sma50",
                            "sma200",
                            "rs63",
                            "volume_ratio",
                            "adx14",
                        )
                    )
                    and row.ema20 > row.sma50 > row.sma200
                    and row.rs63 > 0
                    and row.volume_ratio >= 1.2
                    and row.adx14 >= 20
                )
                status = "Strong Bullish" if strong else "Confirmed Bullish"
        if status != previous_status:
            events.append(
                {
                    "type": "STATUS",
                    "date": today,
                    "status": status,
                    "episode": episode,
                    "reason": "Structural state updated; indicators only promote an already confirmed structure",
                }
            )
        timeline.append(
            {
                "date": today,
                "status": status,
                "initial_signal_date": initial,
                "confirmation_date": confirmation,
                "status_date": next(
                    (e["date"] for e in reversed(events) if e["type"] == "STATUS"), None
                ),
                "support": number(support),
                "resistance": highs[-1]["price"] if highs else None,
                "episode": episode,
            }
        )
    return {
        "frame": f,
        "pivots": pivots,
        "events": events,
        "timeline": timeline,
        "latest": timeline[-1] if timeline else None,
    }
