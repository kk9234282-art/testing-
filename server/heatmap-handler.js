import { loadDirectorySnapshot } from "./directory.js";
import { buildHeatmap } from "../shared/heatmap.js";
export function createHeatmapHandler({
  loadDirectory = loadDirectorySnapshot,
} = {}) {
  return async function heatmapHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      buildHeatmap([], req.query);
      const snapshot = await loadDirectory();
      return res.json({
        ...buildHeatmap(snapshot.stocks, req.query),
        fetchedAt: snapshot.fetchedAt,
        source: "TradingView public scanner (unofficial)",
      });
    } catch (error) {
      if (error instanceof RangeError)
        return res.status(400).json({ error: error.message });
      return res
        .status(502)
        .json({
          error:
            "Sector heatmap data is unavailable. Retry or select Sample data. No sample prices have been substituted.",
        });
    }
  };
}
export default createHeatmapHandler();
