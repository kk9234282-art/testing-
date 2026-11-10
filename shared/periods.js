export const HEATMAP_PERIODS = {
  "24h": {
    label: "24 hours",
    key: "change",
    field: "change",
    colorMax: 3,
    description:
      "Daily change from the previous trading close, not a rolling 24-hour return. Markets can be closed.",
  },
  "1w": {
    label: "1 week",
    key: "changeWeek",
    field: "Perf.W",
    colorMax: 5,
    description:
      "The provider’s weekly performance return, based on its trading-session lookback.",
  },
  "1m": {
    label: "1 month",
    key: "changeMonth",
    field: "Perf.1M",
    colorMax: 10,
    description:
      "The provider’s monthly performance return, based on its trading-session lookback.",
  },
};
export function heatmapPeriod(value = "24h") {
  if (typeof value !== "string" || !Object.hasOwn(HEATMAP_PERIODS, value))
    throw new RangeError("Choose 24 hours, 1 week, or 1 month.");
  return HEATMAP_PERIODS[value];
}
