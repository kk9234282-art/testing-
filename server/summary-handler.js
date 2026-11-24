import { loadDirectorySnapshot } from "./directory.js";
import { INDEX_DEFINITIONS, marketBreadth } from "../shared/market-summary.js";
export function parseIndex(definition, payload) {
  const result = payload?.chart?.result?.[0],
    meta = result?.meta;
  if (
    payload?.chart?.error ||
    meta?.symbol !== definition.symbol ||
    meta.currency !== "INR" ||
    !Number.isFinite(meta.regularMarketPrice) ||
    meta.regularMarketPrice <= 0 ||
    !Number.isFinite(meta.regularMarketTime) ||
    meta.regularMarketTime <= 0
  )
    throw new Error("Invalid index quote");
  const asOf = new Date(meta.regularMarketTime * 1000);
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("Invalid index timestamp");
  const previous = [meta.chartPreviousClose, meta.previousClose].find(
    (value) => Number.isFinite(value) && value > 0,
  );
  const closes = result.indicators?.quote?.[0]?.close;
  const history = Array.isArray(closes)
    ? closes.flatMap((price, i) =>
        Number.isFinite(price) &&
        price > 0 &&
        Number.isFinite(result.timestamp?.[i])
          ? [{ price, time: result.timestamp[i] }]
          : [],
      )
    : [];
  return {
    ...definition,
    price: meta.regularMarketPrice,
    change: previous ? (meta.regularMarketPrice / previous - 1) * 100 : null,
    asOf: asOf.toISOString(),
    history,
    status: "available",
  };
}
function allowGet(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return true;
  res.setHeader("Allow", "GET");
  res.status(405).json({ error: "Method not allowed" });
  return false;
}
export function createIndicesHandler({
  fetchData = globalThis.fetch,
  now = Date.now,
} = {}) {
  let cached = null,
    pending = null;
  return async (req, res) => {
    if (!allowGet(req, res)) return;
    if (!cached || now() - cached.time >= 60000) {
      if (!pending)
        pending = (async () => {
          const indices = await Promise.all(
            INDEX_DEFINITIONS.map(async (definition) => {
              try {
                const response = await fetchData(
                  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(definition.symbol)}?interval=5m&range=1d`,
                  {
                    signal: AbortSignal.timeout(10000),
                    headers: { "User-Agent": "Mozilla/5.0" },
                  },
                );
                if (!response.ok) throw new Error("Index provider unavailable");
                return parseIndex(definition, await response.json());
              } catch {
                return {
                  ...definition,
                  status: "unavailable",
                  price: null,
                  change: null,
                  asOf: null,
                  history: [],
                };
              }
            }),
          );
          cached = {
            time: now(),
            data: {
              indices,
              fetchedAt: new Date(now()).toISOString(),
              source: "Yahoo Finance (unofficial)",
              mayBeDelayed: true,
            },
          };
        })().finally(() => {
          pending = null;
        });
      await pending;
    }
    return res.json(cached.data);
  };
}
export function createBreadthHandler({
  loadDirectory = loadDirectorySnapshot,
} = {}) {
  return async (req, res) => {
    if (!allowGet(req, res)) return;
    try {
      const snapshot = await loadDirectory();
      return res.json({
        ...marketBreadth(snapshot.stocks),
        fetchedAt: snapshot.fetchedAt,
        source: "TradingView public scanner (unofficial)",
        scope: "NSE + BSE companies; matched dual listings counted once",
        mayBeDelayed: true,
      });
    } catch {
      return res
        .status(502)
        .json({
          error: "Market breadth unavailable. No sample values substituted.",
        });
    }
  };
}
export const indicesHandler = createIndicesHandler();
export const breadthHandler = createBreadthHandler();
