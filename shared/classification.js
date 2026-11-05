export const cleanLabel = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
export const sectorOf = (stock) => cleanLabel(stock.sector) || "Unclassified";
export const industryOf = (stock) => cleanLabel(stock.industry);
export function groupOf(stock, groupBy = "sector") {
  return groupBy === "industry"
    ? industryOf(stock) || `${sectorOf(stock)} (industry unavailable)`
    : sectorOf(stock);
}
