import { companyListings } from "./listings.js";
import { heatmapPeriod } from "./periods.js";
import { sectorOf, industryOf, groupOf } from "./classification.js";
const positive = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const validChange = (value) =>
  typeof value === "number" && Number.isFinite(value);
export function buildHeatmap(stocks, query = {}) {
  const period = query.period ?? "24h";
  const periodInfo = heatmapPeriod(period);
  const exchange =
    query.exchange == null || query.exchange === "" ? "NSE" : query.exchange;
  if (!["NSE", "BSE", "all"].includes(exchange))
    throw new RangeError("Choose NSE, BSE, or both exchanges.");
  if (query.sector != null && typeof query.sector !== "string")
    throw new RangeError("Choose a valid sector.");
  const groupBy = query.groupBy || "sector";
  if (!["sector", "industry"].includes(groupBy))
    throw new RangeError("Choose sector or industry grouping.");
  if (query.group != null && typeof query.group !== "string")
    throw new RangeError("Choose a valid category.");
  const sector = query.group || query.sector || "";
  const limit = ["100", "250"].includes(String(query.limit))
    ? Number(query.limit)
    : 100;
  const exchangeStocks = companyListings(stocks, exchange);
  const filtered = exchangeStocks.filter(
    (s) => !sector || groupOf(s, groupBy) === sector,
  );
  const groups = new Map();
  let advances = 0,
    declines = 0,
    unchanged = 0,
    missingChange = 0;
  for (const stock of filtered) {
    const key = groupOf(stock, groupBy);
    const movement = stock[periodInfo.key];
    if (!groups.has(key))
      groups.set(key, {
        id: key,
        name: key,
        sector: key,
        count: 0,
        marketCap: 0,
        pricedCap: 0,
        weightedSum: 0,
        advances: 0,
        declines: 0,
        unchanged: 0,
        missingChange: 0,
        missingCap: 0,
      });
    const group = groups.get(key);
    group.count++;
    if (validChange(movement)) {
      if (movement > 0) {
        advances++;
        group.advances++;
      } else if (movement < 0) {
        declines++;
        group.declines++;
      } else {
        unchanged++;
        group.unchanged++;
      }
    } else {
      missingChange++;
      group.missingChange++;
    }
    if (positive(stock.marketCap)) {
      group.marketCap += stock.marketCap;
      if (validChange(movement)) {
        group.pricedCap += stock.marketCap;
        group.weightedSum += stock.marketCap * movement;
      }
    } else group.missingCap++;
  }
  const sectors = [...groups.values()]
    .map(({ weightedSum, ...g }) => ({
      ...g,
      change: g.pricedCap > 0 ? weightedSum / g.pricedCap : null,
      changeCoverage: g.marketCap > 0 ? g.pricedCap / g.marketCap : null,
    }))
    .sort((a, b) => b.marketCap - a.marketCap || a.name.localeCompare(b.name));
  const eligible = filtered
    .filter((s) => positive(s.marketCap))
    .sort((a, b) => b.marketCap - a.marketCap || a.id.localeCompare(b.id));
  const totalCap = sectors.reduce((sum, g) => sum + g.marketCap, 0);
  const pricedCap = sectors.reduce((sum, g) => sum + g.pricedCap, 0);
  return {
    period,
    periodLabel: periodInfo.label,
    periodDescription: periodInfo.description,
    groupBy,
    unclassifiedIndustries: exchangeStocks.filter((stock) => !industryOf(stock))
      .length,
    availableGroups: [
      ...new Set(exchangeStocks.map((stock) => groupOf(stock, groupBy))),
    ].sort(),
    selectedFilter:
      filtered.length && sector
        ? groupBy === "sector"
          ? { sector: sectorOf(filtered[0]) }
          : industryOf(filtered[0])
            ? { industry: industryOf(filtered[0]) }
            : { sector: sectorOf(filtered[0]), industry: "__missing__" }
        : null,
    sectors,
    stocks: eligible.slice(0, limit).map((stock) => ({
      ...stock,
      heatmapPeriod: period,
      heatmapChange: validChange(stock[periodInfo.key])
        ? stock[periodInfo.key]
        : null,
    })),
    availableSectors: [...new Set(exchangeStocks.map(sectorOf))].sort(),
    exchange,
    sector,
    limit,
    totalListings: filtered.length,
    eligibleListings: eligible.length,
    excludedListings: filtered.length - eligible.length,
    shownListings: Math.min(limit, eligible.length),
    totalCap,
    changeCoverage: totalCap > 0 ? pricedCap / totalCap : null,
    change:
      pricedCap > 0
        ? sectors.reduce((sum, g) => sum + (g.change ?? 0) * g.pricedCap, 0) /
          pricedCap
        : null,
    advances,
    declines,
    unchanged,
    missingChange,
  };
}

// Balanced binary treemap. Every leaf gets its proportional share of area.
export function layoutTreemap(items, width, height) {
  if (!positive(width) || !positive(height)) return [];
  const entries = items
    .filter((item) => positive(item.marketCap))
    .slice()
    .sort((a, b) => b.marketCap - a.marketCap || a.id.localeCompare(b.id));
  const result = [];
  function partition(list, x, y, w, h, total) {
    if (!list.length) return;
    if (list.length === 1) {
      result.push({ ...list[0], x, y, width: w, height: h });
      return;
    }
    let index = 1,
      first = list[0].marketCap;
    while (
      index < list.length - 1 &&
      Math.abs(first + list[index].marketCap - total / 2) <
        Math.abs(first - total / 2)
    )
      first += list[index++].marketCap;
    const ratio = first / total;
    if (w >= h) {
      partition(list.slice(0, index), x, y, w * ratio, h, first);
      partition(
        list.slice(index),
        x + w * ratio,
        y,
        w * (1 - ratio),
        h,
        total - first,
      );
    } else {
      partition(list.slice(0, index), x, y, w, h * ratio, first);
      partition(
        list.slice(index),
        x,
        y + h * ratio,
        w,
        h * (1 - ratio),
        total - first,
      );
    }
  }
  partition(
    entries,
    0,
    0,
    width,
    height,
    entries.reduce((sum, s) => sum + s.marketCap, 0),
  );
  return result;
}
export function heatColor(change, maximum = 3) {
  if (!validChange(change)) return "#354150";
  change = (change * 3) / (positive(maximum) ? maximum : 3);
  if (change <= -3) return "#983c4b";
  if (change <= -1) return "#80434a";
  if (change < 0) return "#63434a";
  if (change === 0) return "#3d4c44";
  if (change < 1) return "#3f6147";
  if (change < 3) return "#427c48";
  return "#50954b";
}
