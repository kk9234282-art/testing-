import { readQuery } from "../shared/query.js";
import {
  parseCompanyChart,
  parseCompanyNews,
  parseCompanyResults,
} from "./company-data.js";
export const CHART_RANGES = {
  "1m": "1mo",
  "3m": "3mo",
  "6m": "6mo",
  "1y": "1y",
  "5y": "5y",
};
function identity(req) {
  let symbol = req.params?.symbol;
  if (symbol == null && req.url) {
    const match = /^\/api\/company\/([^/]+)$/.exec(
      new URL(req.url, "http://localhost").pathname,
    );
    if (match) symbol = decodeURIComponent(match[1]);
  }
  if (symbol == null) symbol = req.query?.symbol;
  if (
    typeof symbol !== "string" ||
    !/^(NSE|BSE):[A-Z0-9][A-Z0-9&_.!-]{0,39}$/.test(symbol)
  )
    throw new RangeError("Unsupported company symbol.");
  return symbol;
}
export function createCompanyHandler({
  fetchData = globalThis.fetch,
  now = Date.now,
  maxConcurrent = 6,
} = {}) {
  const cache = new Map(),
    pending = new Map();
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    let symbol, section, range;
    try {
      symbol = identity(req);
      section = readQuery(req.query, "section", "chart", 20);
      range = readQuery(req.query, "range", "1y", 10);
      if (
        !["chart", "news", "results", "dividends"].includes(section) ||
        !Object.hasOwn(CHART_RANGES, range)
      )
        throw new RangeError("Unsupported research section or chart range.");
    } catch (error) {
      return res
        .status(400)
        .json({
          error:
            error instanceof RangeError
              ? error.message
              : "Unsupported request.",
        });
    }
    const [exchange, ticker] = symbol.split(":"),
      providerSymbol = `${ticker}.${exchange === "BSE" ? "BO" : "NS"}`;
    const kind = section === "dividends" ? "chart" : section,
      chartRange = section === "dividends" ? "1y" : range;
    const key = `${symbol}:${kind}:${kind === "chart" ? chartRange : ""}`;
    const send = (entry) => {
      if (entry.error)
        return res
          .status(502)
          .json({
            error:
              "Free company data is unavailable. Retry later; no sample values substituted.",
          });
      const data =
        section === "dividends"
          ? { dividends: entry.data.dividends, currency: entry.data.currency }
          : entry.data;
      return res.json({
        ...data,
        symbol,
        section,
        range: kind === "chart" ? chartRange : null,
        source: "Yahoo Finance (unofficial)",
        fetchedAt: entry.fetchedAt,
      });
    };
    const cached = cache.get(key);
    if (cached && now() < cached.expires) return send(cached);
    let request = pending.get(key);
    if (!request) {
      if (pending.size >= maxConcurrent) {
        res.setHeader("Retry-After", "15");
        return res
          .status(429)
          .json({ error: "Too many company requests. Retry shortly." });
      }
      request = (async () => {
        let entry;
        try {
          const encoded = encodeURIComponent(providerSymbol);
          let url;
          if (kind === "chart")
            url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=${CHART_RANGES[chartRange]}&events=div`;
          else if (kind === "news")
            url = `https://query1.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: providerSymbol, quotesCount: "0", newsCount: "15" })}`;
          else
            url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encoded}?${new URLSearchParams({ type: "quarterlyTotalRevenue,quarterlyNetIncome,quarterlyDilutedEPS", period1: String(Math.floor(now() / 1000) - 3 * 366 * 86400), period2: String(Math.floor(now() / 1000)) })}`;
          const response = await fetchData(url, {
            signal: AbortSignal.timeout(10000),
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          if (!response.ok) throw new Error("Provider unavailable");
          const payload = await response.json();
          const data =
            kind === "chart"
              ? parseCompanyChart(payload, providerSymbol)
              : kind === "news"
                ? parseCompanyNews(payload, providerSymbol)
                : parseCompanyResults(payload, providerSymbol);
          entry = {
            data,
            fetchedAt: new Date(now()).toISOString(),
            expires: now() + (kind === "results" ? 6 * 3600000 : 900000),
          };
        } catch {
          entry = { error: true, expires: now() + 900000 };
        }
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, entry);
        return entry;
      })();
      pending.set(key, request);
    }
    try {
      return send(await request);
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  };
}
export default createCompanyHandler();
