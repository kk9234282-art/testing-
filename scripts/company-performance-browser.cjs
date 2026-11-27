// Controlled browser regression: real local streaming, no external provider requests.
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
(async () => {
  const { createCompanyHandler } = await import("../server/company-handler.js");
  const { filterDirectory } = await import("../server/directory.js");
  const { buildHeatmap } = await import("../shared/heatmap.js");
  const company = { id: "NSE:TCS", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", sector: "Technology", industry: "IT Services", price: 100, change: 1, marketCap: 1e12, volume: 100000, logo: "TC" };
  const now = Date.parse("2026-11-27T09:00:00Z");
  const candles = Array.from({ length: 1250 }, (_, i) => ({ time: new Date(now - (1249 - i) * 86400000).toISOString().slice(0, 10), open: 100 + i / 10, high: 103 + i / 10, low: 99 + i / 10, close: 102 + i / 10, volume: 10000 + i }));
  let release, slowFinished = false, calls = 0;
  const slow = new Promise((resolve) => { release = resolve; });
  const news = createCompanyHandler({ now: () => now, fetchData: async (url) => {
    calls++;
    if (url.includes("finance.yahoo.com")) return { ok: true, json: async () => ({ news: [{ title: "TCS announces quarterly results", publisher: "Reuters", link: "https://example.com/results", providerPublishTime: now / 1000, relatedTickers: ["TCS.NS"] }] }) };
    await slow; slowFinished = true; return { ok: false };
  } });
  const app = express();
  app.get("/api/stocks", (req, res) => res.json(filterDirectory([company], req.query)));
  app.get("/api/heatmap", (req, res) => res.json(buildHeatmap([company], req.query)));
  app.get("/api/indices", (req, res) => res.status(503).json({ error: "Controlled unavailable summary" }));
  app.get("/api/breadth", (req, res) => res.status(503).json({ error: "Controlled unavailable summary" }));
  app.get("/api/company/:symbol", (req, res) => {
    if (req.query.section === "news") return news(req, res);
    return res.json({ symbol: company.id, section: "chart", candles, dividends: [], currency: "INR" });
  });
  app.use(express.static(path.resolve(__dirname, "../dist")));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await page.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.__numberFormats = 0;
      const original = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format");
      Object.defineProperty(Intl.NumberFormat.prototype, "format", { configurable: true, get() {
        const format = original.get.call(this);
        return (...args) => { window.__numberFormats++; return format(...args); };
      } });
    });
    const errors = []; let newsRequests = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (r.url().includes("section=news")) newsRequests++; });
    await page.goto(origin);
    await page.locator(".stocks tbody tr .company").first().click();
    const dialog = page.getByRole("dialog", { name: "Stock details" });
    await expect(dialog.getByRole("img", { name: "Interactive candlestick and volume chart" })).toBeVisible();
    await expect(dialog.locator(".research-chart-data tbody tr")).toHaveCount(0);
    await dialog.getByRole("tab", { name: "News", exact: true }).click();
    await expect(dialog.locator(".company-news-list")).toContainText("TCS announces quarterly results");
    assert.equal(slowFinished, false, "Fast headlines must appear before slow source completion");
    release();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tickr-news-history-v1") || '{}').entries?.[0]?.articles?.length)).toBe(1);
    await dialog.getByRole("tab", { name: "Chart", exact: true }).click();
    await dialog.locator(".research-chart-data summary").click();
    await expect(dialog.locator(".research-chart-data tbody tr")).toHaveCount(1250);
    const chart = dialog.locator(".candle-chart");
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    await page.evaluate(() => { window.__numberFormats = 0; });
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * i / 14, box.y + 70);
    const formatting = await page.evaluate(() => window.__numberFormats);
    assert.ok(formatting < 500, `Cursor must not reformat all 1,250 rows: ${formatting} calls`);
    await dialog.locator(".research-chart-data summary").click();
    await expect(dialog.locator(".research-chart-data tbody tr")).toHaveCount(0);
    await page.keyboard.press("Escape");
    const before = newsRequests;
    await page.locator(".stocks tbody tr .company").first().click();
    await page.getByRole("dialog").getByRole("tab", { name: "News", exact: true }).click();
    await expect(page.locator(".company-news-list")).toContainText("TCS announces quarterly results");
    assert.equal(newsRequests, before, "Reopening fresh news uses the page cache");
    assert.equal(calls, 3, "All sources attempted once without duplicate work");
    assert.deepEqual(errors, []);
    console.log(`PASS: early streamed headlines, 1,250-row deferred table, ${formatting} cursor formatting calls, cached news reopen, all three sources attempted once, no browser errors.`);
  } finally {
    release(); await browser?.close();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
