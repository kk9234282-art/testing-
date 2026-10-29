import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuoteHandler } from "../server/quote-handler.js";
import deployedHandler from "../api/quote/[symbol].js";
import health from "../api/health.js";

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
const payload = {
  chart: {
    result: [
      {
        meta: {
          regularMarketPrice: 110,
          previousClose: 100,
          currency: "INR",
          regularMarketTime: 1700000000,
        },
        timestamp: [1, 2],
        indicators: { quote: [{ close: [100, 110] }] },
      },
    ],
  },
};

test("Vercel route exports a handler and returns a real normalized provider quote", async () => {
  assert.equal(typeof deployedHandler, "function");
  let calls = 0;
  let clock = 1700000000000;
  const handler = createQuoteHandler({
    now: () => clock,
    fetchQuote: async (url, options) => {
      calls++;
      assert.ok(url.includes("/RELIANCE.NS?"));
      assert.ok(options.signal);
      return { ok: true, json: async () => payload };
    },
  });
  const req = { method: "GET", query: { symbol: "RELIANCE" } };
  const first = response();
  await handler(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.price, 110);
  assert.equal(first.body.currency, "INR");
  assert.equal(first.body.asOf, "2023-11-14T22:13:20.000Z");
  assert.match(first.headers["Cache-Control"], /s-maxage=60/);
  await handler(req, response());
  assert.equal(calls, 1);
  clock += 60001;
  await handler(req, response());
  assert.equal(calls, 2);
});

test("local Express params use the same handler", async () => {
  const handler = createQuoteHandler({
    fetchQuote: async () => ({ ok: true, json: async () => payload }),
  });
  const res = response();
  await handler({ method: "GET", params: { symbol: "TCS" } }, res);
  assert.equal(res.body.symbol, "TCS");
});

test("rejects unsupported symbols and methods without fetching", async () => {
  const handler = createQuoteHandler({
    fetchQuote: () => {
      throw Error("must not fetch");
    },
  });
  for (const symbol of [
    "NSE:TCS?x=1",
    ["TCS"],
    "../TCS",
    "NASDAQ:AAPL",
    undefined,
  ]) {
    const res = response();
    await handler({ method: "GET", query: { symbol } }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await handler({ method: "POST", query: { symbol: "TCS" } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
});

test("provider denial, malformed data and timeouts remain uncached errors, never sample data", async () => {
  for (const fetchQuote of [
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => {
      throw Error("timeout");
    },
  ]) {
    let calls = 0;
    const handler = createQuoteHandler({
      fetchQuote: (...args) => {
        calls++;
        return fetchQuote(...args);
      },
    });
    for (let i = 0; i < 2; i++) {
      const res = response();
      await handler({ method: "GET", query: { symbol: "RELIANCE" } }, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.body.price, undefined);
    }
    assert.equal(calls, 2);
  }
});

test("health function returns readiness without caching", () => {
  const res = response();
  health({}, res);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("supports new NSE and BSE listings without a hardcoded allowlist", async () => {
  const urls = [];
  const handler = createQuoteHandler({
    fetchQuote: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => payload };
    },
  });
  for (const symbol of ["NSE:NEWSTOCK", "BSE:500325", "NSE:M&M"]) {
    const res = response();
    await handler({ method: "GET", query: { symbol } }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.ok(urls[0].includes("NEWSTOCK.NS"));
  assert.ok(urls[1].includes("500325.BO"));
  assert.ok(urls[2].includes("M%26M.NS"));
});
