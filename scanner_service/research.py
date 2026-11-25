from collections import Counter, defaultdict
from datetime import date
import numpy as np
import pandas as pd
from .schema import Bundle, Parameters
from .version import provenance
from .structure import analyse, number, BULLISH

REQUIRED_INDICES = [
    "NIFTY_500",
    "NIFTY_50",
    "NIFTY_MIDCAP_150",
    "NIFTY_SMALLCAP_250",
    "NIFTY_50_EQUAL_WEIGHT",
]


def active_interval(record, day):
    return (
        record.valid_from <= day
        and (record.valid_to is None or day < record.valid_to)
        and record.known_on <= day
    )


class Context:
    def __init__(self, bundle: Bundle):
        self.bundle = bundle
        self.sessions = bundle.sessions
        self.raw = {}
        grouped = defaultdict(list)
        self.versions = defaultdict(list)
        self.actions = defaultdict(list)
        self.facts = defaultdict(list)
        for security in bundle.securities:
            self.versions[security.listing_id].append(security)
        for action in bundle.actions:
            self.actions[action.listing_id].append(action)
        for fact in bundle.fundamentals:
            self.facts[fact.security_id].append(fact)
        for bar in bundle.bars:
            grouped[bar.listing_id].append(bar.model_dump())
        for listing, rows in grouped.items():
            f = pd.DataFrame(rows).sort_values("date").set_index("date")
            f.index = pd.to_datetime(f.index)
            self.raw[listing] = f
        self.index = {}
        for index in bundle.benchmarks:
            rows = [
                b.model_dump()
                for b in bundle.index_bars
                if b.index_id == index.index_id
            ]
            if rows:
                f = pd.DataFrame(rows).sort_values("date").set_index("date")
                f.index = pd.to_datetime(f.index)
                self.index[index.index_id] = f.close.reindex(
                    pd.to_datetime(bundle.sessions)
                )
        self._frames, self._regimes = {}, {}

    def active(self, day):
        versions = [
            s
            for s in self.bundle.securities
            if active_interval(s, day) and s.instrument_type == "EQUITY"
        ]
        groups = defaultdict(list)
        for s in versions:
            groups[s.security_id].append(s)
        return [
            (
                sorted(items, key=lambda s: (s.exchange != "NSE", s.listing_id))[0],
                sorted({s.exchange for s in items}),
            )
            for items in groups.values()
        ]

    def gaps(self, listing, day):
        versions = [
            s for s in self.versions.get(listing, []) if s.instrument_type == "EQUITY"
        ]
        expected = {
            d
            for d in self.sessions
            if d <= day and any(active_interval(v, d) for v in versions)
        }
        actual = {d.date() for d in self.raw.get(listing, pd.DataFrame()).index}
        return sorted(expected - actual)

    def frames(self, day):
        if day in self._frames:
            return self._frames[day]
        result = {}
        for listing, raw in self.raw.items():
            f = raw.loc[raw.index <= pd.Timestamp(day)].copy()
            if f.empty:
                continue
            f["raw_open"], f["raw_close"], f["raw_volume"] = f.open, f.close, f.volume
            f["relative_close"], f["relative_high"], f["relative_low"] = (
                f.close,
                f.high,
                f.low,
            )
            for action in self.actions.get(listing, []):
                if action.effective_on <= day and action.known_on <= day:
                    before = f.index < pd.Timestamp(action.effective_on)
                    f.loc[
                        before, ["open", "high", "low", "close"]
                    ] *= action.price_factor
                    f.loc[before, "volume"] *= action.volume_factor
                    if action.kind in ("split", "bonus"):
                        f.loc[
                            before, ["relative_close", "relative_high", "relative_low"]
                        ] *= action.price_factor
            result[listing] = f
        if len(self._frames) >= 4:
            self._frames.pop(next(iter(self._frames)))
        self._frames[day] = result
        return result

    def benchmark(self, day):
        series = self.index.get("NIFTY_500")
        return series.loc[: str(day)] if series is not None else None

    def analysis(self, listing, day, parameters):
        f = self.frames(day).get(listing)
        if f is None or f.empty:
            return None
        return analyse(f, parameters, self.benchmark(day))

    def fundamentals(self, security_id, day):
        facts = [f for f in self.facts.get(security_id, []) if f.known_on <= day]
        return (
            max(facts, key=lambda f: (f.period_end, f.known_on)).model_dump(mode="json")
            if facts
            else None
        )

    def regime(self, day, with_line=False):
        if day not in self._regimes:
            frames, active = self.frames(day), dict(
                (s.security_id, s) for s, _ in self.active(day)
            )
            reports = []
            for index in self.bundle.benchmarks:
                members = {
                    m.security_id
                    for m in self.bundle.memberships
                    if m.index_id == index.index_id and active_interval(m, day)
                }
                advances = declines = unchanged = above50 = above200 = new_highs = (
                    new_lows
                ) = eligible50 = eligible200 = eligible252 = known = 0
                for sid in members:
                    s = active.get(sid)
                    f = frames.get(s.listing_id) if s else None
                    if (
                        f is None
                        or f.empty
                        or f.index[-1].date() != day
                        or self.gaps(s.listing_id, day)
                    ):
                        continue
                    closes = f.relative_close
                    if len(f) >= 2:
                        known += 1
                        delta = closes.iloc[-1] - closes.iloc[-2]
                        advances += int(delta > 0)
                        declines += int(delta < 0)
                        unchanged += int(delta == 0)
                    if len(f) >= 50:
                        eligible50 += 1
                        above50 += int(closes.iloc[-1] > closes.iloc[-50:].mean())
                    if len(f) >= 200:
                        eligible200 += 1
                        above200 += int(closes.iloc[-1] > closes.iloc[-200:].mean())
                    if len(f) >= 252:
                        eligible252 += 1
                        new_highs += int(
                            f.relative_high.iloc[-1]
                            > f.relative_high.iloc[-252:-1].max()
                        )
                        new_lows += int(
                            f.relative_low.iloc[-1] < f.relative_low.iloc[-252:-1].min()
                        )
                close = self.index.get(index.index_id)
                b = (
                    close.loc[: str(day)]
                    if close is not None
                    else pd.Series(dtype=float)
                )
                coverage = known / len(members) if members else 0
                score = None
                if (
                    len(b) >= 200
                    and b.iloc[-200:].notna().all()
                    and b.index[-1].date() == day
                    and len(members) == index.expected_members
                    and eligible200 / len(members) >= 0.8
                ):
                    above200_index = b.iloc[-1] > b.iloc[-200:].mean()
                    above20_index = (
                        b.iloc[-1] > b.ewm(span=20, adjust=False).mean().iloc[-1]
                    )
                    parts = [
                        (25, float(above200_index)),
                        (15, float(above20_index)),
                        (30, above50 / eligible50),
                        (20, above200 / eligible200),
                    ]
                    if eligible252:
                        parts.append((10, (new_highs + 1) / (new_highs + new_lows + 2)))
                    score = round(
                        sum(w * v for w, v in parts) / sum(w for w, _ in parts) * 100, 1
                    )
                reports.append(
                    {
                        "index_id": index.index_id,
                        "name": index.name,
                        "role": index.role,
                        "score": score,
                        "regime": (
                            "Unavailable"
                            if score is None
                            else (
                                "Risk-on"
                                if score >= 65
                                else "Mixed" if score >= 40 else "Defensive"
                            )
                        ),
                        "members": len(members),
                        "expected_members": index.expected_members,
                        "coverage": round(coverage, 4),
                        "advances": advances,
                        "declines": declines,
                        "unchanged": unchanged,
                        "above50_pct": (
                            above50 / eligible50 * 100 if eligible50 else None
                        ),
                        "above200_pct": (
                            above200 / eligible200 * 100 if eligible200 else None
                        ),
                        "new_highs": new_highs if eligible252 else None,
                        "new_lows": new_lows if eligible252 else None,
                        "high_low_coverage": eligible252,
                        "close": (
                            number(b.iloc[-1])
                            if len(b) and b.index[-1].date() == day
                            else None
                        ),
                    }
                )
            self._regimes[day] = reports
        reports = [dict(r) for r in self._regimes[day]]
        lines = {index.index_id: [] for index in self.bundle.benchmarks}
        if with_line:
            totals = {key: 0 for key in lines}
            frames = self.frames(day)
            for d in self.sessions:
                if d > day:
                    break
                chosen = {s.security_id: s for s, _ in self.active(d)}
                changes = {}
                for sid, security in chosen.items():
                    f = frames.get(security.listing_id)
                    if f is None or pd.Timestamp(d) not in f.index:
                        continue
                    position = f.index.get_loc(pd.Timestamp(d))
                    previous = (
                        self.sessions[self.sessions.index(d) - 1]
                        if self.sessions.index(d) > 0
                        else None
                    )
                    if position < 1 or f.index[position - 1].date() != previous:
                        continue
                    changes[sid] = np.sign(
                        f.relative_close.iloc[position]
                        - f.relative_close.iloc[position - 1]
                    )
                for index in self.bundle.benchmarks:
                    members = {
                        m.security_id
                        for m in self.bundle.memberships
                        if m.index_id == index.index_id and active_interval(m, d)
                    }
                    advances = sum(int(changes.get(sid) == 1) for sid in members)
                    declines = sum(int(changes.get(sid) == -1) for sid in members)
                    totals[index.index_id] += advances - declines
                    lines[index.index_id].append(
                        {
                            "date": str(d),
                            "value": totals[index.index_id],
                            "advances": advances,
                            "declines": declines,
                        }
                    )
        return {
            "indices": reports,
            "advance_decline_line": lines.get("NIFTY_500", []),
            "advance_decline_lines": lines,
            "missing_indices": [
                i
                for i in REQUIRED_INDICES
                if not any(b.index_id == i for b in self.bundle.benchmarks)
            ],
        }

    def scan(self, day, parameters):
        if (
            day not in self.sessions
            or day > self.bundle.manifest.latest_complete_session
        ):
            raise ValueError("Choose a finalized session from this dataset")
        rows = []
        for s, exchanges in self.active(day):
            analysis = self.analysis(s.listing_id, day, parameters)
            gaps = self.gaps(s.listing_id, day)
            good = (
                analysis is not None
                and analysis["frame"].index[-1].date() == day
                and not gaps
            )
            latest = (
                analysis["latest"]
                if good
                else {
                    "status": None,
                    "initial_signal_date": None,
                    "confirmation_date": None,
                    "status_date": None,
                    "support": None,
                    "resistance": None,
                }
            )
            f = analysis["frame"] if analysis else None
            last = f.iloc[-1] if f is not None else None
            metrics = {
                key: number(last[key]) if last is not None else None
                for key in [
                    "ema20",
                    "sma50",
                    "sma200",
                    "rsi14",
                    "macd",
                    "macd_signal",
                    "macd_hist",
                    "adx14",
                    "rs63",
                    "volume_ratio",
                    "atr",
                ]
            }
            rows.append(
                {
                    "security_id": s.security_id,
                    "listing_id": s.listing_id,
                    "symbol": s.symbol,
                    "name": s.name,
                    "isin": s.isin,
                    "sector": s.sector,
                    "exchange": s.exchange,
                    "exchanges": exchanges,
                    **latest,
                    **metrics,
                    "close": number(last.raw_close) if last is not None else None,
                    "delivery_pct": (
                        number(last.delivery_pct)
                        if last is not None and bool(last.delivery_verified)
                        else None
                    ),
                    "data_quality": (
                        "Complete"
                        if good
                        else f"Missing/stale bars ({len(gaps)} sessions)"
                    ),
                    "missing_sessions": len(gaps),
                    "history_sessions": len(f) if f is not None else 0,
                    "fundamentals": self.fundamentals(s.security_id, day),
                }
            )
        sectors = []
        for sector in sorted({r["sector"] for r in rows}):
            items = [r for r in rows if r["sector"] == sector]
            known = [r for r in items if r["status"]]
            bullish = sum(r["status"] in BULLISH for r in known)
            eligible = [
                r
                for r in items
                if r["data_quality"] == "Complete"
                and r["history_sessions"]
                >= 14 + parameters.pivot_left + parameters.pivot_right
            ]
            sectors.append(
                {
                    "sector": sector,
                    "companies": len(items),
                    "classified": len(known),
                    "eligible": len(eligible),
                    "bullish": bullish,
                    "bullish_pct": bullish / len(eligible) * 100 if eligible else None,
                    "early": sum(
                        r["status"] in {"Early Reversal", "Structure Developing"}
                        for r in known
                    ),
                }
            )
        sectors.sort(
            key=lambda x: -(x["bullish_pct"] if x["bullish_pct"] is not None else -1)
        )
        return {
            "provenance": provenance(),
            "as_of": str(day),
            "manifest": self.bundle.manifest.model_dump(mode="json"),
            "parameters": parameters.model_dump(),
            "rows": rows,
            "counts": dict(Counter(r["status"] or "No transition" for r in rows)),
            "regime": self.regime(day, True),
            "sectors": sectors,
            "coverage": {
                "active_equities": len(rows),
                "complete": sum(r["data_quality"] == "Complete" for r in rows),
                "excluded_instruments": len(
                    {
                        s.security_id
                        for s in self.bundle.securities
                        if s.instrument_type != "EQUITY"
                    }
                ),
            },
        }

    def stock(self, security_id, day, parameters):
        selected = next(
            (s for s, _ in self.active(day) if s.security_id == security_id), None
        )
        if not selected:
            raise ValueError("Security is not an active equity at this as-of date")
        if self.gaps(selected.listing_id, day):
            raise ValueError(
                "Stock history has missing sessions; structural annotations are withheld"
            )
        data = self.analysis(selected.listing_id, day, parameters)
        if not data:
            raise ValueError("No price history")
        series = []
        for d, row in data["frame"].iterrows():
            series.append(
                {
                    "time": str(d)[:10],
                    **{
                        k: number(row[k])
                        for k in [
                            "open",
                            "high",
                            "low",
                            "close",
                            "volume",
                            "ema20",
                            "sma50",
                            "sma200",
                            "relative_line",
                            "rs63",
                        ]
                    },
                }
            )
        return {
            "security": selected.model_dump(mode="json"),
            "as_of": str(day),
            "price_basis": "Provider factors effective through as-of date; dividends, splits and bonuses adjusted",
            "series": series,
            "pivots": data["pivots"],
            "events": data["events"],
            "timeline": data["timeline"],
            "fundamentals": self.fundamentals(security_id, day),
        }
