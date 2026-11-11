import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyListings,
  matchesListing,
  sameCompany,
} from "../shared/listings.js";
import { filterDirectory } from "../server/directory.js";
import { buildHeatmap } from "../shared/heatmap.js";
const nse = {
  id: "NSE:ACME",
  symbol: "ACME",
  name: "Acme Industries Limited",
  exchange: "NSE",
  marketCap: 100,
  price: 10,
  change: 1,
  changeWeek: 2,
  changeMonth: 3,
  sector: "Industrials",
  industry: "Manufacturing",
  pe: 20,
};
const bse = {
  ...nse,
  id: "BSE:500123",
  symbol: "500123",
  name: "ACME INDUSTRIES LTD.",
  exchange: "BSE",
  marketCap: 105,
  price: 11,
  change: -1,
  changeWeek: -2,
  changeMonth: -3,
};
const other = {
  ...nse,
  id: "BSE:OTHER",
  symbol: "OTHER",
  name: "Other Company Limited",
  exchange: "BSE",
  marketCap: 50,
};

test("dual-listed companies have one NSE-preferred row, both badges and original listing aliases", () => {
  const rows = companyListings([bse, nse, other]);
  assert.equal(rows.length, 2);
  const merged = rows.find((s) => s.id === nse.id);
  assert.equal(merged.exchangeLabel, "NSE + BSE");
  assert.equal(merged.price, 10);
  assert.equal(merged.marketCap, 100);
  assert.deepEqual(merged.listingIds, ["NSE:ACME", "BSE:500123"]);
  assert.ok(matchesListing(merged, "BSE:500123"));
  assert.ok(matchesListing(merged, "500123"));
  assert.ok(sameCompany(merged, bse));
  assert.equal(companyListings(rows).length, 2);
  const filtered = companyListings([nse, bse, other], "BSE");
  assert.equal(filtered.length, 2);
  assert.equal(filtered.find((s) => s.name === bse.name).price, 11);
});

test("matching is conservative for conflicting identifiers, ambiguous names and multiple share classes", () => {
  const conflicting = [
    { ...nse, isin: "INE000A01012" },
    { ...bse, isin: "INE000B01012" },
  ];
  assert.equal(companyListings(conflicting).length, 2);
  const extra = { ...bse, id: "BSE:SECOND", symbol: "SECOND" };
  assert.equal(companyListings([nse, bse, extra]).length, 3);
  const preferred = {
    ...bse,
    name: "Acme Industries Limited Preference Shares",
  };
  assert.equal(companyListings([nse, preferred]).length, 2);
  const aliases = [
    { ...nse, isin: "INE000A01012" },
    { ...bse, name: "Different official label", isin: "INE000A01012" },
  ];
  assert.equal(companyListings(aliases).length, 1);
  const chain = [
    { ...nse, isin: "INE000A01012" },
    { ...bse, name: "Different label", isin: "INE000A01012" },
    { ...extra, name: "Different label" },
  ];
  assert.equal(companyListings(chain).length, 2);
});

test("deduplication precedes sorting, filters and pagination and retains BSE code/watchlist/compare lookups", () => {
  const all = filterDirectory([bse, nse, other], { pageSize: "1" });
  assert.equal(all.total, 2);
  assert.equal(all.universeTotal, 2);
  assert.equal(all.pages, 2);
  assert.equal(all.stocks[0].id, nse.id);
  const byCode = filterDirectory([nse, bse, other], { search: "500123" });
  assert.equal(byCode.total, 1);
  assert.equal(byCode.stocks[0].id, nse.id);
  const watch = filterDirectory([nse, bse, other], {
    tab: "Watchlist",
    watch: "BSE:500123",
  });
  assert.equal(watch.total, 1);
  const compare = filterDirectory([nse, bse], { ids: "NSE:ACME,BSE:500123" });
  assert.equal(compare.total, 1);
  const bseOnly = filterDirectory([nse, bse], { exchange: "BSE" });
  assert.equal(bseOnly.stocks[0].id, bse.id);
  assert.equal(bseOnly.stocks[0].exchangeLabel, "NSE + BSE");
  assert.equal(all.fundamentalCoverage.pe, 2);
});

test("combined heatmaps count issuer market cap and breadth once, across all time periods", () => {
  const all = buildHeatmap([nse, bse, other], { exchange: "all" });
  assert.equal(all.totalListings, 2);
  assert.equal(all.totalCap, 150);
  assert.equal(all.advances, 2);
  assert.equal(
    buildHeatmap([nse, bse], { exchange: "all", period: "1w" }).change,
    2,
  );
  assert.equal(
    buildHeatmap([nse, bse], { exchange: "BSE", period: "1w" }).change,
    -2,
  );
  assert.equal(
    buildHeatmap([nse, bse], { exchange: "all", period: "1m" }).stocks[0]
      .exchangeLabel,
    "NSE + BSE",
  );
});
