import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildCompanyResearchPrompt } from "../shared/company-research.js";

test("Adani Ports receives the full business research prompt with the actual selected identity", () => {
  const prompt = buildCompanyResearchPrompt({
    name: "Adani Ports and Special Economic Zone Ltd.",
    symbol: "ADANIPORTS",
    exchange: "NSE",
    id: "NSE:ADANIPORTS",
    isin: "INE742F01042",
    sector: "Transportation",
    industry: "Marine Shipping",
  });
  assert.ok(
    prompt.includes("**Company: Adani Ports and Special Economic Zone Ltd.**"),
  );
  assert.ok(prompt.includes("**Stock Symbol: NSE:ADANIPORTS**"));
  assert.ok(prompt.includes("ISIN: INE742F01042"));
  for (const heading of [
    "Company Overview",
    "Business Model",
    "Business Operations",
    "Competitive Advantages",
    "Industry Analysis",
    "Growth Drivers",
    "Business Risks",
    "Financial Performance",
    "Valuation",
    "Company-Specific Metrics",
    "What Investors Should Monitor",
    "Final Business Summary",
  ])
    assert.ok(prompt.includes(heading));
  for (const instruction of [
    "Cargo volumes",
    "CASA ratio",
    "EBITDA per tonne",
    "R&D pipeline",
    "Employee utilization",
    "Pricing power",
    "RESEARCH QUALITY REQUIREMENTS",
    "not a personalized buy or sell recommendation",
  ])
    assert.ok(prompt.includes(instruction));
  assert.ok(!prompt.includes("{COMPANY_NAME}"));
  assert.ok(!prompt.includes("{STOCK_SYMBOL}"));
  const body = prompt
    .split("\n\nAdditional public listing context:")[0]
    .replace("Adani Ports and Special Economic Zone Ltd.", "{COMPANY_NAME}")
    .replace("NSE:ADANIPORTS", "{STOCK_SYMBOL}");
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    "d8fc89d6c996bd8e63b6b8522fe921cc260ab0e687516ca0a25a29c255c0d662",
    "Preserve the complete user-supplied research instructions.",
  );
});

test("one generator handles all selected NSE and BSE companies without a per-company prompt", () => {
  for (const [name, symbol, exchange] of [
    ["HDFC Bank Ltd.", "HDFCBANK", "NSE"],
    ["Tata Steel Ltd.", "TATASTEEL", "NSE"],
    ["Infosys Ltd.", "INFY", "NSE"],
    ["Sun Pharmaceutical Industries Ltd.", "SUNPHARMA", "NSE"],
    ["Asian Paints Ltd.", "500820", "BSE"],
  ]) {
    const prompt = buildCompanyResearchPrompt({ name, symbol, exchange });
    assert.ok(prompt.includes(`**Company: ${name}**`));
    assert.ok(prompt.includes(`**Stock Symbol: ${exchange}:${symbol}**`));
  }
});

test("missing names and tickers use available public identity, and empty identity disables the action", () => {
  assert.equal(buildCompanyResearchPrompt(), null);
  assert.equal(buildCompanyResearchPrompt(null), null);
  assert.equal(buildCompanyResearchPrompt({ name: "  ", symbol: "" }), null);
  assert.ok(
    buildCompanyResearchPrompt({ name: "Company only" }).includes(
      "Unavailable — verify the NSE/BSE ticker",
    ),
  );
  const byId = buildCompanyResearchPrompt({ id: "BSE:500820" });
  assert.ok(byId.includes("**Stock Symbol: BSE:500820**"));
  assert.ok(byId.includes("company name unavailable"));
});

test("company characters remain literal and private or unrelated fields never enter the prompt", () => {
  const prompt = buildCompanyResearchPrompt({
    name: "A $& <B> & Co.\nLtd. {STOCK_SYMBOL}",
    symbol: "M&M",
    exchange: "NSE",
    price: 12345,
    holdings: "PRIVATE HOLDINGS",
    apiKey: "SECRET VALUE",
  });
  assert.ok(prompt.includes("**Company: A $& <B> & Co. Ltd. {STOCK_SYMBOL}**"));
  assert.ok(prompt.includes("**Stock Symbol: NSE:M&M**"));
  assert.ok(!prompt.includes("PRIVATE HOLDINGS"));
  assert.ok(!prompt.includes("SECRET VALUE"));
  assert.ok(!prompt.includes("12345"));
});
