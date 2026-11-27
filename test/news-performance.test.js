import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCompanyHandler } from "../server/company-handler.js";
import { readCompanyNewsResponse } from "../shared/company-news-response.js";
import { readNewsHistory } from "../shared/news-history.js";
const clock = Date.parse("2026-11-27T10:00:00Z");
const article = { title: "TCS announces quarterly results", publisher: "Reuters", url: "https://example.com/results", publishedAt: new Date(clock).toISOString() };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function response() {
  const res = new EventEmitter();
  res.headers = {}; res.frames = []; res.statusCode = 200;
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.write = (line) => { res.frames.push(JSON.parse(line)); res.emit("frame"); };
  res.end = () => { res.writableEnded = true; };
  return res;
}
const request = (stream = "1") => ({ method: "GET", params: { symbol: "NSE:TCS" }, query: { section: "news", name: "Tata Consultancy Services", stream } });
function yahoo() {
  return { ok: true, json: async () => ({ news: [{ title: article.title, publisher: article.publisher, link: article.url, providerPublishTime: clock / 1000, relatedTickers: ["TCS.NS"] }] }) };
}

test("news streams useful headlines before slow feeds finish; concurrent clients share provider work", async () => {
  const slow = deferred(), headline = deferred(); let calls = 0;
  const handler = createCompanyHandler({ now: () => clock, fetchData: async (url) => {
    calls++;
    if (url.includes("finance.yahoo.com")) return yahoo();
    await slow.promise;
    return { ok: false };
  } });
  const first = response(), second = response();
  first.on("frame", () => { if (first.frames.at(-1).data.articles?.length) headline.resolve(); });
  const a = handler(request(), first), b = handler(request(), second);
  await headline.promise;
  assert.equal(first.writableEnded, undefined, "Headlines arrive while other feeds remain pending");
  assert.equal(first.frames.at(-1).type, "progress");
  assert.equal(first.frames.at(-1).data.articles.length, 1);
  assert.ok(first.frames.at(-1).data.sources.some((s) => s.status === "pending"));
  slow.resolve(); await Promise.all([a, b]);
  assert.equal(calls, 3, "Streaming subscribers must not duplicate source requests");
  for (const r of [first, second]) {
    assert.equal(r.frames.at(-1).type, "complete");
    assert.equal(r.frames.at(-1).data.sources.length, 3);
    assert.equal(r.frames.at(-1).data.articles[0].title, article.title);
    assert.equal(r.writableEnded, true);
  }
  const cached = response(); await handler(request(), cached);
  assert.equal(cached.body.articles.length, 1, "Warm responses retain backwards-compatible JSON");
  assert.equal(calls, 3);
});

test("all-feed failures remain explicit stream errors and JSON failures", async () => {
  const handler = createCompanyHandler({ fetchData: async () => ({ ok: false }) });
  const streamed = response(); await handler(request(), streamed);
  assert.equal(streamed.frames.at(-1).type, "error");
  assert.equal(streamed.frames.at(-1).data.allSourcesUnavailable, true);
  assert.deepEqual(streamed.frames.at(-1).data.articles, []);
  const legacy = response(); await handler(request("0"), legacy);
  assert.equal(legacy.statusCode, 502);
});

test("closing one news stream does not write to it or interrupt other subscribers", async () => {
  const gate = deferred();
  const handler = createCompanyHandler({ fetchData: async (url) => {
    await gate.promise; return url.includes("finance.yahoo.com") ? yahoo() : { ok: false };
  } });
  const closed = response(), active = response();
  const a = handler(request(), closed), b = handler(request(), active);
  closed.emit("close"); gate.resolve(); await Promise.all([a, b]);
  assert.deepEqual(closed.frames, []);
  assert.equal(active.frames.at(-1).type, "complete");
});

test("stream option validation happens before provider work", async () => {
  let calls = 0; const handler = createCompanyHandler({ fetchData: async () => { calls++; } });
  for (const req of [request("x"), { ...request(), query: { section: "chart", stream: "1" } }]) {
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test("progressive reader handles split UTF-8, legacy JSON and incomplete/error streams", async () => {
  const data = { symbol: "NSE:TCS", section: "news", articles: [{ ...article, title: "TCS dividend ₹5" }] };
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "progress", data }) + "\n" + JSON.stringify({ type: "complete", data }) + "\n");
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const updates = [];
  assert.deepEqual(await readCompanyNewsResponse(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } }), (x) => updates.push(x)), data);
  assert.deepEqual(updates, [data]);
  assert.deepEqual(await readCompanyNewsResponse(Response.json(data), () => {}), data);
  const headers = { "Content-Type": "application/x-ndjson" };
  await assert.rejects(readCompanyNewsResponse(new Response("x".repeat(1_000_001), { headers }), () => {}));
  await assert.rejects(readCompanyNewsResponse(new Response((JSON.stringify({ type: "progress", data }) + "\n").repeat(9), { headers }), () => {}));
  for (const frame of [{ type: "progress", data }, { type: "error", data }, { type: "unknown", data }]) {
    await assert.rejects(readCompanyNewsResponse(new Response(JSON.stringify(frame) + "\n", { headers: { "Content-Type": "application/x-ndjson" } }), () => {}));
  }
});

test("reading one company archive does not normalize every unrelated company's history", () => {
  // Accessing an unrelated headline would fail the requested company's read.
  let unrelatedTouched = false;
  const unrelated = { symbol: "NSE:OTHER", articles: [{ get title() {
    unrelatedTouched = true; throw new Error("Unrelated headline was normalized");
  } }] };
  const original = JSON.parse;
  JSON.parse = () => ({ version: 1, entries: [{ symbol: "NSE:TCS", articles: [article] }, unrelated] });
  try {
    const result = readNewsHistory({ getItem: () => "fixture" }, "NSE:TCS");
    assert.equal(result.length, 1);
    assert.equal(unrelatedTouched, false);
  } finally { JSON.parse = original; }
});
