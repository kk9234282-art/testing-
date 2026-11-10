import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeatmap, heatColor } from "../shared/heatmap.js";
import { createHeatmapHandler } from "../server/heatmap-handler.js";
import {
  normalizeScanner,
  EXTENDED_COLUMNS,
  FUNDAMENTAL_COLUMNS,
  createDirectoryLoader,
} from "../server/directory.js";
const stocks = [
  {
    id: "NSE:A",
    symbol: "A",
    exchange: "NSE",
    sector: "Technology",
    industry: "Software",
    marketCap: 100,
    change: 1,
    changeWeek: -5,
    changeMonth: 20,
  },
  {
    id: "NSE:B",
    symbol: "B",
    exchange: "NSE",
    sector: "Technology",
    industry: "Software",
    marketCap: 300,
    change: -1,
    changeWeek: 3,
    changeMonth: null,
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
const base = [
  "A",
  "Company A",
  100,
  1,
  1000,
  1e12,
  "Technology",
  "NSE",
  "Software",
  20,
  2,
  10,
  15,
  18,
  0.5,
  1,
];
test("each period updates stock returns, weighted sectors and breadth with the corresponding source field", () => {
  const day = buildHeatmap(stocks, { period: "24h" }),
    week = buildHeatmap(stocks, { period: "1w" }),
    month = buildHeatmap(stocks, { period: "1m" });
  assert.equal(day.change, -0.5);
  assert.equal(week.change, 1);
  assert.equal(month.change, 20);
  assert.equal(week.stocks.find((s) => s.id === "NSE:A").heatmapChange, -5);
  assert.equal(week.stocks.find((s) => s.id === "NSE:A").change, 1); // Daily stock detail return stays daily.
  assert.equal(month.stocks.find((s) => s.id === "NSE:B").heatmapChange, null);
  assert.equal(month.missingChange, 1);
  assert.equal(month.advances, 1);
  assert.equal(month.declines, 0);
  assert.equal(month.unchanged, 0);
  assert.equal(month.changeCoverage, 0.25);
  assert.equal(month.stocks[0].heatmapPeriod, "1m");
  assert.equal(month.periodLabel, "1 month");
  assert.equal(buildHeatmap(stocks).period, "24h");
});
test("missing weekly values never reuse daily returns, even when every daily value exists", () => {
  const result = buildHeatmap(
    stocks.map(({ changeWeek, ...s }) => s),
    { period: "1w" },
  );
  assert.equal(result.change, null);
  assert.equal(result.changeCoverage, 0);
  assert.equal(result.missingChange, 2);
  assert.ok(result.sectors.every((s) => s.change === null));
  assert.ok(result.stocks.every((s) => s.heatmapChange === null));
});
test("provider period fields normalize without shifting financials or fabricating returns", () => {
  const [stock] = normalizeScanner(
    { totalCount: 1, data: [{ s: "NSE:A", d: [...base, -5, 20] }] },
    "2026-11-10",
    EXTENDED_COLUMNS,
  );
  assert.equal(stock.pe, 20);
  assert.equal(stock.changeWeek, -5);
  assert.equal(stock.changeMonth, 20);
  const [fallback] = normalizeScanner(
    { totalCount: 1, data: [{ s: "NSE:A", d: base }] },
    "2026-11-10",
    FUNDAMENTAL_COLUMNS,
  );
  assert.equal(fallback.changeWeek, null);
  assert.equal(fallback.pe, 20);
});
test("optional unsupported performance columns preserve financial and industry data", async () => {
  const bodies = [];
  const load = createDirectoryLoader({
    fetchData: async (url, opts) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      if (body.columns.includes("Perf.W")) return { ok: false, status: 400 };
      return {
        ok: true,
        json: async () => ({ totalCount: 1, data: [{ s: "NSE:A", d: base }] }),
      };
    },
  });
  const result = await load();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].columns, FUNDAMENTAL_COLUMNS);
  assert.equal(result.stocks[0].pe, 20);
  assert.equal(result.stocks[0].industry, "Software");
  assert.equal(result.stocks[0].changeMonth, null);
});
test("time periods are validated before any external fetch and appear in API metadata", async () => {
  let calls = 0;
  const handler = createHeatmapHandler({
    loadDirectory: async () => {
      calls++;
      return { stocks, fetchedAt: "2026-11-10T10:00:00Z" };
    },
  });
  for (const period of ["year", "__proto__", ["24h"], ""]) {
    const res = response();
    await handler({ method: "GET", query: { period } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
  const res = response();
  await handler(
    { method: "GET", query: { period: "1w", groupBy: "industry" } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.period, "1w");
  assert.equal(res.body.sectors[0].change, 1);
});
test("legend scaling follows the selected period while missing and zero remain distinct", () => {
  assert.equal(heatColor(5, 5), heatColor(3));
  assert.equal(heatColor(10, 10), heatColor(3));
  assert.equal(heatColor(-10, 10), heatColor(-3));
  assert.notEqual(heatColor(null, 10), heatColor(0, 10));
});
