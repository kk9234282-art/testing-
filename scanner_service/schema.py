from datetime import date, datetime, time
from zoneinfo import ZoneInfo
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Manifest(Model):
    name: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=200)
    kind: Literal["sample", "licensed"]
    license_reference: str = Field(min_length=1, max_length=500)
    currency: Literal["INR"] = "INR"
    ohlcv_basis: Literal["raw"]
    latest_complete_session: date
    universe_history_complete: bool
    corporate_actions_complete: bool
    notes: str = Field(default="", max_length=2000)


def isin_valid(value):
    digits = "".join(str(ord(char) - 55) if char.isalpha() else char for char in value)
    total = 0
    for i, char in enumerate(reversed(digits)):
        number = int(char) * (2 if i % 2 else 1)
        total += number // 10 + number % 10
    return total % 10 == 0


class Security(Model):
    security_id: str = Field(pattern=r"^[A-Z0-9_-]{1,60}$")
    listing_id: str = Field(pattern=r"^(NSE|BSE):[A-Z0-9&_.!-]{1,40}$")
    isin: str = Field(pattern=r"^IN[A-Z0-9]{9}[0-9]$")
    name: str = Field(min_length=1, max_length=200)
    exchange: Literal["NSE", "BSE"]
    symbol: str = Field(min_length=1, max_length=40)
    sector: str = Field(min_length=1, max_length=100)
    instrument_type: Literal["EQUITY", "ETF", "INDEX", "WARRANT", "OTHER"]
    valid_from: date
    valid_to: date | None = None
    known_on: date

    @model_validator(mode="after")
    def valid(self):
        if self.known_on > self.valid_from:
            raise ValueError(
                "Master versions must be known by their effective date; late restatements require a separate source version"
            )
        if not isin_valid(self.isin):
            raise ValueError("ISIN checksum is invalid")
        if self.listing_id != f"{self.exchange}:{self.symbol}":
            raise ValueError("Listing ID must match exchange and symbol")
        if self.valid_to and self.valid_to <= self.valid_from:
            raise ValueError("Security validity interval must be nonempty")
        return self


class Bar(Model):
    listing_id: str
    date: date
    open: FiniteFloat = Field(gt=0)
    high: FiniteFloat = Field(gt=0)
    low: FiniteFloat = Field(gt=0)
    close: FiniteFloat = Field(gt=0)
    volume: FiniteFloat = Field(ge=0)
    is_final: bool
    delivery_pct: FiniteFloat | None = Field(default=None, ge=0, le=100)
    delivery_verified: bool = False

    @model_validator(mode="after")
    def ohlc(self):
        if self.high < max(self.open, self.low, self.close) or self.low > min(
            self.open, self.high, self.close
        ):
            raise ValueError("Invalid OHLC geometry")
        if not self.is_final:
            raise ValueError("Only finalized end-of-day bars are accepted")
        return self


class Action(Model):
    listing_id: str
    effective_on: date
    known_on: date
    kind: Literal["split", "bonus", "dividend"]
    price_factor: FiniteFloat = Field(gt=0)
    volume_factor: FiniteFloat = Field(gt=0)
    cash_per_share: FiniteFloat = Field(default=0, ge=0)
    reference: str = Field(min_length=1, max_length=300)
    verified: bool

    @model_validator(mode="after")
    def adjustment(self):
        if not self.verified or self.known_on > self.effective_on:
            raise ValueError(
                "Actions require verified factors known by the effective session"
            )
        if (
            self.kind in ("split", "bonus")
            and abs(self.price_factor * self.volume_factor - 1) > 1e-6
        ):
            raise ValueError("Split/bonus price and volume factors must be reciprocal")
        if self.kind == "dividend" and (
            self.cash_per_share <= 0
            or self.volume_factor != 1
            or self.price_factor >= 1
        ):
            raise ValueError(
                "Dividends require cash amount, provider price factor below one and unchanged volume"
            )
        return self


class Benchmark(Model):
    return_basis: Literal["price"] = "price"
    index_id: str = Field(pattern=r"^[A-Z0-9_]{1,60}$")
    name: str
    role: Literal["broad", "sector"] = "broad"
    expected_members: int = Field(gt=0)


class IndexBar(Model):
    index_id: str
    date: date
    close: FiniteFloat = Field(gt=0)


class Membership(Model):
    index_id: str
    security_id: str
    valid_from: date
    valid_to: date | None = None
    known_on: date


class Fundamental(Model):
    security_id: str
    period_end: date
    known_on: date
    source: str
    values: dict[str, FiniteFloat | None]


class Terminal(Model):
    listing_id: str
    date: date
    cash_per_share: FiniteFloat = Field(ge=0)
    reference: str = Field(min_length=1)


class Bundle(Model):
    manifest: Manifest
    sessions: list[date] = Field(min_length=1)
    securities: list[Security] = Field(min_length=1)
    bars: list[Bar] = Field(min_length=1)
    actions: list[Action] = []
    benchmarks: list[Benchmark] = []
    index_bars: list[IndexBar] = []
    memberships: list[Membership] = []
    fundamentals: list[Fundamental] = []
    terminals: list[Terminal] = []

    @model_validator(mode="after")
    def integrity(self):
        if self.sessions != sorted(set(self.sessions)):
            raise ValueError("Exchange sessions must be unique and ascending")
        if self.manifest.latest_complete_session not in self.sessions:
            raise ValueError("Latest complete session must be in the exchange calendar")
        sessions, listings = set(self.sessions), {s.listing_id for s in self.securities}
        securities = {s.security_id for s in self.securities}
        indices = {b.index_id for b in self.benchmarks}
        if len(indices) != len(self.benchmarks):
            raise ValueError("Duplicate benchmark IDs")
        seen = set()
        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        if self.manifest.latest_complete_session > now.date() or (
            self.manifest.latest_complete_session == now.date()
            and now.time() < time(15, 30)
        ):
            raise ValueError(
                "Latest complete EOD session cannot be in the future or before regular market close"
            )
        by_listing = {}
        by_security = {}
        for security in self.securities:
            by_listing.setdefault(security.listing_id, []).append(security)
            by_security.setdefault(security.security_id, []).append(security)
        for versions in by_listing.values():
            versions.sort(key=lambda v: v.valid_from)
            for left, right in zip(versions, versions[1:]):
                if left.valid_to is None or left.valid_to > right.valid_from:
                    raise ValueError("Overlapping security-master versions")
        for versions in by_security.values():
            for i, left in enumerate(versions):
                for right in versions[i + 1 :]:
                    overlap = max(left.valid_from, right.valid_from) < min(
                        left.valid_to or date.max, right.valid_to or date.max
                    )
                    if overlap and (
                        left.isin != right.isin or left.exchange == right.exchange
                    ):
                        raise ValueError(
                            "Conflicting simultaneous security identifiers/listings"
                        )
        for membership in self.memberships:
            peers = [
                m
                for m in self.memberships
                if m.index_id == membership.index_id
                and m.security_id == membership.security_id
            ]
            for other in peers:
                if other is membership:
                    continue
                if max(membership.valid_from, other.valid_from) < min(
                    membership.valid_to or date.max, other.valid_to or date.max
                ):
                    raise ValueError("Overlapping index membership records")
        for b in self.bars:
            key = (b.listing_id, b.date)
            if key in seen or b.listing_id not in listings or b.date not in sessions:
                raise ValueError(
                    "Duplicate/orphan bar or date outside the session calendar"
                )
            if not any(
                v.valid_from <= b.date and (v.valid_to is None or b.date < v.valid_to)
                for v in by_listing[b.listing_id]
            ):
                raise ValueError("Bar lies outside listing validity intervals")
            if b.date > self.manifest.latest_complete_session:
                raise ValueError(
                    "Bars after the last complete EOD session are not accepted"
                )
            seen.add(key)
        for a in self.actions:
            if a.listing_id not in listings or a.effective_on not in sessions:
                raise ValueError("Action has no listing or exchange session")
        if len(
            {(a.listing_id, a.effective_on, a.kind, a.reference) for a in self.actions}
        ) != len(self.actions):
            raise ValueError("Duplicate corporate action")
        seen_index = set()
        for b in self.index_bars:
            key = (b.index_id, b.date)
            if key in seen_index or b.index_id not in indices or b.date not in sessions:
                raise ValueError("Duplicate/orphan index bar")
            seen_index.add(key)
        for m in self.memberships:
            if (
                m.index_id not in indices
                or m.security_id not in securities
                or m.known_on > m.valid_from
                or (m.valid_to and m.valid_to <= m.valid_from)
            ):
                raise ValueError("Invalid point-in-time index membership")
        for f in self.fundamentals:
            if f.security_id not in securities or f.known_on < f.period_end:
                raise ValueError(
                    "Fundamentals require a valid security and actual publication date"
                )
        if len({t.listing_id for t in self.terminals}) != len(self.terminals):
            raise ValueError(
                "Only one verified full terminal cash settlement per listing is supported"
            )
        for t in self.terminals:
            if t.listing_id not in listings or t.date not in sessions:
                raise ValueError("Terminal settlement must have a listing and session")
        return self


class Parameters(Model):
    pivot_left: int = Field(default=3, ge=2, le=10)
    pivot_right: int = Field(default=3, ge=2, le=10)
    swing_atr: FiniteFloat = Field(default=1, ge=0.25, le=5)
    break_atr: FiniteFloat = Field(default=0.1, ge=0, le=1)
    retest_bars: int = Field(default=10, ge=2, le=30)
