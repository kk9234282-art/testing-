/* Scanner preferences: persistence, source isolation, backups and storage failures. */
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  let browser;
  try {
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + "/api/health")).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      acceptDownloads: true,
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (req) => {
      if (req.method() !== "GET") requests.push(req.url());
    });
    const key = "tickr.structure.preferences.v1";
    await page.goto(origin + "/scanner.html");
    await page.evaluate(() =>
      localStorage.setItem("tickr-watch", '["NSE:PNB"]'),
    );
    const table = page.getByRole("table", { name: "Structure scanner stocks" });
    await expect(table.locator("tbody tr")).toHaveCount(15);
    await page
      .getByRole("button", { name: "Watch EXAMPLE01", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unwatch EXAMPLE01", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Watchlist only", { exact: true }).check();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page
      .getByLabel("Search structure stocks", { exact: true })
      .fill("EXAMPLE01");
    await page
      .getByLabel("Sort structural stocks", { exact: true })
      .selectOption("symbol");
    await page.getByLabel("Reverse structure sort", { exact: true }).click();
    await page
      .getByLabel("Filter structural stage", { exact: true })
      .selectOption("Early Reversal");
    await page
      .getByLabel("Filter structure sector", { exact: true })
      .selectOption("Technology");
    await page
      .getByLabel("Filter structure exchange", { exact: true })
      .selectOption("NSE");
    await page
      .getByLabel("Minimum relative strength", { exact: true })
      .fill("1");
    await page.getByLabel("Minimum volume ratio", { exact: true }).fill("1");
    await page.getByLabel("Minimum ADX", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Columns", exact: true }).click();
    await page.getByLabel("RS", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Scanner research workspace",
    });
    await panel.getByLabel("Preset name", { exact: true }).fill("My focus");
    await panel
      .getByRole("button", { name: "Save current filters", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("saved");
    await panel
      .getByRole("button", { name: "Open EXAMPLE01", exact: true })
      .click();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Unwatch EXAMPLE01", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Watch EXAMPLE01", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    const downloadPromise = page.waitForEvent("download");
    await panel
      .getByRole("button", { name: "Export research backup", exact: true })
      .click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    if (
      exported.scope !== "sample" ||
      exported.preferences.watchlist.length !== 1 ||
      exported.preferences.presets[0].filters.search !== "EXAMPLE01"
    )
      throw Error("Backup is incomplete or source is wrong");
    if (/token|candles|evidence|password/i.test(JSON.stringify(exported)))
      throw Error("Sensitive or market data leaked into backup");
    await page.reload();
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await expect(
      panel
        .getByRole("table", { name: "Scanner watchlist" })
        .locator("tbody tr"),
    ).toHaveCount(1);
    await panel
      .getByLabel("Saved scanner filters", { exact: true })
      .selectOption("My focus");
    await panel
      .getByRole("button", { name: "Apply saved filters", exact: true })
      .click();
    await expect(
      page.getByLabel("Search structure stocks", { exact: true }),
    ).toHaveValue("EXAMPLE01");
    await expect(
      page.getByLabel("Watchlist only", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Sort structural stocks", { exact: true }),
    ).toHaveValue("symbol");
    await expect(
      page.getByLabel("Reverse structure sort", { exact: true }),
    ).toContainText("Ascending");
    await expect(
      page.getByLabel("Filter structural stage", { exact: true }),
    ).toHaveValue("Early Reversal");
    await expect(
      page.getByLabel("Filter structure sector", { exact: true }),
    ).toHaveValue("Technology");
    await expect(
      page.getByLabel("Filter structure exchange", { exact: true }),
    ).toHaveValue("NSE");
    await expect(
      page.getByLabel("Minimum relative strength", { exact: true }),
    ).toHaveValue("1");
    await expect(
      page.getByLabel("Minimum volume ratio", { exact: true }),
    ).toHaveValue("1");
    await expect(page.getByLabel("Minimum ADX", { exact: true })).toHaveValue(
      "20",
    );
    await expect(
      table.getByRole("columnheader", { name: "RS 63 (pp)", exact: true }),
    ).toHaveCount(0);
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(table.locator("tbody tr")).toHaveCount(15);
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await panel
      .getByRole("button", {
        name: "Remove EXAMPLE01 from scanner watchlist",
        exact: true,
      })
      .click();
    const file = (value) => ({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
    await panel
      .getByLabel("Import scanner preferences", { exact: true })
      .setInputFiles(file(exported));
    await expect(
      panel
        .getByRole("table", { name: "Scanner watchlist" })
        .locator("tbody tr"),
    ).toHaveCount(1);
    await panel
      .getByLabel("Import scanner preferences", { exact: true })
      .setInputFiles(file(exported));
    await expect(
      panel
        .getByRole("table", { name: "Scanner watchlist" })
        .locator("tbody tr"),
    ).toHaveCount(1);
    const conflict = structuredClone(exported);
    conflict.preferences.presets[0].filters.minVolume = "4";
    await panel
      .getByLabel("Import scanner preferences", { exact: true })
      .setInputFiles(file(conflict));
    await expect(panel.getByRole("status")).toContainText("conflict");
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Mobile workspace overflows");
    fs.mkdirSync("audit-artifacts", { recursive: true });
    await page.screenshot({
      path: "audit-artifacts/scanner-workspace-mobile.png",
      fullPage: true,
    });
    await page
      .getByLabel("Scanner dataset source", { exact: true })
      .selectOption("private");
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await expect(
      panel.getByRole("table", { name: "Scanner watchlist" }),
    ).toHaveCount(0);
    await panel
      .getByLabel("Import scanner preferences", { exact: true })
      .setInputFiles(file(exported));
    await expect(panel.getByRole("status")).toContainText("different source");
    const privateFixture = {
      format: exported.format,
      scope: "private",
      preferences: {
        watchlist: [
          {
            security_id: "FIXTURE_REAL",
            symbol: "PRIVATE_FIXTURE",
            name: "Synthetic test identity",
            isin: "INE160A01022",
          },
        ],
        presets: [],
      },
    };
    await panel
      .getByLabel("Import scanner preferences", { exact: true })
      .setInputFiles(file(privateFixture));
    await expect(
      panel.getByText("Not in current scan", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Open PRIVATE_FIXTURE", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Scanner dataset source", { exact: true })
      .selectOption("demo");
    await page
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await expect(
      panel.getByRole("table", { name: "Scanner watchlist" }),
    ).not.toContainText("PRIVATE_FIXTURE");
    if (
      (await page.evaluate(() => localStorage.getItem("tickr-watch"))) !==
      '["NSE:PNB"]'
    )
      throw Error("Main dashboard watchlist changed");
    const saved = JSON.parse(
      await page.evaluate((k) => localStorage.getItem(k), key),
    );
    if (
      saved.private.watchlist.length !== 1 ||
      saved.sample.watchlist.length !== 1
    )
      throw Error("Source preferences were overwritten");
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw Error("Blocked");
      };
      Storage.prototype.setItem = () => {
        throw Error("Blocked");
      };
    });
    await blocked.goto(origin + "/scanner.html");
    await blocked
      .getByRole("button", { name: "Watch EXAMPLE01", exact: true })
      .click();
    await expect(
      blocked.getByRole("button", { name: "Unwatch EXAMPLE01", exact: true }),
    ).toBeVisible();
    await blocked
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await expect(blocked.getByRole("alert")).toContainText("memory only");
    await expect(
      blocked
        .getByRole("table", { name: "Scanner watchlist" })
        .locator("tbody tr"),
    ).toHaveCount(1);
    await blocked.close();
    const corrupt = await browser.newPage();
    await corrupt.addInitScript(
      (k) => localStorage.setItem(k, "{corrupt"),
      key,
    );
    await corrupt.goto(origin + "/scanner.html");
    await corrupt
      .getByRole("button", { name: "Research workspace", exact: true })
      .click();
    await expect(corrupt.getByRole("alert")).toContainText("invalid");
    if (
      (await corrupt.evaluate((k) => localStorage.getItem(k), key)) !==
      "{corrupt"
    )
      throw Error("Invalid storage overwritten on startup");
    await corrupt.close();
    if (requests.length || errors.length)
      throw Error(JSON.stringify({ requests, errors }));
    console.log(
      "Research workspace browser audit passed: watched-only discovery, preset apply/reload, backup merge/conflicts, private/sample isolation, missing stocks, main-dashboard isolation, storage failures and mobile layout.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
