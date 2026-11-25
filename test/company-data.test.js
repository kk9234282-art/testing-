import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCompanyChart,
  parseCompanyNews,
  parseCompanyResults,
  safeNewsLink,
} from "../server/company-data.js";
import { createCompanyHandler } from "../server/company-handler.js";
import deployed from "../api/company/[symbol].js";
const symbol = "TCS.NS";
const chart = () => ({
  chart: {
    result: [
      {
        meta: { symbol, currency: "INR", regularMarketTime: 1700000000 },
        timestamp: [1700000000, 1700086400, 1700172800],
        indicators: {
          quote: [
            {
              open: [100, 105, null],
              high: [110, 112, 120],
              low: [90, 99, 90],
              close: [105, 102, 100],
              volume: [0, null, 5],
            },
          ],
        },
        events: { dividends: { a: { date: 1700000000, amount: 5 } } },
      },
    ],
  },
});
const response = () => ({
  headers: {},
  statusCode: 200,
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
});
test("candles validate OHLC, preserve missing volume and explicit dividend ex-dates", () => {
  const data = parseCompanyChart(chart(), symbol);
  assert.equal(data.candles.length, 2);
  assert.equal(data.candles[0].volume, 0);
  assert.equal(data.candles[1].volume, null);
  assert.deepEqual(data.dividends, [
    {
      exDate: "2023-11-15",
      amount: 5,
      currency: "INR",
      recordDate: null,
      paymentDate: null,
    },
  ]);
  const invalid = chart();
  invalid.chart.result[0].indicators.quote[0].high[0] = 95;
  assert.equal(parseCompanyChart(invalid, symbol).candles.length, 1);
  assert.throws(() => parseCompanyChart(chart(), "OTHER.NS"));
  const usd = chart();
  usd.chart.result[0].meta.currency = "USD";
  assert.throws(() => parseCompanyChart(usd, symbol));
});
test("news includes only explicit ticker matches with safe links, dates, and no duplicates", () => {
  const good = {
    title: "Quarterly update <img src=x>",
    publisher: "Example",
    link: "https://example.com/story",
    relatedTickers: [symbol],
    providerPublishTime: 1700000000,
  };
  const data = parseCompanyNews(
    {
      news: [
        good,
        good,
        { ...good, link: "javascript:alert(1)" },
        {
          ...good,
          link: "https://example.com/unrelated",
          relatedTickers: ["OTHER.NS"],
        },
        { ...good, link: "https://example.com/missing", relatedTickers: null },
      ],
    },
    symbol,
  );
  assert.equal(data.articles.length, 1);
  assert.equal(data.articles[0].title, good.title);
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.com",
    "https://user:pass@example.com",
  ])
    assert.equal(safeNewsLink(value), null);
  assert.throws(() => parseCompanyNews({}, symbol));
});
test("quarterly results join by period, retain losses and missing EPS, reject other currencies/annual periods", () => {
  const entry = (raw, currencyCode = "INR", periodType = "3M") => ({
    asOfDate: "2025-03-31",
    periodType,
    currencyCode,
    reportedValue: { raw },
  });
  const data = parseCompanyResults(
    {
      timeseries: {
        result: [
          {
            meta: { symbol: [symbol] },
            quarterlyTotalRevenue: [entry(1e9)],
            quarterlyNetIncome: [entry(-1e8)],
            quarterlyDilutedEPS: [entry(null)],
          },
          {
            meta: { symbol: [symbol] },
            quarterlyTotalRevenue: [entry(5, "USD"), entry(9, "INR", "12M")],
          },
        ],
      },
    },
    symbol,
  );
  assert.deepEqual(data.quarters, [
    {
      periodEnd: "2025-03-31",
      currency: "INR",
      revenue: 1e9,
      netIncome: -1e8,
      eps: null,
    },
  ]);
  assert.equal(data.nextEarningsDate, null);
  assert.deepEqual(
    parseCompanyResults({ timeseries: { result: [] } }, symbol).quarters,
    [],
  );
});
test("company routes validate identity and options before any provider calls", async () => {
  assert.equal(typeof deployed, "function");
  const handler = createCompanyHandler({
    fetchData: () => assert.fail("unexpected provider call"),
  });
  for (const req of [
    { method: "GET", params: { symbol: "http://evil" } },
    {
      method: "GET",
      params: { symbol: "NSE:TCS" },
      query: { section: "__proto__" },
    },
    {
      method: "GET",
      params: { symbol: "NSE:TCS" },
      query: { range: "constructor" },
    },
    {
      method: "GET",
      params: { symbol: "NSE:TCS" },
      query: { section: ["news"] },
    },
    { method: "GET", url: "/api/company/..%2Fsecret" },
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await handler({ method: "POST" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});
test("chart and dividend requests share provider work, while ranges and exchanges stay distinct", async () => {
  let calls = 0;
  const handler = createCompanyHandler({
    fetchData: async (url, options) => {
      calls++;
      assert.ok(options.signal);
      assert.ok(url.startsWith("https://query1.finance.yahoo.com/"));
      const body = chart();
      body.chart.result[0].meta.symbol = decodeURIComponent(
        new URL(url).pathname.split("/").at(-1),
      );
      return { ok: true, json: async () => body };
    },
  });
  const req = (section) => ({
    method: "GET",
    url: "/api/company/NSE%3ATCS?symbol=BSE:BAD",
    query: { section, range: "1y" },
  });
  const a = response(),
    b = response();
  await Promise.all([handler(req("chart"), a), handler(req("dividends"), b)]);
  assert.equal(calls, 1);
  assert.equal(a.body.symbol, "NSE:TCS");
  assert.equal(b.body.dividends.length, 1);
  assert.equal(b.body.candles, undefined);
  await handler(
    { ...req("chart"), query: { section: "chart", range: "3m" } },
    response(),
  );
  assert.equal(calls, 2);
  await handler(
    {
      method: "GET",
      params: { symbol: "BSE:TCS" },
      query: { section: "chart" },
    },
    response(),
  );
  assert.equal(calls, 3);
});
test("provider failures are cached and recover after fifteen minutes without sample substitution", async () => {
  let calls = 0,
    clock = 1700000000000;
  const handler = createCompanyHandler({
    now: () => clock,
    fetchData: async () => {
      calls++;
      return { ok: false, status: 429 };
    },
  });
  const req = {
    method: "GET",
    params: { symbol: "NSE:TCS" },
    query: { section: "news" },
  };
  const a = response();
  await handler(req, a);
  assert.equal(a.statusCode, 502);
  assert.deepEqual(a.body.articles, []);
  assert.equal(a.body.sources.length, 3);
  assert.ok(a.body.sources.every((item) => item.status === "unavailable"));
  await handler(req, response());
  assert.equal(calls, 3);
  clock += 900001;
  await handler(req, response());
  assert.equal(calls, 6);
});
test("company API bounds concurrent provider requests", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const handler = createCompanyHandler({
    maxConcurrent: 1,
    fetchData: async () => {
      await gate;
      return { ok: true, json: async () => chart() };
    },
  });
  const pending = handler(
    { method: "GET", params: { symbol: "NSE:TCS" } },
    response(),
  );
  const blocked = response();
  await handler({ method: "GET", params: { symbol: "NSE:INFY" } }, blocked);
  assert.equal(blocked.statusCode, 429);
  release();
  await pending;
});
