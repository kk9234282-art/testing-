import test from "node:test";
import assert from "node:assert/strict";
import { marketBreadth, INDEX_DEFINITIONS } from "../shared/market-summary.js";
import {
  parseIndex,
  createIndicesHandler,
  createBreadthHandler,
} from "../server/summary-handler.js";
import deployedIndices from "../api/indices.js";
import deployedBreadth from "../api/breadth.js";
const payload = (symbol = "^NSEI") => ({
  chart: {
    result: [
      {
        meta: {
          symbol,
          currency: "INR",
          regularMarketPrice: 90,
          chartPreviousClose: 100,
          previousClose: 80,
          regularMarketTime: 1700000000,
        },
        timestamp: [1, 2, 3],
        indicators: { quote: [{ close: [100, null, 90] }] },
      },
    ],
  },
});
const response = () => ({
  headers: {},
  statusCode: 200,
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const rows = [
  { id: "NSE:A", symbol: "A", name: "Alpha Ltd.", exchange: "NSE", change: 2 },
  { id: "BSE:1", symbol: "1", name: "Alpha Ltd.", exchange: "BSE", change: -3 },
  { id: "BSE:B", symbol: "B", name: "Beta", exchange: "BSE", change: -1 },
  { id: "NSE:C", symbol: "C", name: "Gamma", exchange: "NSE", change: 0 },
  { id: "NSE:D", symbol: "D", name: "Delta", exchange: "NSE", change: null },
];
test("breadth uses daily returns across all deduplicated companies, including missing and flat values", () => {
  assert.deepEqual(marketBreadth(rows), {
    advances: 1,
    declines: 1,
    unchanged: 1,
    unavailable: 1,
    total: 4,
  });
  assert.deepEqual(marketBreadth([]), {
    advances: 0,
    declines: 0,
    unchanged: 0,
    unavailable: 0,
    total: 0,
  });
});
test("index return uses previous session close, with no invented return or history", () => {
  const quote = parseIndex(INDEX_DEFINITIONS[0], payload());
  assert.ok(Math.abs(quote.change + 10) < 1e-10);
  assert.equal(quote.asOf, "2023-11-14T22:13:20.000Z");
  assert.deepEqual(quote.history, [
    { price: 100, time: 1 },
    { price: 90, time: 3 },
  ]);
  const missing = payload();
  delete missing.chart.result[0].meta.chartPreviousClose;
  delete missing.chart.result[0].meta.previousClose;
  assert.equal(parseIndex(INDEX_DEFINITIONS[0], missing).change, null);
  for (const meta of [
    { symbol: "OTHER" },
    { currency: "USD" },
    { regularMarketPrice: null },
    { regularMarketTime: null },
  ]) {
    const invalid = payload();
    Object.assign(invalid.chart.result[0].meta, meta);
    assert.throws(() => parseIndex(INDEX_DEFINITIONS[0], invalid));
  }
});
test("index requests coalesce and cache failures, then recover after fifteen minutes", async () => {
  let calls = 0,
    clock = Date.parse("2026-11-24T04:00:00Z"),
    fail = true;
  const handler = createIndicesHandler({
    now: () => clock,
    fetchData: async (url) => {
      calls++;
      const symbol = decodeURIComponent(
        new URL(url).pathname.split("/").at(-1),
      );
      if (symbol === "^BSESN" && fail) return { ok: false, status: 429 };
      return { ok: true, json: async () => payload(symbol) };
    },
  });
  const req = { method: "GET" },
    a = response(),
    b = response();
  await Promise.all([handler(req, a), handler(req, b)]);
  assert.equal(calls, 3);
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.indices[0].status, "available");
  assert.equal(a.body.indices[1].status, "unavailable");
  assert.equal(a.body.indices[1].price, null);
  await handler(req, response());
  assert.equal(calls, 3);
  clock += 900001;
  fail = false;
  const recovered = response();
  await handler(req, recovered);
  assert.equal(calls, 6);
  assert.equal(recovered.body.indices[1].status, "available");
  assert.equal(a.headers["Cache-Control"], "no-store");
});
test("breadth handler reports snapshot fetch time and does not substitute samples on failure", async () => {
  const handler = createBreadthHandler({
    loadDirectory: async () => ({
      stocks: rows,
      fetchedAt: "2026-11-24T09:00:00Z",
    }),
  });
  const res = response();
  await handler({ method: "GET" }, res);
  assert.equal(res.body.total, 4);
  assert.equal(res.body.fetchedAt, "2026-11-24T09:00:00Z");
  const failed = response();
  await createBreadthHandler({
    loadDirectory: async () => {
      throw new Error("offline");
    },
  })({ method: "GET" }, failed);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.advances, undefined);
});
test("summary routes deploy as functions and reject mutations before fetching", async () => {
  assert.equal(typeof deployedIndices, "function");
  assert.equal(typeof deployedBreadth, "function");
  for (const handler of [
    createIndicesHandler({ fetchData: () => assert.fail("unexpected fetch") }),
    createBreadthHandler({
      loadDirectory: () => assert.fail("unexpected directory load"),
    }),
  ]) {
    const res = response();
    await handler({ method: "POST" }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET");
  }
});

test("index cache stays frozen outside the session and refreshes on reopening", async () => {
  let clock = Date.parse("2026-11-24T09:59:00Z"),
    calls = 0;
  const handler = createIndicesHandler({
    now: () => clock,
    fetchData: async (url) => {
      calls++;
      return {
        ok: true,
        json: async () =>
          payload(decodeURIComponent(new URL(url).pathname.split("/").at(-1))),
      };
    },
  });
  await handler({ method: "GET" }, response());
  assert.equal(calls, 3);
  clock = Date.parse("2026-11-24T12:00:00Z");
  await handler({ method: "GET" }, response());
  assert.equal(calls, 3);
  clock = Date.parse("2026-11-25T03:45:00Z");
  await handler({ method: "GET" }, response());
  assert.equal(calls, 6);
});
