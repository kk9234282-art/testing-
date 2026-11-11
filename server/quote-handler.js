import { parseChart } from "./market.js";

function requestSymbol(req) {
  if (req.params?.symbol != null) return req.params.symbol;
  if (typeof req.url === "string") {
    const match = /^\/api\/quote\/([^/]+)$/.exec(
      new URL(req.url, "http://localhost").pathname,
    );
    if (match) return decodeURIComponent(match[1]);
  }
  return req.query?.symbol;
}

export function createQuoteHandler({
  fetchQuote = globalThis.fetch,
  now = Date.now,
  maxConcurrent = 8,
} = {}) {
  const cache = new Map(),
    pending = new Map();
  return async function quoteHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    let symbol;
    try {
      symbol = requestSymbol(req);
    } catch {
      return res.status(400).json({ error: "Unsupported symbol" });
    }
    if (
      typeof symbol !== "string" ||
      !/^(?:(?:NSE|BSE):)?[A-Z0-9][A-Z0-9&_.!-]{0,39}$/.test(symbol)
    )
      return res.status(400).json({ error: "Unsupported symbol" });
    const [exchange, ticker] = symbol.includes(":")
      ? symbol.split(":")
      : ["NSE", symbol];
    const key = `${exchange}:${ticker}`,
      providerSymbol = `${ticker}.${exchange === "BSE" ? "BO" : "NS"}`;
    const send = (data) => {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
      return res.json({ ...data, symbol });
    };
    const cached = cache.get(key);
    if (cached && now() - cached.fetched < 60000) return send(cached.data);
    let request = pending.get(key);
    if (!request) {
      if (pending.size >= maxConcurrent) {
        res.setHeader("Retry-After", "1");
        return res
          .status(429)
          .json({
            error:
              "Too many chart requests are in progress. Please retry shortly.",
          });
      }
      request = (async () => {
        const response = await fetchQuote(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}?interval=1d&range=1mo`,
          {
            signal: AbortSignal.timeout(10000),
            headers: { "User-Agent": "Mozilla/5.0" },
          },
        );
        if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
        const quote = parseChart(key, await response.json());
        const data = {
          ...quote,
          source: "Yahoo Finance (unofficial)",
          fetchedAt: new Date(now()).toISOString(),
        };
        if (cache.size >= 500) cache.clear();
        cache.set(key, { fetched: now(), data });
        return data;
      })();
      pending.set(key, request);
    }
    try {
      return send(await request);
    } catch {
      return res
        .status(502)
        .json({
          error:
            "Free market data is unavailable. Try again later or switch to sample data.",
        });
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  };
}
export default createQuoteHandler();
