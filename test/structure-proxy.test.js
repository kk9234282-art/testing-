import test from "node:test";
import assert from "node:assert/strict";
import proxy from "../server/structure-proxy.js";
const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});
test("private scanner bridge is disabled by default and never invents a scan", async () => {
  const previous = process.env.SCANNER_SERVICE_URL;
  delete process.env.SCANNER_SERVICE_URL;
  try {
    const res = response();
    await proxy({ method: "GET", url: "/api/structure/health" }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.rows, undefined);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    if (previous) process.env.SCANNER_SERVICE_URL = previous;
  }
});
test("scanner bridge validates fixed paths and forwards only the supplied authorization", async () => {
  const previous = process.env.SCANNER_SERVICE_URL,
    original = globalThis.fetch;
  process.env.SCANNER_SERVICE_URL = "https://private.example.com";
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return {
      status: 401,
      json: async () => ({ detail: "Invalid research service token" }),
    };
  };
  try {
    const invalid = response();
    await proxy(
      { method: "GET", url: "/api/structure/../../metadata", headers: {} },
      invalid,
    );
    assert.equal(invalid.statusCode, 404);
    assert.equal(captured, undefined);
    const res = response();
    await proxy(
      {
        method: "GET",
        url: "/api/structure/datasets",
        headers: { authorization: "Bearer client-test-token" },
      },
      res,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(
      captured.url,
      "https://private.example.com/api/structure/datasets",
    );
    assert.equal(
      captured.options.headers.Authorization,
      "Bearer client-test-token",
    );
    await proxy(
      { method: "GET", url: "/api/structure/market-data/status", headers: {} },
      response(),
    );
    assert.equal(
      captured.url,
      "https://private.example.com/api/structure/market-data/status",
    );
    assert.equal(captured.options.headers.Authorization, undefined);
    process.env.SCANNER_SERVICE_URL = "http://169.254.169.254";
    const blocked = response();
    await proxy({ method: "GET", url: "/api/structure/health" }, blocked);
    assert.equal(blocked.statusCode, 503);
  } finally {
    globalThis.fetch = original;
    if (previous) process.env.SCANNER_SERVICE_URL = previous;
    else delete process.env.SCANNER_SERVICE_URL;
  }
});

test("explicit nested Vercel routes preserve scanner requests and token forwarding", async () => {
  const { default: market } = await import(
    "../api/structure/market-data/status.js"
  );
  const { default: runs } = await import("../api/structure/runs/[run_id].js");
  const { default: stock } = await import(
    "../api/structure/runs/[run_id]/stocks/[security_id].js"
  );
  const previous = process.env.SCANNER_SERVICE_URL,
    original = globalThis.fetch;
  process.env.SCANNER_SERVICE_URL = "https://private.example.com";
  const captured = [];
  globalThis.fetch = async (url, options) => {
    captured.push({ url: String(url), options });
    return { status: 200, json: async () => ({ state: "queued" }) };
  };
  const id = "bfc911cd-6f46-4dae-b320-a45674b967ea";
  try {
    const cases = [
      [market, "GET", "/api/structure/market-data/status"],
      [runs, "POST", "/api/structure/runs/scan"],
      [runs, "POST", "/api/structure/runs/backtest"],
      [runs, "GET", `/api/structure/runs/${id}`],
      [stock, "GET", `/api/structure/runs/${id}/stocks/DEMO_01`],
    ];
    for (const [handler, method, url] of cases) {
      const res = response();
      await handler(
        {
          method,
          url,
          headers: { authorization: "Bearer fixture-only" },
          body: { dataset_id: "fixture" },
        },
        res,
      );
      assert.equal(res.statusCode, 200);
      const request = captured.at(-1);
      assert.equal(request.url, "https://private.example.com" + url);
      assert.equal(
        request.options.headers.Authorization,
        "Bearer fixture-only",
      );
      assert.equal(request.options.method, method);
      assert.equal(request.options.redirect, "error");
    }
    const count = captured.length;
    const rejected = response();
    await stock(
      {
        method: "GET",
        url: `/api/structure/runs/${id}/stocks/../../internal/eod`,
        headers: {},
      },
      rejected,
    );
    assert.equal(rejected.statusCode, 404);
    assert.equal(captured.length, count);
  } finally {
    globalThis.fetch = original;
    if (previous) process.env.SCANNER_SERVICE_URL = previous;
    else delete process.env.SCANNER_SERVICE_URL;
  }
});
