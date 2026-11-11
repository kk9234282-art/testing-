import { readQuery, integerQuery } from "../shared/query.js";
import { companyListings, matchesListing } from "../shared/listings.js";
import {
  FUNDAMENTALS,
  parseScreenFilters,
  matchesScreen,
} from "../shared/fundamentals.js";
import { cleanLabel, sectorOf, industryOf } from "../shared/classification.js";
export const CORE_COLUMNS = [
  "name",
  "description",
  "close",
  "change",
  "volume",
  "market_cap_basic",
  "sector",
  "exchange",
];
export const CLASSIFIED_COLUMNS = [...CORE_COLUMNS, "industry"];
export const FUNDAMENTAL_COLUMNS = [
  ...CLASSIFIED_COLUMNS,
  ...FUNDAMENTALS.map((metric) => metric.field),
];
export const EXTENDED_COLUMNS = [...FUNDAMENTAL_COLUMNS, "Perf.W", "Perf.1M"];
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const CAP_RANGES = {
  mega: { label: "₹1 lakh crore+", min: 1e12, max: Infinity },
  large: { label: "₹20,000 cr – ₹1 lakh cr", min: 2e11, max: 1e12 },
  mid: { label: "₹5,000 – ₹20,000 cr", min: 5e10, max: 2e11 },
  small: { label: "Under ₹5,000 crore", min: 0, max: 5e10 },
  unknown: { label: "Market cap unavailable" },
};

export function normalizeScanner(payload, fetchedAt, columns = CORE_COLUMNS) {
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
      row.d.length !== columns.length ||
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
    const fundamentals = Object.fromEntries(
      FUNDAMENTALS.map((metric) => [
        metric.key,
        finite(row.d[columns.indexOf(metric.field)]),
      ]),
    );
    return {
      ...fundamentals,
      id: row.s,
      symbol,
      name,
      exchange,
      sector: cleanLabel(sector) || "Unclassified",
      industry: cleanLabel(row.d[columns.indexOf("industry")]),
      isin: cleanLabel(row.d[columns.indexOf("isin")]),
      changeWeek: finite(row.d[columns.indexOf("Perf.W")]),
      changeMonth: finite(row.d[columns.indexOf("Perf.1M")]),
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
  const av = key === "pe" && a[key] <= 0 ? null : a[key],
    bv = key === "pe" && b[key] <= 0 ? null : b[key];
  if (av == null && bv == null) return a.id.localeCompare(b.id);
  if (av == null) return 1;
  if (bv == null) return -1;
  const result = typeof av === "string" ? av.localeCompare(bv) : av - bv;
  return result * (direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
}

export function filterDirectory(stocks, query = {}) {
  const one = (key, fallback = "") =>
    readQuery(query, key, fallback, key === "watch" ? 30000 : 250);
  const screen = parseScreenFilters(query);
  const idsValue = one("ids");
  const ids = idsValue ? idsValue.split(",") : null;
  if (
    ids &&
    (ids.length > 4 ||
      ids.some((id) => !/^(NSE|BSE):[A-Z0-9&_.!-]{1,40}$/.test(id)))
  )
    throw new RangeError("Select up to four valid stock listings.");
  const search = one("search").trim().toLowerCase().slice(0, 100);
  const sector = one("sector");
  const industry = one("industry");
  const exchange = one("exchange");
  if (!["", "NSE", "BSE"].includes(exchange))
    throw new RangeError("Invalid exchange parameter.");
  const category = one("category");
  if (category && !Object.hasOwn(CAP_RANGES, category))
    throw new RangeError("Invalid category parameter.");
  const tab = one("tab");
  const sort = [
    "marketCap",
    "price",
    "change",
    "volume",
    "name",
    ...FUNDAMENTALS.map((metric) => metric.key),
  ].includes(one("sort"))
    ? one("sort")
    : "marketCap";
  const direction = one("direction") === "asc" ? "asc" : "desc";
  const pageSize = integerQuery(query, "pageSize", 25, 1, 100);
  const requestedPage = integerQuery(query, "page", 1, 1, 1000000);
  const watched = new Set(one("watch").split(",").filter(Boolean));
  const range = category ? CAP_RANGES[category] : null;
  const allCompanies = companyListings(stocks);
  const companies = exchange ? companyListings(stocks, exchange) : allCompanies;
  const filtered = companies
    .filter(
      (stock) =>
        (!ids || ids.some((id) => matchesListing(stock, id))) &&
        matchesScreen(stock, screen) &&
        (!search ||
          `${stock.name} ${(stock.symbols || [stock.symbol]).join(" ")} ${(stock.listings || []).map((s) => s.name).join(" ")}`
            .toLowerCase()
            .includes(search)) &&
        (!sector || sectorOf(stock) === sector) &&
        (!industry ||
          (industry === "__missing__"
            ? !industryOf(stock)
            : industryOf(stock) === industry)) &&
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
          [...watched].some((key) => matchesListing(stock, key))),
    )
    .sort((a, b) => compareStocks(a, b, sort, direction));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, requestedPage);
  return {
    stocks: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    universeTotal: allCompanies.length,
    listingTotal: stocks.length,
    page,
    pageSize,
    pages,
    sort,
    direction,
    fundamentalCoverage: Object.fromEntries(
      FUNDAMENTALS.map((metric) => [
        metric.key,
        allCompanies.filter(
          (stock) =>
            typeof stock[metric.key] === "number" &&
            Number.isFinite(stock[metric.key]),
        ).length,
      ]),
    ),
    sectors: [...new Set(allCompanies.map(sectorOf))].sort(),
    industries: [
      ...new Set(
        companies
          .filter(
            (stock) =>
              (!sector || sectorOf(stock) === sector) &&
              (!exchange || stock.exchange === exchange),
          )
          .map(industryOf)
          .filter(Boolean),
      ),
    ].sort(),
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
      const started = now();
      const requestOptions = () => {
        const remaining = 50000 - (now() - started);
        if (remaining <= 0)
          throw new Error("Directory request exceeded its total deadline");
        return { signal: AbortSignal.timeout(Math.min(18000, remaining)) };
      };
      const rows = [];
      let columns = EXTENDED_COLUMNS;
      let total = null;
      let batches = 0;
      // Fetch in bounded batches and verify completeness before presenting a global ranking.
      while (total == null || rows.length < total) {
        if (++batches > 5)
          throw new Error(
            "Provider did not supply the requested directory batches",
          );
        let response = await fetchData(
          "https://scanner.tradingview.com/india/scan",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            ...requestOptions(),
            body: JSON.stringify({
              filter: [
                { left: "type", operation: "equal", right: "stock" },
                {
                  left: "exchange",
                  operation: "in_range",
                  right: ["NSE", "BSE"],
                },
              ],
              columns,
              sort: { sortBy: "name", sortOrder: "asc" },
              range: [rows.length, rows.length + 10000],
            }),
          },
        );
        // An optional field must never take the basic market directory offline.
        while (
          [400, 422].includes(response.status) &&
          columns !== CORE_COLUMNS &&
          rows.length === 0
        ) {
          columns =
            columns === EXTENDED_COLUMNS
              ? FUNDAMENTAL_COLUMNS
              : columns === FUNDAMENTAL_COLUMNS
                ? CLASSIFIED_COLUMNS
                : CORE_COLUMNS;
          const body = {
            filter: [
              { left: "type", operation: "equal", right: "stock" },
              {
                left: "exchange",
                operation: "in_range",
                right: ["NSE", "BSE"],
              },
            ],
            columns,
            sort: { sortBy: "name", sortOrder: "asc" },
            range: [0, 10000],
          };
          response = await fetchData(
            "https://scanner.tradingview.com/india/scan",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              ...requestOptions(),
              body: JSON.stringify(body),
            },
          );
        }
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
        stocks: normalizeScanner(
          { totalCount: total, data: rows },
          fetchedAt,
          columns,
        ),
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
      filterDirectory([], req.query);
      const snapshot = await loadDirectory();
      return res.json({
        ...filterDirectory(snapshot.stocks, req.query),
        fetchedAt: snapshot.fetchedAt,
        source: "TradingView public scanner (unofficial)",
        coverage:
          "Companies available from the provider, combining matched NSE/BSE listings. Combined rows prefer NSE quotes.",
      });
    } catch (error) {
      if (error instanceof RangeError)
        return res.status(400).json({ error: error.message });
      return res.status(502).json({
        error:
          "Market directory is unavailable. Retry or select Sample data to explore the 12-stock demo. No sample quotes have been substituted.",
      });
    }
  };
}
export const loadDirectorySnapshot = createDirectoryLoader();
export default createStocksHandler({ loadDirectory: loadDirectorySnapshot });
