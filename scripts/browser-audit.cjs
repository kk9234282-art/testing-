/* Production-build regression/security audit. External data and ChatGPT are intercepted. */
const { chromium } = require("@playwright/test");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const project = path.resolve(__dirname, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const { filterDirectory } = await import("../server/directory.js");
  const { buildHeatmap } = await import("../shared/heatmap.js");
  const { buildCompanyResearchPrompt } =
    await import("../shared/company-research.js");
  const { SECURITY_HEADERS } = await import("../server/security.js");
  const nse = {
    id: "NSE:ADANIPORTS",
    symbol: "ADANIPORTS",
    name: "Adani Ports and Special Economic Zone Ltd.",
    exchange: "NSE",
    marketCap: 3e12,
    price: 100,
    change: 1,
    changeWeek: -5,
    changeMonth: 20,
    sector: "Transportation",
    industry: "Marine Shipping",
    pe: 20,
    pb: 2,
    revenueGrowth: 15,
    epsGrowth: 15,
    roe: 18,
    debtEquity: 0.5,
    dividendYield: 2,
    volume: 100000,
    fetchedAt: "2026-11-11T10:00:00Z",
    logo: "AP",
  };
  const bse = {
    ...nse,
    id: "BSE:532921",
    symbol: "532921",
    name: "ADANI PORTS AND SPECIAL ECONOMIC ZONE LTD.",
    exchange: "BSE",
    price: 101,
    change: 2,
    marketCap: 3.1e12,
  };
  const bank = {
    ...nse,
    id: "NSE:HDFCBANK",
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd.",
    exchange: "NSE",
    sector: "Financials",
    industry: "Major Banks",
    marketCap: 2e12,
    price: 200,
    change: -1,
    changeWeek: 3,
    changeMonth: null,
    pe: 10,
    roe: 10,
    debtEquity: 2,
  };
  const unsafe = {
    ...nse,
    id: "NSE:UNSAFE",
    symbol: "UNSAFE",
    name: 'Text <img src=x onerror="window.__xssExecuted=true"> Company',
    sector: "Industrials",
    industry: "Engineering",
    marketCap: 1e12,
    price: 300,
    pe: null,
  };
  const extra = Array.from({ length: 28 }, (_, i) => ({
    ...nse,
    id: `NSE:STOCK${i}`,
    symbol: `STOCK${i}`,
    name: `Example Company ${i}`,
    marketCap: 5e11 - i * 1e10,
    sector: "Industrials",
    industry: "Engineering",
    price: 100 + i,
    pe: 30 + i,
    roe: i % 2 ? 20 : null,
    changeMonth: i % 3 ? 2 : null,
  }));
  const stocks = [nse, bse, bank, unsafe, ...extra];
  let server, browser;
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    assert.ok(
      fs.existsSync(path.join(project, "dist/index.html")),
      "Run npm run build first.",
    );
    server = spawn(process.execPath, ["server/index.js"], {
      cwd: project,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    server.stderr.on("data", (chunk) => (serverLog += chunk));
    server.stdout.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(origin + "/api/health");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await wait(100);
    }
    assert.ok(ready, "Local server did not start: " + serverLog);
    const api = await fetch(origin + "/api/stocks?category=__proto__");
    assert.equal(api.status, 400);
    const invalidQuote = await fetch(origin + "/api/quote/..%2Fsecret");
    assert.equal(invalidQuote.status, 400);
    const method = await fetch(origin + "/api/quote/TCS", { method: "POST" });
    assert.equal(method.status, 405);
    const home = await fetch(origin + "/");
    for (const [key, value] of Object.entries(SECURITY_HEADERS))
      assert.equal(home.headers.get(key), value);
    assert.equal(home.headers.get("x-powered-by"), null);
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    const page = await context.newPage(),
      errors = [],
      cspErrors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (
        msg.type() === "error" &&
        /Content Security Policy|violates.*directive/i.test(msg.text())
      )
        cspErrors.push(msg.text());
    });
    let failStocks = false,
      failChart = false,
      delay = false;
    await context.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await context.route("https://chatgpt.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Intercepted ChatGPT destination</title>",
      }),
    );
    await context.route("**/api/stocks?*", async (route) => {
      const q = Object.fromEntries(new URL(route.request().url()).searchParams);
      if (delay) await wait(q.search === "Example" ? 250 : 30);
      if (failStocks)
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "Controlled provider failure" }),
        });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...filterDirectory(stocks, q),
          fetchedAt: nse.fetchedAt,
        }),
      });
    });
    await context.route("**/api/heatmap?*", async (route) => {
      const q = Object.fromEntries(new URL(route.request().url()).searchParams);
      if (q.period === "1w") await wait(80);
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...buildHeatmap(stocks, q),
          fetchedAt: nse.fetchedAt,
        }),
      });
    });
    await context.route("**/api/quote/*", (route) =>
      route.fulfill({
        status: failChart ? 502 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          failChart
            ? { error: "Controlled chart failure" }
            : {
                history: [{ price: 100 }, { price: 110 }],
                asOf: nse.fetchedAt,
              },
        ),
      }),
    );
    await page.addInitScript(() =>
      localStorage.setItem("tickr-watch", JSON.stringify(["BSE:532921"])),
    );
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    const rows = page.locator(".stocks tbody tr");
    await expect(rows).toHaveCount(25);
    await expect(rows.first().locator(".exchange-badge")).toHaveText(
      "NSE + BSE",
    );
    await expect(rows.first()).toContainText("₹100.00");
    await expect(
      page.getByRole("button", { name: /Remove Adani Ports.*from watchlist/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(rows.first().locator(".rank")).toHaveText("26");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(rows.first().locator(".rank")).toHaveText("1");
    await page.getByRole("textbox", { name: "Search stocks" }).fill("532921");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Adani Ports");
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(rows).toHaveCount(25);
    await page
      .getByRole("combobox", { name: "Filter sector", exact: true })
      .selectOption("Financials");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("HDFC");
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(rows).toHaveCount(25);
    await page
      .getByRole("combobox", { name: "Filter industry" })
      .selectOption("Engineering");
    await expect(rows).toHaveCount(25);
    await expect(page.locator(".stocks tbody")).not.toContainText("HDFC Bank");
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page.getByRole("button", { name: /Advanced screener/ }).click();
    await page
      .getByRole("spinbutton", { name: "P/E minimum", exact: true })
      .fill("30");
    await page
      .getByRole("spinbutton", { name: "P/E maximum", exact: true })
      .fill("10");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "minimum cannot exceed maximum",
    );
    await page
      .getByRole("button", { name: "Growing earnings", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sort by Revenue growth", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset screener", exact: true })
      .click();
    await page
      .getByRole("spinbutton", { name: "P/E maximum", exact: true })
      .fill("15");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("HDFC Bank");
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(rows).toHaveCount(25);
    // Confirm the BSE-selected/NSE-rendered comparison removal regression.
    await page
      .getByRole("combobox", { name: "Filter exchange", exact: true })
      .selectOption("BSE");
    await expect(rows).toHaveCount(1);
    await page
      .getByRole("button", { name: "Add 532921 to comparison", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Filter exchange", exact: true })
      .selectOption("");
    await expect(rows).toHaveCount(25);
    await page
      .getByRole("button", {
        name: "Remove ADANIPORTS from comparison",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Add HDFCBANK to comparison", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Compare stocks", exact: true })
      .click();
    let comparison = page.getByRole("dialog", { name: "A closer comparison." });
    await expect(comparison).toBeVisible();
    await expect(comparison).toContainText("NSE + BSE");
    await comparison
      .getByRole("button", {
        name: "Remove ADANIPORTS from comparison",
        exact: true,
      })
      .click();
    await expect(comparison.locator("thead th")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(comparison).not.toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    // Details: native Escape/focus trap, watchlist, external tab/clipboard handoff.
    const openAdani = page.locator(".company").filter({ hasText: nse.name });
    await openAdani.click();
    let dialog = page.getByRole("dialog", { name: "Stock details" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close details" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    assert.ok(
      await page.evaluate(() =>
        document
          .querySelector(".company-dialog")
          .contains(document.activeElement),
      ),
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(openAdani).toBeFocused();
    await openAdani.click();
    dialog = page.getByRole("dialog", { name: "Stock details" });
    await dialog
      .getByRole("button", { name: "Remove from watchlist", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Add to watchlist", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Add to watchlist", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Remove from watchlist",
        exact: true,
      }),
    ).toBeVisible();
    const popupPromise = page.waitForEvent("popup");
    await dialog
      .getByRole("link", { name: "Search on GPT", exact: true })
      .click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL("https://chatgpt.com/");
    assert.equal(await popup.evaluate(() => window.opener), null);
    await page.bringToFront();
    await expect(dialog.getByRole("status")).toContainText(
      "Research prompt copied",
    );
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(
      prompt,
      buildCompanyResearchPrompt(
        filterDirectory(stocks, { search: "ADANIPORTS" }).stocks[0],
      ),
    );
    await popup.close();
    await page.keyboard.press("Escape");
    // Text returned by a provider must not become active markup, in rows or dialogs.
    await page.getByRole("textbox", { name: "Search stocks" }).fill("UNSAFE");
    await expect(rows).toHaveCount(1);
    assert.equal(await rows.locator("img").count(), 0);
    await rows.locator(".company").click();
    dialog = page.getByRole("dialog", { name: "Stock details" });
    await expect(dialog).toContainText("<img src=x");
    assert.equal(await dialog.locator("img").count(), 0);
    assert.notEqual(await page.evaluate(() => window.__xssExecuted), true);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    const map = page.locator("#sector-heatmap");
    await expect(map.locator(".heatmap-tile")).toHaveCount(3);
    await map.getByRole("button", { name: "1 week", exact: true }).click();
    await expect(
      map.getByRole("button", { name: "1 week", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      map.locator('.heatmap-tile[aria-label^="Marine Shipping,"]'),
    ).toContainText("-5.00%");
    await map.getByRole("button", { name: "1 month", exact: true }).click();
    await expect(
      map.locator('.heatmap-tile[aria-label^="Marine Shipping,"]'),
    ).toContainText("+20.00%");
    await map.locator('.heatmap-tile[aria-label^="Major Banks,"]').click();
    await expect(map.locator(".heatmap-tile")).toHaveCount(1);
    await expect(map.locator(".heatmap-tile")).toContainText("Unavailable");
    await map
      .getByRole("button", { name: "All industries", exact: true })
      .click();
    await map
      .getByRole("combobox", { name: "Heatmap exchange" })
      .selectOption("all");
    await expect(map.locator(".heatmap-summary")).toContainText("31 companies");
    // Latest-response integrity: a slow superseded search must not replace the newest search.
    delay = true;
    await page.getByRole("textbox", { name: "Search stocks" }).fill("Example");
    await wait(280);
    await page.getByRole("textbox", { name: "Search stocks" }).fill("HDFCBANK");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("HDFC Bank");
    await wait(350);
    await expect(rows).toContainText("HDFC Bank");
    delay = false;
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    failChart = true;
    await openAdani.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Price history is unavailable",
    );
    await page.keyboard.press("Escape");
    failChart = false;
    failStocks = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator(".stocks").getByRole("alert")).toContainText(
      "Controlled provider failure",
    );
    await expect(rows).toHaveCount(0);
    failStocks = false;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(rows).toHaveCount(25);
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdani.click();
    await expect(
      page.getByRole("dialog", { name: "Stock details" }),
    ).toBeVisible();
    const box = await page
      .getByRole("dialog", { name: "Stock details" })
      .boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    fs.mkdirSync(path.join(project, "audit-artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(project, "audit-artifacts/mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.screenshot({
      path: path.join(project, "audit-artifacts/desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Data source" })
      .selectOption("sample");
    await expect(rows).toHaveCount(12);
    await expect(page.locator(".notice")).toContainText("illustrative");
    await page
      .getByRole("combobox", { name: "Data source" })
      .selectOption("market");
    await expect(rows).toHaveCount(25);
    // Browser storage can be absent or corrupt without blanking the app.
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => "{broken json";
      Storage.prototype.setItem = () => {
        throw new Error("Storage disabled");
      };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rows).toHaveCount(25);
    assert.deepEqual(errors, [], "Browser errors");
    assert.deepEqual(cspErrors, [], "Unexpected CSP violations");
    console.log(
      "PASS: production headers, API rejection, directory/search/pagination/filters, screener validation, aliases/deduplication, watchlist compatibility, BSE comparison removal, details/Escape/focus, ChatGPT real clipboard and safe tab, untrusted-text escaping, period heatmaps, stale responses, failures/retry, mobile, sample isolation, broken storage. External responses were controlled fixtures.",
    );
  } finally {
    await browser?.close();
    if (server) {
      server.kill();
      await new Promise((resolve) => {
        server.once("exit", resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
