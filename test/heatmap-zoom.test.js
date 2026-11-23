import test from "node:test";
import assert from "node:assert/strict";
import {
  nextHeatmapZoom,
  centredHeatmapScroll,
  HEATMAP_ZOOM_LEVELS,
} from "../shared/heatmap-zoom.js";
test("zoom steps stay bounded and are reversible", () => {
  for (let i = 0; i < HEATMAP_ZOOM_LEVELS.length; i++) {
    const value = HEATMAP_ZOOM_LEVELS[i];
    assert.equal(
      nextHeatmapZoom(value, 1),
      HEATMAP_ZOOM_LEVELS[Math.min(i + 1, 6)],
    );
    assert.equal(
      nextHeatmapZoom(value, -1),
      HEATMAP_ZOOM_LEVELS[Math.max(i - 1, 0)],
    );
  }
});
test("zoom preserves the viewport centre including scrollbar changes", () => {
  assert.deepEqual(
    centredHeatmapScroll(
      { left: 100, top: 50, width: 800, height: 400 },
      1,
      2,
      { width: 785, height: 385 },
    ),
    { left: 607.5, top: 307.5 },
  );
  assert.deepEqual(
    centredHeatmapScroll({ left: 0, top: 0, width: 800, height: 400 }, 2, 1, {
      width: 800,
      height: 400,
    }),
    { left: 0, top: 0 },
  );
});
