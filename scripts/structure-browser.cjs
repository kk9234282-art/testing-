/* Separate-page browser audit. Uses synthetic history and a real local API/DB. */
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const project = path.resolve(__dirname, "..");
const token = "local-browser-scanner-test-token";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("Local test service did not start");
}
(async () => {
  const apiPort = await port(),
    webPort = await port(),
    origin = `http://127.0.0.1:${webPort}`;
  const python = process.env.SCANNER_PYTHON || "python3";
  let api, web, browser;
  let logs = "";
  try {
    api = spawn(
      python,
      [
        "-m",
        "uvicorn",
        "scanner_service.app:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(apiPort),
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          SCANNER_ADMIN_TOKEN: token,
          SCANNER_DATABASE_URL:
            process.env.SCANNER_TEST_DATABASE_URL ||
            `sqlite:////tmp/tickr-structure-browser-${process.pid}.sqlite3`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    api.stderr.on("data", (chunk) => (logs += chunk));
    api.stdout.on("data", () => {});
    await ready(`http://127.0.0.1:${apiPort}/api/structure/health`);
    web = spawn(process.execPath, ["server/index.js"], {
      cwd: project,
      env: {
        ...process.env,
        PORT: String(webPort),
        SCANNER_SERVICE_URL: `http://127.0.0.1:${apiPort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    web.stderr.on("data", (chunk) => (logs += chunk));
    web.stdout.on("data", () => {});
    await ready(origin + "/api/health");
    const denied = await fetch(origin + "/api/structure/datasets");
    if (denied.status !== 401)
      throw new Error("Private scanner data is not authenticated");
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1050 },
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await page.goto(origin + "/scanner.html");
    await expect(
      page.getByText("ILLUSTRATIVE SAMPLE — not actual stock signals.", {
        exact: true,
      }),
    ).toBeVisible();
    let rows = page
      .getByRole("table", { name: "Structure scanner stocks" })
      .locator("tbody tr");
    await expect(rows).toHaveCount(15);
    await expect(rows.filter({ hasText: "EXAMPLE02" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "EXAMPLEETF" })).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Search structure stocks" })
      .fill("EXAMPLE01");
    await expect(rows).toHaveCount(1);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Filter structural stage" })
      .selectOption("Confirmed Bullish");
    await expect(rows).toHaveCount(5);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Filter structure exchange" })
      .selectOption("BSE");
    await expect(rows).toHaveCount(4); // BSE alias plus three BSE-only active securities.
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await rows.first().getByRole("button").click();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible();
    await expect(page.locator(".sl-chart canvas").first()).toBeVisible();
    if (!new URL(page.url()).hash.startsWith("#/stock/"))
      throw new Error("Stock page is not linkable");
    await page.reload();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible();

    await expect(
      page.getByText("Initial signal", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Confirmed structural history",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Market regime", exact: true })
      .click();
    await expect(page.locator(".sl-index-grid .sl-panel")).toHaveCount(6);
    await expect(
      page.getByRole("img", {
        name: "Advance decline line since dataset start",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Sector rankings", exact: true })
      .click();
    await expect(page.locator(".sl-panel tbody tr")).toHaveCount(4);
    await page
      .getByRole("button", { name: "Backtesting", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "What happened after the signal?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".sl-panel table").first().locator("tbody tr"),
    ).toHaveCount(3);
    await expect(page.locator(".sl-panel table").first()).toContainText(
      "Censored",
    );
    await page
      .getByRole("button", { name: "Data & methodology", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Download synthetic import example" }),
    ).toHaveAttribute("href", "/structure-import-example.json");
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
    }
    fs.mkdirSync(path.join(project, "audit-artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(project, "audit-artifacts/structure-scanner.png"),
      fullPage: true,
    });
    // Real PostgreSQL/FastAPI import/queue/poll/stock path via same-origin bridge.
    await page
      .getByRole("combobox", { name: "Scanner dataset source" })
      .selectOption("private");
    await expect(rows).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Scanner service token" })
      .fill("wrong-token");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Invalid research service token",
    );
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Scanner service token" })
      .fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page
      .getByRole("button", { name: "Data & methodology", exact: true })
      .click();
    await expect(page.getByLabel("Import scanner history")).toBeEnabled();
    await page
      .getByLabel("Import scanner history")
      .setInputFiles(
        path.join(project, "public/structure-import-example.json"),
      );
    await expect(page.getByRole("status")).toContainText(
      "Dataset validated and stored",
      { timeout: 30000 },
    );
    const importStatus = page.getByLabel("Private market data status");
    await expect(importStatus).toContainText("Source:");
    await expect(importStatus).toContainText("Last successful dataset import:");
    await expect(importStatus).toContainText("No paid scheduler is enabled");
    await page
      .getByRole("button", { name: "Run EOD scan", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("complete", {
      timeout: 120000,
    });
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    await expect(rows).toHaveCount(15);
    await expect(
      page.getByText("ILLUSTRATIVE SAMPLE — not actual stock signals.", {
        exact: true,
      }),
    ).toBeVisible();
    await rows.first().getByRole("button").click();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Backtesting", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run historical cohorts", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("complete", {
      timeout: 120000,
    });
    await expect(
      page.locator(".sl-panel table").first().locator("tbody tr"),
    ).toHaveCount(3);
    if (
      await page.evaluate(
        (value) => JSON.stringify(localStorage).includes(value),
        token,
      )
    )
      throw new Error("Service token was persisted");
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    await rows.first().getByRole("button").click();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible({ timeout: 30000 });
    if (!new URL(page.url()).hash.startsWith("#/run/"))
      throw new Error("Private stock link lacks its immutable scan run");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Scanner dataset source" }),
    ).toHaveValue("private");
    await expect(
      page.getByRole("textbox", { name: "Scanner service token" }),
    ).toHaveValue("");
    await page
      .getByRole("textbox", { name: "Scanner service token" })
      .fill(token);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByRole("img", {
        name: "Confirmed structure, volume and relative strength chart",
      }),
    ).toBeVisible({ timeout: 30000 });
    // Incomplete real-source contract must never publish synthetic fixture signals.
    await page
      .getByRole("button", { name: "Data & methodology", exact: true })
      .click();
    const incomplete = JSON.parse(
      fs.readFileSync(
        path.join(project, "public/structure-import-example.json"),
        "utf8",
      ),
    );
    incomplete.manifest.kind = "licensed";
    incomplete.manifest.source =
      "TEST ONLY synthetic fixture for incomplete-source gate";
    incomplete.manifest.corporate_actions_complete = false;
    incomplete.manifest.universe_history_complete = false;
    await expect(page.getByLabel("Import scanner history")).toBeEnabled();
    await page
      .getByLabel("Import scanner history")
      .setInputFiles({
        name: "incomplete-test.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(incomplete)),
      });
    await expect(page.getByRole("status")).toContainText(
      "Dataset validated and stored",
      { timeout: 30000 },
    );
    await page
      .getByRole("button", { name: "Run EOD scan", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("complete", {
      timeout: 120000,
    });
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    await expect(rows.first()).toContainText("Unavailable");
    await expect(rows.first()).toContainText("Unverified corporate actions");
    await rows.first().getByRole("button").click();
    await expect(page.getByText(/RAW OHLCV ONLY/)).toBeVisible();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Scanner service token" }),
    ).toHaveValue("");
    if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
    console.log(
      "PASS: isolated scanner demo, filters, identifiers, charts, regimes, sectors, cohorts, mobile, private auth, validated PostgreSQL import, queued jobs and token isolation.",
    );
  } catch (error) {
    console.error(logs.slice(-2500));
    throw error;
  } finally {
    await browser?.close();
    web?.kill();
    api?.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
