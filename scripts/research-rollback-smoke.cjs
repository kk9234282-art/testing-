// Run after: VITE_COMPANY_RESEARCH=false npm run build -- --outDir /tmp/tickr-classic-dist
const { chromium, expect } = require("@playwright/test");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const app = express();
  app.use("/research", express.static(path.resolve(__dirname, "../dist")));
  app.use(express.static("/tmp/tickr-classic-dist"));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: '{"error":"Controlled offline source"}',
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page
      .getByRole("combobox", { name: "Data source" })
      .selectOption("sample");
    await expect(page.locator(".stocks tbody tr")).toHaveCount(12);
    await page.locator(".company").first().click();
    const dialog = page.getByRole("dialog", { name: "Stock details" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("tablist", { name: "Company research tabs" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", {
        name: /Use classic view|Use chart and research view/,
      }),
    ).toHaveCount(0);
    await expect(dialog.locator(".spark.large")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.route("**/assets/CompanyResearch-*.js", (route) =>
      route.abort(),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/research/`);
    await page
      .getByRole("combobox", { name: "Data source" })
      .selectOption("sample");
    await page.locator(".company").first().click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Chart and research tools could not load",
    );
    await dialog
      .getByRole("button", { name: "Use classic view", exact: true })
      .click();
    await expect(dialog.locator(".spark.large")).toBeVisible();
    await page.reload();
    await page
      .getByRole("combobox", { name: "Data source" })
      .selectOption("sample");
    await page.locator(".company").first().click();
    await expect(dialog.locator(".spark.large")).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Use chart and research view",
        exact: true,
      }),
    ).toBeVisible();
    console.log(
      "PASS: disabled deployment, failed chart bundle isolation, classic switch and remembered classic preference on mobile.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
