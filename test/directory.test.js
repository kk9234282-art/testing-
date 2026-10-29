import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeScanner,
  filterDirectory,
  createDirectoryLoader,
  createStocksHandler,
} from "../server/directory.js";
import deployedHandler from "../api/stocks.js";
const at = "2026-10-29T10:00:00.000Z";
const row = (symbol, cap, sector = "Finance", exchange = "NSE") => ({
  s: `${exchange}:${symbol}`,
  d: [symbol, `${symbol} Limited`, 100, 2, 1000, cap, sector, exchange],
});
const source = {
  totalCount: 6,
  data: [
    row("AAA", 2e12),
    row("BBB", 3e11, "Technology"),
    row("CCC", 8e10),
    row("DDD", 1e9, "Energy", "BSE"),
    row("EEE", null, "Technology"),
    row("FFF", 5e10),
  ],
};
const stocks = normalizeScanner(source, at);
function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test("complete NSE/BSE listings preserve cap in rupees, exchange identity and missing values", () => {
  assert.equal(stocks[0].marketCap, 2e12);
  assert.equal(stocks[3].id, "BSE:DDD");
  assert.equal(stocks[4].marketCap, null);
  assert.throws(
    () => normalizeScanner({ ...source, totalCount: 7 }, at),
    /Incomplete/,
  );
  assert.throws(
    () =>
      normalizeScanner(
        { totalCount: 2, data: [source.data[0], source.data[0]] },
        at,
      ),
    /Duplicate/,
  );
});

test("sorts globally before pagination and places unavailable caps last in both directions", () => {
  const desc = filterDirectory(stocks, { pageSize: "2", page: "2" });
  assert.deepEqual(
    desc.stocks.map((s) => s.symbol),
    ["CCC", "FFF"],
  );
  assert.equal(desc.total, 6);
  assert.equal(desc.pages, 3);
  const asc = filterDirectory(stocks, { direction: "asc" });
  assert.deepEqual(
    asc.stocks.map((s) => s.symbol),
    ["DDD", "FFF", "CCC", "BBB", "AAA", "EEE"],
  );
});

test("combines sector, exchange, search, cap categories and watchlist across the full directory", () => {
  assert.deepEqual(
    filterDirectory(stocks, { sector: "Technology" }).stocks.map(
      (s) => s.symbol,
    ),
    ["BBB", "EEE"],
  );
  assert.equal(
    filterDirectory(stocks, { exchange: "BSE" }).stocks[0].symbol,
    "DDD",
  );
  assert.equal(
    filterDirectory(stocks, { search: "bbb limited" }).stocks[0].symbol,
    "BBB",
  );
  assert.deepEqual(
    filterDirectory(stocks, { category: "mid" }).stocks.map((s) => s.symbol),
    ["CCC", "FFF"],
  );
  assert.equal(
    filterDirectory(stocks, { category: "unknown" }).stocks[0].symbol,
    "EEE",
  );
  assert.equal(
    filterDirectory(stocks, { tab: "Watchlist", watch: "BSE:DDD" }).stocks[0]
      .symbol,
    "DDD",
  );
  assert.equal(
    filterDirectory(stocks, { tab: "Watchlist", watch: "AAA" }).stocks[0]
      .symbol,
    "AAA",
  );
  assert.equal(filterDirectory(stocks, { page: "999", pageSize: "2" }).page, 3);
  assert.equal(filterDirectory(stocks, { sector: "missing" }).total, 0);
});

test("loader joins all provider batches, deduplicates simultaneous loads and refreshes expired cache", async () => {
  let calls = 0,
    clock = 1700000000000;
  const load = createDirectoryLoader({
    now: () => clock,
    fetchData: async (url, opts) => {
      calls++;
      assert.equal(url, "https://scanner.tradingview.com/india/scan");
      const body = JSON.parse(opts.body);
      const start = body.range[0];
      return {
        ok: true,
        json: async () => ({
          totalCount: 6,
          data: source.data.slice(start, start + 3),
        }),
      };
    },
  });
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(a, b);
  assert.equal(a.stocks.length, 6);
  assert.equal(calls, 2);
  await load();
  assert.equal(calls, 2);
  clock += 900001;
  await load();
  assert.equal(calls, 4);
});

test("does not expose a partial or corrupt universe as complete", async () => {
  for (const data of [
    { totalCount: 6, data: [] },
    { totalCount: 60000, data: source.data },
    { totalCount: 1, data: [{ s: "NSE:AAA", d: [] }] },
  ]) {
    const load = createDirectoryLoader({
      fetchData: async () => ({ ok: true, json: async () => data }),
    });
    await assert.rejects(load());
  }
});

test("serverless listing route returns paginated metadata and truthful upstream failures", async () => {
  assert.equal(typeof deployedHandler, "function");
  const handler = createStocksHandler({
    loadDirectory: async () => ({ stocks, fetchedAt: at }),
  });
  const res = response();
  await handler({ method: "GET", query: { pageSize: "2" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.universeTotal, 6);
  assert.equal(res.body.stocks.length, 2);
  assert.equal(res.body.fetchedAt, at);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const denied = response();
  await handler({ method: "POST" }, denied);
  assert.equal(denied.statusCode, 405);
  const failed = response();
  await createStocksHandler({
    loadDirectory: async () => {
      throw Error("blocked");
    },
  })({ method: "GET" }, failed);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.stocks, undefined);
});
