import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeScanner,
  EXTENDED_COLUMNS,
  filterDirectory,
} from "../server/directory.js";
import { buildHeatmap } from "../shared/heatmap.js";
const stocks = [
  {
    id: "NSE:A",
    symbol: "A",
    name: "A",
    sector: "Financials",
    industry: "Banking",
    exchange: "NSE",
    marketCap: 100,
    change: 1,
  },
  {
    id: "NSE:B",
    symbol: "B",
    name: "B",
    sector: "Financials",
    industry: "Insurance",
    exchange: "NSE",
    marketCap: 200,
    change: -1,
  },
  {
    id: "NSE:C",
    symbol: "C",
    name: "C",
    sector: "Financials",
    industry: null,
    exchange: "NSE",
    marketCap: 50,
    change: 0,
  },
  {
    id: "NSE:D",
    symbol: "D",
    name: "D",
    sector: "Manufacturing",
    industry: "Automobiles",
    exchange: "NSE",
    marketCap: null,
    change: 2,
  },
  {
    id: "BSE:E",
    symbol: "E",
    name: "E",
    sector: "Manufacturing",
    industry: "Steel",
    exchange: "BSE",
    marketCap: 100,
    change: 2,
  },
];
test("industry grouping expands broad sectors without guessing missing classifications", () => {
  const broad = buildHeatmap(stocks, { groupBy: "sector" }),
    detail = buildHeatmap(stocks, { groupBy: "industry" });
  assert.equal(broad.sectors.length, 2);
  assert.equal(detail.sectors.length, 4);
  assert.deepEqual(
    new Set(detail.availableGroups),
    new Set([
      "Banking",
      "Insurance",
      "Financials (industry unavailable)",
      "Automobiles",
    ]),
  );
  assert.equal(detail.unclassifiedIndustries, 1);
  assert.ok(
    detail.sectors.some(
      (s) => s.name === "Automobiles" && s.marketCap === 0 && s.count === 1,
    ),
  );
  const drill = buildHeatmap(stocks, {
    groupBy: "industry",
    group: "Insurance",
  });
  assert.equal(drill.stocks[0].id, "NSE:B");
  assert.deepEqual(drill.selectedFilter, { industry: "Insurance" });
  const missing = buildHeatmap(stocks, {
    groupBy: "industry",
    group: "Financials (industry unavailable)",
  });
  assert.deepEqual(missing.selectedFilter, {
    sector: "Financials",
    industry: "__missing__",
  });
  assert.throws(() => buildHeatmap(stocks, { groupBy: "invalid" }), RangeError);
});
test("all data-backed categories survive stock tile limits and exchange selection", () => {
  const result = buildHeatmap(stocks, {
    exchange: "all",
    groupBy: "industry",
    limit: "100",
  });
  assert.equal(result.availableGroups.length, 5);
  assert.equal(
    buildHeatmap(stocks, { exchange: "BSE", groupBy: "industry" }).sectors[0]
      .name,
    "Steel",
  );
});
test("industry filtering combines with sector and exchange across the full directory", () => {
  assert.deepEqual(
    filterDirectory(stocks, { sector: "Financials" }).industries,
    ["Banking", "Insurance"],
  );
  assert.deepEqual(
    filterDirectory(stocks, { industry: "Insurance" }).stocks.map((s) => s.id),
    ["NSE:B"],
  );
  assert.deepEqual(
    filterDirectory(stocks, { industry: "__missing__" }).stocks.map(
      (s) => s.id,
    ),
    ["NSE:C"],
  );
  assert.equal(
    filterDirectory(stocks, { sector: "Manufacturing", industry: "Banking" })
      .total,
    0,
  );
});
test("normalization reads the industry column without shifting financial values", () => {
  const values = [
    "AAA",
    "A",
    100,
    1,
    1000,
    1e9,
    " Financials ",
    "NSE",
    " Banking ",
    18,
    2,
    10,
    12,
    15,
    0.5,
    1,
  ];
  const [s] = normalizeScanner(
    { totalCount: 1, data: [{ s: "NSE:AAA", d: values }] },
    "2026-11-05",
    EXTENDED_COLUMNS,
  );
  assert.equal(s.industry, "Banking");
  assert.equal(s.sector, "Financials");
  assert.equal(s.pe, 18);
  assert.equal(s.dividendYield, 1);
});

test("unsupported industry column still allows basic directory data", async () => {
  const { createDirectoryLoader, CORE_COLUMNS } =
    await import("../server/directory.js");
  let calls = 0;
  const loader = createDirectoryLoader({
    fetchData: async (url, options) => {
      calls++;
      const columns = JSON.parse(options.body).columns;
      if (columns.includes("industry")) return { ok: false, status: 400 };
      assert.deepEqual(columns, CORE_COLUMNS);
      return {
        ok: true,
        json: async () => ({
          totalCount: 1,
          data: [
            { s: "NSE:A", d: ["A", "A", 100, 1, 100, 1e9, "Finance", "NSE"] },
          ],
        }),
      };
    },
  });
  const result = await loader();
  assert.equal(calls, 3);
  assert.equal(result.stocks[0].industry, null);
  assert.equal(result.stocks[0].price, 100);
});
