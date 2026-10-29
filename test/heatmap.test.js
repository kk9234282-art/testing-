import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeatmap, layoutTreemap, heatColor } from "../shared/heatmap.js";
import { createHeatmapHandler } from "../server/heatmap-handler.js";
import deployedHandler from "../api/heatmap.js";
const stock = (id, sector, marketCap, change, exchange = "NSE") => ({
  id: `${exchange}:${id}`,
  symbol: id,
  name: id,
  sector,
  marketCap,
  change,
  exchange,
});
const stocks = [
  stock("A", "Technology", 100, 10),
  stock("B", "Technology", 300, -2),
  stock("C", "Energy", 80, null),
  stock("D", "Other", null, 5),
  stock("E", "Technology", 200, -4, "BSE"),
  stock("F", "Other", 0, 0),
  stock("G", "Other", -10, Infinity),
];
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

test("sector movement is cap weighted over valid daily changes, not a simple mean or zero-filled average", () => {
  const result = buildHeatmap(stocks);
  assert.equal(result.exchange, "NSE");
  assert.equal(result.totalListings, 6);
  assert.equal(result.change, 1);
  assert.equal(result.totalCap, 480);
  assert.equal(result.changeCoverage, 400 / 480);
  const tech = result.sectors.find((s) => s.name === "Technology");
  assert.equal(tech.change, 1);
  assert.equal(tech.count, 2);
  const energy = result.sectors.find((s) => s.name === "Energy");
  assert.equal(energy.change, null);
  assert.equal(energy.changeCoverage, 0);
  assert.equal(result.advances, 2);
  assert.equal(result.declines, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.missingChange, 2);
  assert.equal(result.eligibleListings, 3);
  assert.equal(result.excludedListings, 3);
});

test("exchange and sector filters operate on the entire snapshot and preserve dual-listing identity", () => {
  const bse = buildHeatmap(stocks, { exchange: "BSE" });
  assert.equal(bse.totalListings, 1);
  assert.equal(bse.stocks[0].id, "BSE:E");
  const tech = buildHeatmap(stocks, { exchange: "all", sector: "Technology" });
  assert.equal(tech.totalListings, 3);
  assert.equal(tech.totalCap, 600);
  assert.ok(Math.abs(tech.change + 2 / 3) < 1e-10);
  const empty = buildHeatmap(stocks, { sector: "missing" });
  assert.equal(empty.totalListings, 0);
  assert.equal(empty.change, null);
  assert.equal(empty.changeCoverage, null);
});

test("tile limits never truncate sector summaries or breadth calculations", () => {
  const many = Array.from({ length: 140 }, (_, i) =>
    stock(`S${i}`, "Energy", 140 - i, i < 100 ? 1 : -2),
  );
  const result = buildHeatmap(many, { limit: "100" });
  assert.equal(result.stocks.length, 100);
  assert.equal(result.totalListings, 140);
  assert.equal(result.sectors[0].count, 140);
  assert.equal(result.declines, 40);
  assert.equal(buildHeatmap(many, { limit: "250" }).stocks.length, 140);
  assert.equal(buildHeatmap(many, { limit: "50000" }).limit, 100);
});

test("treemap preserves cap-proportional area with no overlapping or out-of-bounds rectangles", () => {
  const items = [1, 2, 3, 4, 8, 20].map((cap, i) => ({
    id: String(i),
    marketCap: cap,
  }));
  const rectangles = layoutTreemap(items, 900, 400),
    total = items.reduce((sum, s) => sum + s.marketCap, 0);
  assert.equal(rectangles.length, items.length);
  for (const a of rectangles) {
    assert.ok(
      Math.abs((a.width * a.height) / (900 * 400) - a.marketCap / total) <
        1e-10,
    );
    assert.ok(
      a.x >= 0 &&
        a.y >= 0 &&
        a.x + a.width <= 900 + 1e-9 &&
        a.y + a.height <= 400 + 1e-9,
    );
    for (const b of rectangles) {
      if (a.id === b.id) continue;
      const overlap =
        Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        ) *
        Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
      assert.ok(overlap < 1e-8);
    }
  }
  assert.deepEqual(layoutTreemap(items, 0, 400), []);
  assert.deepEqual(
    layoutTreemap([{ id: "none", marketCap: null }], 900, 400),
    [],
  );
});

test("colour distinguishes missing daily changes from genuine zero and clamps extreme changes", () => {
  assert.notEqual(heatColor(null), heatColor(0));
  assert.equal(heatColor(NaN), heatColor(null));
  assert.equal(heatColor(-100), heatColor(-3));
  assert.equal(heatColor(100), heatColor(3));
  assert.notEqual(heatColor(-1), heatColor(1));
});

test("serverless endpoint validates filters before loading, returns metadata and reports provider failures", async () => {
  assert.equal(typeof deployedHandler, "function");
  let calls = 0;
  const handler = createHeatmapHandler({
    loadDirectory: async () => {
      calls++;
      return { stocks, fetchedAt: "2026-10-29T10:00:00Z" };
    },
  });
  const res = response();
  await handler({ method: "GET", query: { exchange: "BSE" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalListings, 1);
  assert.equal(res.body.fetchedAt, "2026-10-29T10:00:00Z");
  assert.equal(res.headers["Cache-Control"], "no-store");
  for (const query of [{ exchange: "INVALID" }, { sector: ["a", "b"] }]) {
    const invalid = response();
    await handler({ method: "GET", query }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  const denied = response();
  await handler({ method: "POST" }, denied);
  assert.equal(denied.statusCode, 405);
  assert.equal(calls, 1);
  const fail = response();
  await createHeatmapHandler({
    loadDirectory: async () => {
      throw Error("blocked");
    },
  })({ method: "GET" }, fail);
  assert.equal(fail.statusCode, 502);
  assert.equal(fail.body.stocks, undefined);
});
