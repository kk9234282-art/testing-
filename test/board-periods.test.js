import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDirectory, createStocksHandler } from "../server/directory.js";
const stocks = [
  {
    id: "NSE:A",
    symbol: "A",
    name: "Company A",
    exchange: "NSE",
    marketCap: 100,
    price: 10,
    change: 1,
    changeWeek: -5,
    changeMonth: 20,
    changeYear: 40,
  },
  {
    id: "NSE:B",
    symbol: "B",
    name: "Company B",
    exchange: "NSE",
    marketCap: 80,
    price: 20,
    change: -1,
    changeWeek: 3,
    changeMonth: null,
    changeYear: -10,
  },
  {
    id: "NSE:C",
    symbol: "C",
    name: "Company C",
    exchange: "NSE",
    marketCap: 50,
    price: 30,
    change: 2,
    changeWeek: null,
    changeMonth: -2,
    changeYear: null,
  },
];
test("board period returns remain separate from daily price and chart fields", () => {
  for (const [period, key] of [
    ["24h", "change"],
    ["1w", "changeWeek"],
    ["1m", "changeMonth"],
    ["1y", "changeYear"],
  ]) {
    const result = filterDirectory(stocks, { period });
    assert.equal(result.period, period);
    for (const row of result.stocks) {
      const original = stocks.find((s) => s.id === row.id);
      assert.equal(row.boardChange, original[key] ?? null);
      assert.equal(row.change, original.change);
      assert.equal(row.price, original.price);
    }
  }
});
test("gainers, losers and change sorting use the selected period before pagination with missing values last", () => {
  assert.deepEqual(
    filterDirectory(stocks, { period: "1w", tab: "Gainers" }).stocks.map(
      (s) => s.id,
    ),
    ["NSE:B"],
  );
  assert.deepEqual(
    filterDirectory(stocks, { period: "1w", tab: "Losers" }).stocks.map(
      (s) => s.id,
    ),
    ["NSE:A"],
  );
  const desc = filterDirectory(stocks, {
    period: "1y",
    sort: "change",
    pageSize: "1",
    page: "2",
  });
  assert.equal(desc.stocks[0].id, "NSE:B");
  assert.equal(desc.pages, 3);
  const asc = filterDirectory(stocks, {
    period: "1y",
    sort: "change",
    direction: "asc",
  });
  assert.deepEqual(
    asc.stocks.map((s) => s.id),
    ["NSE:B", "NSE:A", "NSE:C"],
  );
  assert.equal(
    filterDirectory(stocks, { period: "1m" }).stocks.find(
      (s) => s.id === "NSE:B",
    ).boardChange,
    null,
  );
});
test("stock API validates board periods before provider requests", async () => {
  let calls = 0;
  const handler = createStocksHandler({
    loadDirectory: async () => {
      calls++;
      return { stocks, fetchedAt: "2026-11-19T10:00:00Z" };
    },
  });
  const response = () => ({
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
  });
  for (const period of ["year", ["1y"], "__proto__"]) {
    const res = response();
    await handler({ method: "GET", query: { period } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
  const res = response();
  await handler({ method: "GET", query: { period: "1y" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.period, "1y");
  assert.equal(res.body.stocks[0].boardChange, 40);
});
