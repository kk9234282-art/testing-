/* Hosted batch queue UI: no background polling or implicit retries. */
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
    const demo = JSON.parse(
      fs.readFileSync("public/structure-demo.json", "utf8"),
    );
    const dataset = "b".repeat(64);
    let identity = "bfc911cd-6f46-4dae-b320-a45674b967ea";
    let checks = 0,
      posts = 0,
      complete = false,
      kind = "scan";
    await page.route("**/api/structure/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/datasets"))
        return route.fulfill({
          json: [
            {
              id: dataset,
              manifest: {
                ...demo.scan.manifest,
                latest_complete_session: demo.scan.as_of,
              },
            },
          ],
        });
      if (url.pathname.endsWith("/market-data/status"))
        return route.fulfill({
          status: 503,
          json: { detail: "Fixture: monitoring unavailable" },
        });
      if (route.request().method() === "POST") {
        posts++;
        kind = url.pathname.split("/").pop();
        return route.fulfill({
          json: { run_id: identity, state: "queued", job_mode: "external" },
        });
      }
      if (url.pathname.endsWith("/runs/" + identity)) {
        checks++;
        return route.fulfill({
          json: {
            id: identity,
            dataset_id: dataset,
            kind,
            state: complete ? "complete" : "queued",
            request: { as_of: demo.scan.as_of },
            result: complete
              ? kind === "scan"
                ? demo.scan
                : demo.backtest
              : null,
          },
        });
      }
      return route.fulfill({
        status: 404,
        json: { detail: "Unknown fixture route" },
      });
    });
    await page.goto(origin + "/scanner.html");
    await page
      .getByLabel("Scanner dataset source", { exact: true })
      .selectOption("private");
    await page
      .getByLabel("Scanner service token", { exact: true })
      .fill("fixture-token-never-an-owner-credential");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page
      .getByRole("button", { name: "Run EOD scan", exact: true })
      .click();
    await expect(
      page.getByLabel("Research job ID", { exact: true }),
    ).toHaveValue(identity);
    await expect(
      page.getByRole("button", { name: "Run EOD scan", exact: true }),
    ).toBeEnabled();
    await page.waitForTimeout(1800);
    if (checks !== 0 || posts !== 1)
      throw Error("External queue started automatic polling or duplicate jobs");
    await page
      .getByRole("button", { name: "Check research job", exact: true })
      .click();
    await expect(
      page.getByText(`Job ${identity}: queued`, { exact: true }),
    ).toBeVisible();
    if (checks !== 1)
      throw Error("Manual pending check did not make exactly one request");
    complete = true;
    await page
      .getByRole("button", { name: "Check research job", exact: true })
      .click();
    await expect(
      page
        .getByRole("table", { name: "Structure scanner stocks" })
        .locator("tbody tr"),
    ).toHaveCount(15);
    if (checks !== 2 || posts !== 1)
      throw Error("Loading completed job repeated a calculation");
    await page.getByLabel("Research job ID", { exact: true }).fill("invalid");
    await page
      .getByRole("button", { name: "Check research job", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Enter the research job ID" }),
    ).toBeVisible();
    if (checks !== 2) throw Error("Invalid ID was sent to the backend");
    await page.reload();
    await page
      .getByLabel("Scanner dataset source", { exact: true })
      .selectOption("private");
    await page
      .getByLabel("Scanner service token", { exact: true })
      .fill("fixture-token-never-an-owner-credential");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByLabel("Research job ID", { exact: true }).fill(identity);
    await page
      .getByRole("button", { name: "Check research job", exact: true })
      .click();
    await expect(
      page
        .getByRole("table", { name: "Structure scanner stocks" })
        .locator("tbody tr"),
    ).toHaveCount(15);
    if (posts !== 1 || checks !== 3)
      throw Error("Job could not resume after reload without a new POST");
    identity = "aaf911cd-6f46-4dae-b320-a45674b967ea";
    kind = "backtest";
    await page.getByLabel("Research job ID", { exact: true }).fill(identity);
    await page
      .getByRole("button", { name: "Check research job", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "What happened after the signal?",
        exact: true,
      }),
    ).toBeVisible();
    if (posts !== 1 || checks !== 4)
      throw Error("Loading a completed backtest queued a new calculation");
    console.log(
      "External-worker browser audit passed: queue without polling, one-request manual checks, completed job loading, invalid IDs and reload/resume without duplicate calculation.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
