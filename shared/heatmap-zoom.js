export const HEATMAP_ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8];
export function nextHeatmapZoom(current, direction) {
  const values =
    direction > 0 ? HEATMAP_ZOOM_LEVELS : HEATMAP_ZOOM_LEVELS.slice().reverse();
  return (
    values.find((value) =>
      direction > 0 ? value > current : value < current,
    ) ?? (direction > 0 ? 8 : 1)
  );
}
// Preserve the logical point in the centre, accounting for appearing scrollbars.
export function centredHeatmapScroll(previous, fromZoom, toZoom, viewport) {
  return {
    left: Math.max(
      0,
      ((previous.left + previous.width / 2) * toZoom) / fromZoom -
        viewport.width / 2,
    ),
    top: Math.max(
      0,
      ((previous.top + previous.height / 2) * toZoom) / fromZoom -
        viewport.height / 2,
    ),
  };
}
