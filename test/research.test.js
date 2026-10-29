import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNDAMENTALS,
  parseScreenFilters,
  matchesScreen,
} from "../shared/fundamentals.js";
import {
  CORE_COLUMNS,
  EXTENDED_COLUMNS,
  normalizeScanner,
  filterDirectory,
  createDirectoryLoader,
  createStocksHandler,
} from "../server/directory.js";
const base = (symbol = "AAA") => ({
  s: `NSE:${symbol}`,
  d: [symbol, `${symbol} Company`, 100, 2, 10000, 1e12, "Technology", "NSE"],
});
const fixtures = [
  {
    id: "NSE:AAA",
    symbol: "AAA",
    name: "AAA Company",
    pe: 18,
    pb: 3,
    revenueGrowth: 12,
    epsGrowth: 20,
    roe: 18,
    debtEquity: 0,
    dividendYield: 2,
    marketCap: 3e12,
  },
  {
    id: "NSE:BBB",
    symbol: "BBB",
    name: "BBB Company",
    pe: -8,
    pb: 1,
    revenueGrowth: -5,
    epsGrowth: -10,
    roe: -3,
    debtEquity: 2,
    dividendYield: 0,
    marketCap: 1e12,
  },
  {
    id: "BSE:CCC",
    symbol: "CCC",
    name: "CCC Company",
    pe: null,
    pb: null,
    revenueGrowth: null,
    epsGrowth: null,
    roe: null,
    debtEquity: null,
    dividendYield: null,
    marketCap: 2e12,
  },
];
function response() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("normalizes every optional financial field without scaling or inventing missing values", () => {
  const row = base();
  row.d.push(18, 3, 12, 20, 18, 0, 2);
  const [stock] = normalizeScanner(
    { totalCount: 1, data: [row] },
    "2026-10-29",
    EXTENDED_COLUMNS,
  );
  for (const metric of FUNDAMENTALS)
    assert.equal(stock[metric.key], fixtures[0][metric.key]);
  const [minimal] = normalizeScanner(
    { totalCount: 1, data: [base()] },
    "2026-10-29",
  );
  assert.ok(FUNDAMENTALS.every((m) => minimal[m.key] === null));
});

test("inclusive financial ranges handle zero, negative growth and missing values", () => {
  const screen = parseScreenFilters({
    debtEquityMax: "0",
    revenueGrowthMin: "10",
    peMax: "20",
  });
  assert.ok(matchesScreen(fixtures[0], screen));
  assert.equal(matchesScreen(fixtures[1], screen), false);
  assert.equal(matchesScreen(fixtures[2], screen), false);
  assert.equal(
    filterDirectory(fixtures, { dividendYieldMax: "0" }).stocks[0].id,
    "NSE:BBB",
  );
  assert.equal(
    filterDirectory(fixtures, {
      revenueGrowthMin: "-10",
      revenueGrowthMax: "0",
    }).stocks[0].id,
    "NSE:BBB",
  );
  assert.equal(filterDirectory(fixtures, {}).stocks.length, 3);
  // Loss-making companies do not match a "low P/E" filter.
  assert.deepEqual(
    filterDirectory(fixtures, { peMax: "30" }).stocks.map((s) => s.id),
    ["NSE:AAA"],
  );
});

test("financial screening and sorting occur before pagination; counts and coverage describe the universe", () => {
  const result = filterDirectory(fixtures, { roeMin: "0", pageSize: "1" });
  assert.equal(result.total, 1);
  assert.equal(result.universeTotal, 3);
  assert.equal(result.fundamentalCoverage.roe, 2);
  const sorted = filterDirectory(fixtures, { sort: "pe", direction: "asc" });
  assert.equal(sorted.stocks[0].id, "NSE:AAA");
  assert.deepEqual(
    filterDirectory(fixtures, {
      sort: "revenueGrowth",
      direction: "asc",
    }).stocks.map((s) => s.id),
    ["NSE:BBB", "NSE:AAA", "BSE:CCC"],
  );
});

test("range validation rejects inverted, nonfinite and repeated query values", () => {
  for (const query of [
    { peMin: "30", peMax: "10" },
    { roeMin: "NaN" },
    { debtEquityMax: "Infinity" },
    { dividendYieldMin: ["1", "2"] },
  ])
    assert.throws(() => parseScreenFilters(query), RangeError);
  assert.deepEqual(parseScreenFilters({ peMin: " ", roeMax: "" }), {});
});

test("comparison returns exactly requested IDs independently of current page, preserving exchange identity", () => {
  const result = filterDirectory(fixtures, {
    ids: "NSE:BBB,BSE:CCC",
    pageSize: "4",
  });
  assert.deepEqual(
    new Set(result.stocks.map((s) => s.id)),
    new Set(["NSE:BBB", "BSE:CCC"]),
  );
  assert.throws(
    () =>
      filterDirectory(fixtures, {
        ids: "NSE:AAA,NSE:BBB,NSE:CCC,NSE:DDD,NSE:EEE",
      }),
    RangeError,
  );
  assert.throws(() => filterDirectory(fixtures, { ids: "../AAA" }), RangeError);
});

test("unsupported optional columns fall back to core directory while keeping fundamentals null", async () => {
  const requests = [];
  const load = createDirectoryLoader({
    fetchData: async (url, opts) => {
      const body = JSON.parse(opts.body);
      requests.push(body);
      if (requests.length === 1) return { ok: false, status: 400 };
      return {
        ok: true,
        json: async () => ({ totalCount: 1, data: [base()] }),
      };
    },
  });
  const snapshot = await load();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].columns, CORE_COLUMNS);
  assert.equal(snapshot.stocks[0].price, 100);
  assert.equal(snapshot.stocks[0].pe, null);
  assert.equal(filterDirectory(snapshot.stocks, { peMax: "20" }).total, 0);
});

test("rate limiting does not trigger an additional optional-fields retry", async () => {
  let calls = 0;
  const load = createDirectoryLoader({
    fetchData: async () => {
      calls++;
      return { ok: false, status: 429 };
    },
  });
  await assert.rejects(load());
  assert.equal(calls, 1);
});

test("API validates screener input before any provider request", async () => {
  let calls = 0;
  const handler = createStocksHandler({
    loadDirectory: async () => {
      calls++;
      throw Error("must not fetch");
    },
  });
  for (const query of [{ roeMin: "20", roeMax: "10" }, { ids: "invalid" }]) {
    const res = response();
    await handler({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});
