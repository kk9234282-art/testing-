"""Presentation gates for real inputs whose action adjustments are unverified.

The mathematical engine remains unchanged. Incomplete real histories must not
be presented as validated market-structure signals merely because OHLCV exists.
"""


def needs_action_review(manifest):
    return manifest.get("kind") == "licensed" and not manifest.get(
        "corporate_actions_complete", False
    )


def gate_scan(result, manifest):
    if not needs_action_review(manifest) or "rows" not in result:
        return result
    result = dict(result)
    rows = []
    for raw in result["rows"]:
        row = dict(raw)
        for key in (
            "status",
            "initial_signal_date",
            "confirmation_date",
            "status_date",
            "support",
            "resistance",
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
        ):
            row[key] = None
        row["data_quality"] = (
            "Unverified corporate actions; structural signals withheld"
        )
        rows.append(row)
    result["rows"] = rows
    result["counts"] = {"Withheld: action history unverified": len(rows)}
    result["quality_warning"] = (
        "Actual raw prices are available. Corporate-action factors/availability require review before validating structural signals. No synthetic results substituted."
    )
    # Sector and regime structure claims are not meaningful without valid rows.
    result["sectors"] = []
    result["regime"] = {
        **result["regime"],
        "indices": [],
        "advance_decline_line": [],
        "advance_decline_lines": {},
    }
    return result


def raw_stock(context, security_id, day):
    security = next(
        (s for s, _ in context.active(day) if s.security_id == security_id), None
    )
    if security is None or security.listing_id not in context.raw:
        raise ValueError("No active raw equity history")
    frame = context.raw[security.listing_id].loc[: str(day)]
    return {
        "security": security.model_dump(mode="json"),
        "as_of": str(day),
        "annotations_withheld": True,
        "price_basis": "RAW OHLCV ONLY — corporate-action history is unverified; structural annotations and indicators withheld",
        "series": [
            {
                "time": str(d.date()),
                **{
                    k: float(row[k]) for k in ("open", "high", "low", "close", "volume")
                },
                **{
                    k: None
                    for k in ("ema20", "sma50", "sma200", "relative_line", "rs63")
                },
            }
            for d, row in frame.iterrows()
        ],
        "pivots": [],
        "events": [],
        "timeline": [],
        "fundamentals": context.fundamentals(security_id, day),
    }
