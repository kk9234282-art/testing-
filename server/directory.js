const COLUMNS = [
  "name",
  "description",
  "close",
  "change",
  "volume",
  "market_cap_basic",
  "sector",
  "exchange",
];
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const CAP_RANGES = {
  mega: { label: "₹1 lakh crore+", min: 1e12, max: Infinity },
  large: { label: "₹20,000 cr – ₹1 lakh cr", min: 2e11, max: 1e12 },
  mid: { label: "₹5,000 – ₹20,000 cr", min: 5e10, max: 2e11 },
  small: { label: "Under ₹5,000 crore", min: 0, max: 5e10 },
  unknown: { label: "Market cap unavailable" },
};

export function normalizeScanner(payload, fetchedAt) {
  if (
    !Array.isArray(payload?.data) ||
    !Number.isInteger(payload.totalCount) ||
    payload.totalCount < 1
  ) {
    throw new Error("Market directory returned invalid data");
  }
  if (payload.data.length !== payload.totalCount)
    throw new Error("Incomplete market directory");
  const seen = new Set();
  return payload.data.map((row) => {
    if (
      !Array.isArray(row.d) ||
      row.d.length !== COLUMNS.length ||
      !/^(NSE|BSE):[A-Z0-9&_.!-]{1,40}$/.test(row.s)
    ) {
      throw new Error("Invalid stock listing");
    }
    if (seen.has(row.s)) throw new Error("Duplicate stock listing");
    seen.add(row.s);
    const [symbol, name, price, change, volume, marketCap, sector, exchange] =
      row.d;
    if (
      typeof symbol !== "string" ||
      typeof name !== "string" ||
      !["NSE", "BSE"].includes(exchange) ||
      row.s !== `${exchange}:${symbol}`
    ) {
      throw new Error("Invalid listing identity");
    }
    return {
      id: row.s,
      symbol,
      name,
      exchange,
      sector: typeof sector === "string" && sector ? sector : "Unclassified",
      price: finite(price),
      change: finite(change),
      volume: finite(volume),
      marketCap: finite(marketCap),
      logo: symbol.slice(0, 2),
      fetchedAt,
    };
  });
}

// Missing values always sort last, in either direction.
export function compareStocks(a, b, key, direction) {
  const av = a[key],
    bv = b[key];
  if (av == null && bv == null) return a.id.localeCompare(b.id);
  if (av == null) return 1;
  if (bv == null) return -1;
  const result = typeof av === "string" ? av.localeCompare(bv) : av - bv;
  return result * (direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
}

export function filterDirectory(stocks, query = {}) {
  const one = (key, fallback = "") =>
    typeof query[key] === "string" ? query[key] : fallback;
  const search = one("search").trim().toLowerCase().slice(0, 100);
  const sector = one("sector");
  const exchange = one("exchange");
  const category = one("category");
  const tab = one("tab");
  const sort = ["marketCap", "price", "change", "volume", "name"].includes(
    one("sort"),
  )
    ? one("sort")
    : "marketCap";
  const direction = one("direction") === "asc" ? "asc" : "desc";
  const pageSize = Math.max(
    1,
    Math.min(100, Math.floor(Number(one("pageSize", "25"))) || 25),
  );
  const watched = new Set(one("watch").split(",").filter(Boolean));
  const range = CAP_RANGES[category];
  const filtered = stocks
    .filter(
      (stock) =>
        (!search ||
          `${stock.name} ${stock.symbol}`.toLowerCase().includes(search)) &&
        (!sector || stock.sector === sector) &&
        (!exchange || stock.exchange === exchange) &&
        (!range ||
          (category === "unknown"
            ? stock.marketCap == null
            : stock.marketCap != null &&
              stock.marketCap >= range.min &&
              stock.marketCap < range.max)) &&
        (tab !== "Gainers" || stock.change > 0) &&
        (tab !== "Losers" || stock.change < 0) &&
        (tab !== "Watchlist" ||
          watched.has(stock.id) ||
          watched.has(stock.symbol)),
    )
    .sort((a, b) => compareStocks(a, b, sort, direction));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(
    pages,
    Math.max(1, Math.floor(Number(one("page", "1"))) || 1),
  );
  return {
    stocks: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    universeTotal: stocks.length,
    page,
    pageSize,
    pages,
    sort,
    direction,
    sectors: [...new Set(stocks.map((stock) => stock.sector))].sort(),
    categories: Object.entries(CAP_RANGES).map(([id, { label }]) => ({
      id,
      label,
    })),
  };
}

export function createDirectoryLoader({
  fetchData = globalThis.fetch,
  now = Date.now,
} = {}) {
  let cached = null;
  let pending = null;
  return async function loadDirectory() {
    if (cached && now() - cached.time < 15 * 60 * 1000) return cached.snapshot;
    if (pending) return pending;
    pending = (async () => {
      const rows = [];
      let total = null;
      let batches = 0;
      // Fetch in bounded batches and verify completeness before presenting a global ranking.
      while (total == null || rows.length < total) {
        if (++batches > 5)
          throw new Error(
            "Provider did not supply the requested directory batches",
          );
        const response = await fetchData(
          "https://scanner.tradingview.com/india/scan",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(18000),
            body: JSON.stringify({
              filter: [
                { left: "type", operation: "equal", right: "stock" },
                {
                  left: "exchange",
                  operation: "in_range",
                  right: ["NSE", "BSE"],
                },
              ],
              columns: COLUMNS,
              sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
              range: [rows.length, rows.length + 10000],
            }),
          },
        );
        if (!response.ok)
          throw new Error(`Directory provider HTTP ${response.status}`);
        const data = await response.json();
        if (
          !Number.isInteger(data.totalCount) ||
          data.totalCount < 1 ||
          data.totalCount > 50000 ||
          !Array.isArray(data.data) ||
          !data.data.length
        )
          throw new Error("Invalid directory response");
        if (total != null && total !== data.totalCount)
          throw new Error("Directory changed during retrieval; retry");
        total = data.totalCount;
        rows.push(...data.data);
        if (rows.length > total) throw new Error("Invalid directory size");
      }
      const fetchedAt = new Date(now()).toISOString();
      const snapshot = {
        stocks: normalizeScanner({ totalCount: total, data: rows }, fetchedAt),
        fetchedAt,
      };
      cached = { time: now(), snapshot };
      return snapshot;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

export function createStocksHandler({
  loadDirectory = createDirectoryLoader(),
} = {}) {
  return async function stocksHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const snapshot = await loadDirectory();
      return res.json({
        ...filterDirectory(snapshot.stocks, req.query),
        fetchedAt: snapshot.fetchedAt,
        source: "TradingView public scanner (unofficial)",
        coverage:
          "NSE and BSE stock listings available from the provider; dual listings count separately.",
      });
    } catch {
      return res
        .status(502)
        .json({
          error:
            "Market directory is unavailable. Retry or select Sample data to explore the 12-stock demo. No sample quotes have been substituted.",
        });
    }
  };
}
export default createStocksHandler();
