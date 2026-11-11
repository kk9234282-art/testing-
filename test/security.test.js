import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createQuoteHandler } from "../server/quote-handler.js";
import {
  createStocksHandler,
  createDirectoryLoader,
} from "../server/directory.js";
import { createHeatmapHandler } from "../server/heatmap-handler.js";
import { SECURITY_HEADERS } from "../server/security.js";
import { parseChart } from "../server/market.js";
function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
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
const data = {
  chart: {
    result: [
      {
        meta: {
          regularMarketPrice: 110,
          previousClose: 100,
          regularMarketTime: 1700000000,
          currency: "INR",
        },
        timestamp: [1, 2],
        indicators: { quote: [{ close: [100, 110] }] },
      },
    ],
  },
};

test("path identity wins over a conflicting query symbol in both Express and Vercel requests", async () => {
  const urls = [];
  const handler = createQuoteHandler({
    fetchQuote: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => data };
    },
  });
  for (const request of [
    {
      method: "GET",
      params: { symbol: "NSE:RELIANCE" },
      query: { symbol: "BSE:500325" },
    },
    {
      method: "GET",
      url: "/api/quote/NSE%3ATCS?symbol=BSE%3A500325",
      query: { symbol: "BSE:500325" },
    },
  ]) {
    const res = response();
    await handler(request, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.symbol.startsWith("NSE:"));
  }
  assert.ok(urls[0].includes("/RELIANCE.NS?"));
  assert.ok(urls[1].includes("/TCS.NS?"));
});

test("equivalent concurrent chart requests share one upstream fetch and one canonical cache", async () => {
  let calls = 0,
    release;
  const ready = new Promise((r) => (release = r));
  const handler = createQuoteHandler({
    fetchQuote: async () => {
      calls++;
      await ready;
      return { ok: true, json: async () => data };
    },
  });
  const a = response(),
    b = response();
  const first = handler({ method: "GET", query: { symbol: "TCS" } }, a),
    second = handler({ method: "GET", query: { symbol: "NSE:TCS" } }, b);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(a.body.symbol, "TCS");
  assert.equal(b.body.symbol, "NSE:TCS");
  await handler({ method: "GET", query: { symbol: "TCS" } }, response());
  assert.equal(calls, 1);
});

test("chart backpressure bounds active provider work and recovers after requests finish", async () => {
  let release,
    calls = 0;
  const ready = new Promise((r) => (release = r));
  const handler = createQuoteHandler({
    maxConcurrent: 1,
    fetchQuote: async () => {
      calls++;
      await ready;
      return { ok: true, json: async () => data };
    },
  });
  const first = handler(
    { method: "GET", query: { symbol: "TCS" } },
    response(),
  );
  const blocked = response();
  await handler({ method: "GET", query: { symbol: "INFY" } }, blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], "1");
  assert.equal(blocked.headers["Cache-Control"], "no-store");
  assert.equal(calls, 1);
  release();
  await first;
  const next = response();
  await handler({ method: "GET", query: { symbol: "INFY" } }, next);
  assert.equal(next.statusCode, 200);
});

test("invalid or repeated API parameters are rejected before external work", async () => {
  let calls = 0;
  const loadDirectory = async () => {
    calls++;
    throw Error("must not fetch");
  };
  const stocks = createStocksHandler({ loadDirectory }),
    heatmap = createHeatmapHandler({ loadDirectory });
  for (const query of [
    { search: ["a", "b"] },
    { exchange: "NASDAQ" },
    { page: "Infinity" },
    { pageSize: "1000000" },
    { category: "__proto__" },
    { sector: "x\nInjected" },
    { search: "x".repeat(251) },
  ]) {
    const res = response();
    await stocks({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
  }
  for (const query of [
    { limit: ["100", "250"] },
    { group: "x".repeat(251) },
    { period: ["24h"] },
  ]) {
    const res = response();
    await heatmap({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test("provider chart parsing rejects malformed arrays and ignores invalid dates and prior closes", () => {
  const payload = structuredClone(data);
  payload.chart.result[0].meta.regularMarketTime = 1e99;
  payload.chart.result[0].meta.previousClose = "oops";
  const result = parseChart("TCS", payload);
  assert.equal(result.asOf, null);
  assert.ok(Math.abs(result.change - 10) < 1e-8);
  payload.chart.result[0].indicators.quote[0].close = { unexpected: true };
  assert.throws(() => parseChart("TCS", payload), /invalid chart/);
});

test("directory retrieval uses stable symbol ordering and respects a total request deadline", async () => {
  let clock = 0,
    calls = 0;
  const loader = createDirectoryLoader({
    now: () => clock,
    fetchData: async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.sort, { sortBy: "name", sortOrder: "asc" });
      clock = 50001;
      return {
        ok: true,
        json: async () => ({
          totalCount: 2,
          data: [
            {
              s: "NSE:A",
              d: body.columns.map(
                (key) =>
                  ({
                    name: "A",
                    description: "Company A",
                    close: 1,
                    change: 1,
                    volume: 100,
                    market_cap_basic: 100,
                    sector: "Finance",
                    exchange: "NSE",
                  })[key] ?? null,
              ),
            },
          ],
        }),
      };
    },
  });
  await assert.rejects(loader(), /total deadline/);
  assert.equal(calls, 1);
});

test("Vercel and Express security policies agree and do not disable the clipboard feature", () => {
  const config = JSON.parse(
    fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  const headers = Object.fromEntries(
    config.headers
      .find((rule) => rule.source === "/(.*)")
      .headers.map((h) => [h.key, h.value]),
  );
  assert.deepEqual(headers, SECURITY_HEADERS);
  assert.match(headers["Content-Security-Policy"], /script-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Permissions-Policy"], /clipboard-write=\(self\)/);
});
