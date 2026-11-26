/* Evidence drafts must remain local and cannot approve scanner inputs. */
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
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
      uploads = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (req) => {
      if (req.method() !== "GET") uploads.push(req.url());
    });
    await page.goto(origin + "/scanner.html");
    await page
      .getByRole("button", { name: "Data quality & review", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Data quality and action review",
    });
    await expect(
      panel.getByText("Synthetic demonstration", { exact: false }),
    ).toBeVisible();
    await panel.getByText(/Stock-level data checks/).click();
    await panel
      .getByLabel("Search stock data checks", { exact: true })
      .fill("EXAMPLE01");
    await expect(
      panel
        .getByRole("table", { name: "Stock data quality" })
        .locator("tbody tr"),
    ).toHaveCount(1);
    await panel
      .getByLabel("Search stock data checks", { exact: true })
      .fill("");
    await panel.getByText(/Stock-level data checks/).click();
    await panel.getByLabel("Listing ID", { exact: true }).fill("NSE:PNB");
    await panel
      .getByLabel("Effective date", { exact: true })
      .fill("2026-08-12");
    await panel
      .getByRole("button", { name: "Save review draft", exact: true })
      .click();
    const rows = panel
      .getByRole("table", { name: "Corporate-action review drafts" })
      .locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Needs evidence");
    await page.getByRole("button", { name: "Discovery", exact: true }).click();
    await page
      .getByRole("button", { name: "Data quality & review", exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await panel
      .getByRole("button", { name: "Edit review 1", exact: true })
      .click();
    await panel
      .getByLabel("Review state", { exact: true })
      .selectOption("Review recorded");
    await panel
      .getByRole("button", { name: "Save review draft", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "requires publication time",
    );
    await panel
      .getByLabel("Original publication time", { exact: true })
      .fill("2026-08-01T17:20:00");
    await panel
      .getByRole("button", { name: "Save review draft", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText("timezone");
    await panel
      .getByLabel("Original publication time", { exact: true })
      .fill("2026-08-01T17:20:00+05:30");
    await panel
      .getByLabel("Notice source URL", { exact: true })
      .fill("https://example.com/notice.pdf");
    const notice = Buffer.from(
      "Synthetic evidence document for browser test only.",
    );
    await panel.getByLabel("Hash local notice", { exact: true }).setInputFiles({
      name: "notice.txt",
      mimeType: "text/plain",
      buffer: notice,
    });
    await expect(
      panel.getByLabel("Document SHA-256", { exact: true }),
    ).toHaveValue(createHash("sha256").update(notice).digest("hex"));
    await panel.getByLabel("Reviewer", { exact: true }).fill("Test reviewer");
    await panel
      .getByLabel("Evidence notes", { exact: true })
      .fill("Synthetic review only; no real publication evidence.");
    await panel
      .getByRole("button", { name: "Save review draft", exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Review recorded");
    const downloadPromise = page.waitForEvent("download");
    await panel
      .getByRole("button", { name: "Export review drafts", exact: true })
      .click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    if (
      exported.scope !== "synthetic-demo" ||
      exported.approval_effect !== "none" ||
      exported.records.length !== 1
    )
      throw Error("Invalid export scope or approval claim");
    const file = (value) => ({
      name: "reviews.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(file({ ...exported, scope: "different-private-dataset" }));
    await expect(panel.getByRole("alert")).toContainText("exact dataset scope");
    await expect(rows).toHaveCount(1);
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(
        file({
          ...exported,
          records: [
            { ...exported.records[0], source_url: "javascript:alert(1)" },
          ],
        }),
      );
    await expect(panel.getByRole("alert")).toContainText("HTTPS");
    await expect(rows).toHaveCount(1);
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(
        file({
          ...exported,
          records: [{ ...exported.records[0], effective_on: "2026-02-30" }],
        }),
      );
    await expect(panel.getByRole("alert")).toContainText(
      "valid effective date",
    );
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(
        file({
          ...exported,
          records: [{ ...exported.records[0], verified: true }],
        }),
      );
    await expect(panel.getByRole("alert")).toContainText(
      "Unknown review fields",
    );
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(
        file({ ...exported, records: Array(101).fill(exported.records[0]) }),
      );
    await expect(panel.getByRole("alert")).toContainText("maximum 100");
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles({
        name: "oversized.json",
        mimeType: "application/json",
        buffer: Buffer.alloc(3_000_001, 32),
      });
    await expect(panel.getByRole("alert")).toContainText("3 MB");
    await panel
      .getByRole("button", { name: "Remove review 1", exact: true })
      .click();
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(file(exported));
    await expect(rows).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Mobile review page overflows viewport");
    fs.mkdirSync("audit-artifacts", { recursive: true });
    await page.screenshot({
      path: "audit-artifacts/action-review-mobile.png",
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Data quality & review", exact: true })
      .click();
    await expect(
      panel.getByRole("table", { name: "Corporate-action review drafts" }),
    ).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    if (/Test reviewer|NSE:PNB|Synthetic review/.test(stored))
      throw Error("Review evidence persisted in browser storage");
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(file(exported));
    await expect(rows).toHaveCount(1);
    await page.route("**/api/structure/datasets", (route) =>
      route.fulfill({
        json: [
          {
            id: "a".repeat(64),
            manifest: {
              name: "Raw fixture",
              kind: "licensed",
              source: "Browser test fixture",
              latest_complete_session: "2026-11-25",
              corporate_actions_complete: false,
              universe_history_complete: false,
            },
          },
        ],
      }),
    );
    await page.route("**/api/structure/market-data/status", (route) =>
      route.fulfill({
        status: 503,
        json: { detail: "Fixture: no monitoring" },
      }),
    );
    await page
      .getByLabel("Scanner dataset source", { exact: true })
      .selectOption("private");
    await page
      .getByLabel("Scanner service token", { exact: true })
      .fill("browser-fixture-token-not-a-secret");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByText("Private dataset connected. Run a scan.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Data quality & review", exact: true })
      .click();
    await expect(
      panel.getByRole("table", { name: "Corporate-action review drafts" }),
    ).toHaveCount(0);
    await expect(
      panel.getByText("Missing / needs review", { exact: true }),
    ).toHaveCount(4);
    await expect(
      panel.getByText("Private research inputs", { exact: false }),
    ).toBeVisible();
    await panel
      .getByLabel("Import action reviews", { exact: true })
      .setInputFiles(file(exported));
    await expect(panel.getByRole("alert")).toContainText("exact dataset scope");
    if (uploads.length || errors.length)
      throw Error(JSON.stringify({ uploads, errors }));
    console.log(
      "Action-review browser audit passed: scoped imports, unsafe input rejection, local hashing, export round trip, navigation, reload privacy and mobile layout.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
