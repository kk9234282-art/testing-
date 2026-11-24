import { companyListings } from "./listings.js";
export const INDEX_DEFINITIONS = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^BSESN", name: "SENSEX" },
  { symbol: "^NSEBANK", name: "NIFTY BANK" },
];
export function marketBreadth(stocks) {
  const companies = companyListings(stocks);
  let advances = 0,
    declines = 0,
    unchanged = 0,
    unavailable = 0;
  for (const stock of companies) {
    if (!Number.isFinite(stock.change)) unavailable++;
    else if (stock.change > 0) advances++;
    else if (stock.change < 0) declines++;
    else unchanged++;
  }
  return {
    advances,
    declines,
    unchanged,
    unavailable,
    total: companies.length,
  };
}
