// Provider parsing is deliberately strict: missing values never become zero.
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const day = (value) => {
  if (!finite(value) || value <= 0) return null;
  const date = new Date((value + 19800) * 1000);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
};
export function safeNewsLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname !== "localhost"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function parseCompanyChart(payload, providerSymbol) {
  const result = payload?.chart?.result?.[0],
    meta = result?.meta;
  if (
    payload?.chart?.error ||
    meta?.symbol !== providerSymbol ||
    meta.currency !== "INR" ||
    !Array.isArray(result.timestamp)
  )
    throw new Error("Company chart unavailable");
  const quote = result.indicators?.quote?.[0];
  const unique = new Map();
  result.timestamp.forEach((timestamp, i) => {
    const time = day(timestamp),
      open = quote?.open?.[i],
      high = quote?.high?.[i],
      low = quote?.low?.[i],
      close = quote?.close?.[i],
      volume = quote?.volume?.[i];
    if (
      !time ||
      ![open, high, low, close].every((value) => finite(value) && value > 0) ||
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close)
    )
      return;
    unique.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume: finite(volume) && volume >= 0 ? volume : null,
    });
  });
  const candles = [...unique.values()].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const dividends = Object.values(result.events?.dividends || {})
    .flatMap((event) => {
      const exDate = day(event.date);
      return exDate && finite(event.amount) && event.amount >= 0
        ? [
            {
              exDate,
              amount: event.amount,
              currency: "INR",
              recordDate: null,
              paymentDate: null,
            },
          ]
        : [];
    })
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
  return {
    candles,
    dividends,
    currency: "INR",
    asOf:
      finite(meta.regularMarketTime) && day(meta.regularMarketTime)
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : null,
  };
}
export function parseCompanyNews(payload, providerSymbol) {
  if (!Array.isArray(payload?.news))
    throw new Error("Company news unavailable");
  const seen = new Set();
  const articles = payload.news
    .flatMap((item) => {
      const url = safeNewsLink(item.link);
      if (
        !Array.isArray(item.relatedTickers) ||
        !item.relatedTickers.includes(providerSymbol) ||
        typeof item.title !== "string" ||
        !item.title.trim() ||
        !url ||
        seen.has(url) ||
        !day(item.providerPublishTime)
      )
        return [];
      seen.add(url);
      return [
        {
          title: item.title.slice(0, 500),
          publisher:
            typeof item.publisher === "string"
              ? item.publisher.slice(0, 120)
              : "Publisher unavailable",
          url,
          publishedAt: new Date(item.providerPublishTime * 1000).toISOString(),
        },
      ];
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 15);
  return { articles };
}
export function parseCompanyResults(payload, providerSymbol) {
  if (payload?.timeseries?.error || !Array.isArray(payload?.timeseries?.result))
    throw new Error("Quarterly results unavailable");
  const rows = new Map();
  const fields = {
    quarterlyTotalRevenue: "revenue",
    quarterlyNetIncome: "netIncome",
    quarterlyDilutedEPS: "eps",
  };
  for (const series of payload.timeseries.result) {
    if (
      !Array.isArray(series.meta?.symbol) ||
      !series.meta.symbol.includes(providerSymbol)
    )
      continue;
    for (const [field, key] of Object.entries(fields)) {
      for (const item of Array.isArray(series[field]) ? series[field] : []) {
        const date = item.asOfDate;
        if (
          item.periodType !== "3M" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date ||
          !finite(item.reportedValue?.raw) ||
          item.currencyCode !== "INR"
        )
          continue;
        if (!rows.has(date))
          rows.set(date, {
            periodEnd: date,
            revenue: null,
            netIncome: null,
            eps: null,
            currency: "INR",
          });
        rows.get(date)[key] = item.reportedValue.raw;
      }
    }
  }
  return {
    quarters: [...rows.values()]
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
      .slice(0, 8),
    nextEarningsDate: null,
  };
}
