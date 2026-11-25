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
