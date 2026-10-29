// Ratios and percentage-point values are retained as returned by the provider.
export const FUNDAMENTALS = [
  {
    key: "pe",
    field: "price_earnings_ttm",
    label: "P/E",
    unit: "×",
    period: "TTM",
    help: "Price / trailing 12-month earnings. Non-positive values are not meaningful for P/E comparisons.",
    positiveOnly: true,
  },
  {
    key: "pb",
    field: "price_book_fq",
    label: "P/B",
    unit: "×",
    period: "Latest quarter",
    help: "Price / latest reported book value.",
  },
  {
    key: "revenueGrowth",
    field: "total_revenue_yoy_growth_ttm",
    label: "Revenue growth",
    unit: "%",
    period: "TTM, year over year",
    help: "Trailing 12-month revenue growth compared with the prior-year period.",
  },
  {
    key: "epsGrowth",
    field: "earnings_per_share_diluted_yoy_growth_ttm",
    label: "EPS growth",
    unit: "%",
    period: "TTM, year over year",
    help: "Diluted earnings per share growth, year over year. Base effects can distort growth rates.",
  },
  {
    key: "roe",
    field: "return_on_equity",
    label: "Return on equity",
    unit: "%",
    period: "TTM",
    help: "Reported return on equity. Negative equity can make this ratio misleading.",
  },
  {
    key: "debtEquity",
    field: "debt_to_equity",
    label: "Debt / equity",
    unit: "×",
    period: "Latest quarter",
    help: "Reported debt-to-equity ratio. Compare companies in similar sectors; banks require different interpretation.",
  },
  {
    key: "dividendYield",
    field: "dividends_yield_current",
    label: "Dividend yield",
    unit: "%",
    period: "Current provider value",
    help: "Reported current dividend yield, not a promise of future dividends.",
  },
];
export const SCREEN_PRESETS = [
  {
    name: "Growing earnings",
    description: "Revenue and EPS growth at least 10%",
    filters: { revenueGrowthMin: "10", epsGrowthMin: "10" },
  },
  {
    name: "ROE & low debt",
    description: "ROE at least 15%; debt/equity up to 1×",
    filters: { roeMin: "15", debtEquityMax: "1" },
  },
  {
    name: "Dividend income",
    description: "Dividend yield at least 2%",
    filters: { dividendYieldMin: "2" },
  },
];
export function parseScreenFilters(query = {}) {
  const filters = {};
  for (const metric of FUNDAMENTALS) {
    const bounds = {};
    for (const suffix of ["Min", "Max"]) {
      const key = metric.key + suffix;
      const raw = query[key];
      if (raw == null || raw === "" || (typeof raw === "string" && !raw.trim()))
        continue;
      if (
        typeof raw !== "string" ||
        !Number.isFinite(Number(raw)) ||
        Math.abs(Number(raw)) > 1e12
      )
        throw new RangeError(`Enter a valid number for ${metric.label}.`);
      bounds[suffix.toLowerCase()] = Number(raw);
    }
    if (bounds.min != null && bounds.max != null && bounds.min > bounds.max)
      throw new RangeError(`${metric.label}: minimum cannot exceed maximum.`);
    if (Object.keys(bounds).length) filters[metric.key] = bounds;
  }
  return filters;
}
export function matchesScreen(stock, filters) {
  return FUNDAMENTALS.every((metric) => {
    const bounds = filters[metric.key];
    if (!bounds) return true;
    const value = stock[metric.key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (metric.positiveOnly && value <= 0)
    )
      return false;
    return (
      (bounds.min == null || value >= bounds.min) &&
      (bounds.max == null || value <= bounds.max)
    );
  });
}
