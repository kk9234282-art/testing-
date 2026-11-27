import { createNewsLoader } from "./news-feeds.js";
import { readQuery } from "../shared/query.js";
import { parseCompanyChart, parseCompanyResults } from "./company-data.js";
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
  const loadNews = createNewsLoader({ fetchData, now });
  const cache = new Map(),
    pending = new Map(),
    progress = new Map();
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    let symbol, section, range, name, stream;
    try {
      symbol = identity(req);
      section = readQuery(req.query, "section", "chart", 20);
      range = readQuery(req.query, "range", "1y", 10);
      name = readQuery(req.query, "name", "", 200);
      const streaming = readQuery(req.query, "stream", "0", 1);
      if (!["0", "1"].includes(streaming) || (streaming === "1" && section !== "news"))
        throw new RangeError("Unsupported news stream option.");
      stream = streaming === "1";
      if (
        !["chart", "news", "results", "dividends"].includes(section) ||
        !Object.hasOwn(CHART_RANGES, range)
      )
        throw new RangeError("Unsupported research section or chart range.");
    } catch (error) {
      return res.status(400).json({
        error:
          error instanceof RangeError ? error.message : "Unsupported request.",
      });
    }
    const [exchange, ticker] = symbol.split(":"),
      providerSymbol = `${ticker}.${exchange === "BSE" ? "BO" : "NS"}`;
    const kind = section === "dividends" ? "chart" : section,
      chartRange = section === "dividends" ? "1y" : range;
    const key = `${symbol}:${kind}:${kind === "chart" ? chartRange : kind === "news" ? name : ""}`;
    const send = (entry) => {
      if (entry.error)
        return res.status(502).json({
          error:
            "Free company data is unavailable. Retry later; no sample values substituted.",
        });
      const data =
        section === "dividends"
          ? { dividends: entry.data.dividends, currency: entry.data.currency }
          : entry.data;
      if (data.allSourcesUnavailable) res.status(502);
      return res.json({
        ...data,
        symbol,
        section,
        range: kind === "chart" ? chartRange : null,
        source:
          section === "news"
            ? "Yahoo Finance + public RSS feeds"
            : "Yahoo Finance (unofficial)",
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
      if (kind === "news") progress.set(key, { listeners: new Set(), latest: null });
      request = (async () => {
        let entry;
        try {
          let data;
          if (kind === "news")
            data = await loadNews({ providerSymbol, ticker, name, onProgress: (data) => {
              const channel = progress.get(key);
              if (!channel) return;
              channel.latest = data;
              for (const listener of channel.listeners) {
                try { listener(data); } catch {}
              }
            } });
          else {
            const encoded = encodeURIComponent(providerSymbol);
            let url;
            if (kind === "chart")
              url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=${CHART_RANGES[chartRange]}&events=div`;
            else
              url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encoded}?${new URLSearchParams({ type: "quarterlyTotalRevenue,quarterlyNetIncome,quarterlyDilutedEPS", period1: String(Math.floor(now() / 1000) - 3 * 366 * 86400), period2: String(Math.floor(now() / 1000)) })}`;
            const response = await fetchData(url, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            if (!response.ok) throw new Error("Provider unavailable");
            const payload = await response.json();
            data =
              kind === "chart"
                ? parseCompanyChart(payload, providerSymbol)
                : parseCompanyResults(payload, providerSymbol);
          }
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
    let unsubscribe = () => {};
    try {
      if (!stream) return send(await request);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.flushHeaders?.();
      let closed = false;
      const envelope = (data, fetchedAt = new Date(now()).toISOString()) => ({
        ...data, symbol, section, range: null,
        source: "Yahoo Finance + public RSS feeds", fetchedAt,
      });
      const write = (type, data) => {
        if (!closed && !res.destroyed && !res.writableEnded)
          res.write(JSON.stringify({ type, data }) + "\n");
      };
      const listener = (data) => write("progress", envelope(data));
      const channel = progress.get(key);
      channel?.listeners.add(listener);
      const onClose = () => { closed = true; channel?.listeners.delete(listener); };
      res.once?.("close", onClose);
      unsubscribe = () => {
        channel?.listeners.delete(listener);
        res.removeListener?.("close", onClose);
      };
      if (channel?.latest) listener(channel.latest);
      const entry = await request;
      if (entry.error || entry.data.allSourcesUnavailable)
        write("error", envelope(entry.data || { articles: [], sources: [] }, entry.fetchedAt));
      else write("complete", envelope(entry.data, entry.fetchedAt));
      if (!closed && !res.destroyed && !res.writableEnded) res.end();
      return;
    } finally {
      unsubscribe();
      if (pending.get(key) === request) {
        pending.delete(key);
        progress.delete(key);
      }
    }
  };
}
export default createCompanyHandler();
