import { exchangeLabel } from "../shared/listings.js";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  Grid2X2,
  ArrowUpRight,
  ArrowLeft,
  ChevronDown,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  List,
  Search,
} from "lucide-react";
import { buildHeatmap, layoutTreemap, heatColor } from "../shared/heatmap.js";
import { HEATMAP_PERIODS } from "../shared/periods.js";
import {
  nextHeatmapZoom,
  centredHeatmapScroll,
} from "../shared/heatmap-zoom.js";
const changeText = (value) =>
  value == null ? "Unavailable" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const capText = (value) =>
  value >= 1e12
    ? `₹${(value / 1e12).toFixed(2)}T`
    : `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
export default function Heatmap({
  mode,
  samples,
  refresh,
  onStockSelect,
  onBrowseGroup,
}) {
  const [period, setPeriod] = useState("24h");
  const periodInfo = HEATMAP_PERIODS[period];
  const tileReturn = (tile) =>
    view === "sectors" ? tile.change : tile.heatmapChange;
  const [groupBy, setGroupBy] = useState("industry");
  const [exchange, setExchange] = useState("NSE"),
    [sector, setSector] = useState(""),
    [view, setView] = useState("sectors"),
    [limit, setLimit] = useState("100");
  const [snapshot, setData] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [hovered, setHovered] = useState(null);
  const requestKey = JSON.stringify([
    mode,
    exchange,
    sector,
    groupBy,
    limit,
    period,
  ]);
  const data = snapshot?._requestKey === requestKey ? snapshot : null;
  const isBusy = loading || (!data && !error);
  const mapRef = useRef(null),
    frameRef = useRef(null),
    pendingScroll = useRef(null),
    panRef = useRef(null),
    suppressClick = useRef(false);
  const [zoom, setZoom] = useState(1),
    [dragging, setDragging] = useState(false),
    [namesOpen, setNamesOpen] = useState(false),
    [namesSearch, setNamesSearch] = useState("");
  const [size, setSize] = useState({ width: 1000, height: 400 });
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setHovered(null);
    if (mode === "sample") {
      setLoading(false);
      setError("");
      setData({
        ...buildHeatmap(samples, {
          exchange,
          group: sector,
          groupBy,
          limit,
          period,
        }),
        _requestKey: requestKey,
      });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    (async () => {
      try {
        const response = await fetch(
          "/api/heatmap?" +
            new URLSearchParams({
              exchange,
              group: sector,
              groupBy,
              limit,
              period,
            }),
          { signal: controller.signal },
        );
        const result = await response.json();
        if (
          !response.ok ||
          !Array.isArray(result.sectors) ||
          !Array.isArray(result.stocks) ||
          result.period !== period
        )
          throw new Error(result.error || "Heatmap data is unavailable.");
        if (!controller.signal.aborted)
          setData({ ...result, _requestKey: requestKey });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            "Sector heatmap is unavailable. Retry, or switch to Sample data to explore it.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [mode, samples, exchange, sector, groupBy, limit, period, refresh, retry]);
  const tiles = useMemo(
    () =>
      layoutTreemap(
        data ? (view === "sectors" ? data.sectors : data.stocks) : [],
        size.width * zoom,
        size.height * zoom,
      ),
    [data, view, size, zoom],
  );
  const changeZoom = (direction) => {
    const next = nextHeatmapZoom(zoom, direction),
      viewport = mapRef.current;
    if (next === zoom || !viewport) return;
    pendingScroll.current = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      zoom,
    };
    setZoom(next);
    setHovered(null);
  };
  const resetZoom = () => {
    pendingScroll.current = null;
    setZoom(1);
    setHovered(null);
    mapRef.current?.scrollTo(0, 0);
  };
  useLayoutEffect(() => {
    const viewport = mapRef.current,
      previous = pendingScroll.current;
    if (viewport && previous) {
      const target = centredHeatmapScroll(previous, previous.zoom, zoom, {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
      viewport.scrollTo(target.left, target.top);
      pendingScroll.current = null;
    }
  }, [zoom]);
  useEffect(() => {
    setZoom(1);
    pendingScroll.current = null;
    panRef.current = null;
    suppressClick.current = false;
    setDragging(false);
    setNamesSearch("");
    mapRef.current?.scrollTo(0, 0);
  }, [mode, exchange, groupBy, sector, view, limit]);
  const startPan = (event) => {
    suppressClick.current = false;
    if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0)
      return;
    const viewport = mapRef.current;
    panRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false,
    };
  };
  const movePan = (event) => {
    const pan = panRef.current,
      viewport = mapRef.current;
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.x,
      dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) > 4) {
      pan.moved = true;
      viewport.setPointerCapture(event.pointerId);
      setDragging(true);
      setHovered(null);
    }
    if (pan.moved) {
      event.preventDefault();
      viewport.scrollLeft = pan.left - dx;
      viewport.scrollTop = pan.top - dy;
    }
  };
  const finishPan = (event) => {
    const pan = panRef.current;
    if (!pan || pan.id !== event.pointerId) return;
    suppressClick.current = pan.moved;
    panRef.current = null;
    setDragging(false);
    if (mapRef.current?.hasPointerCapture(event.pointerId))
      mapRef.current.releasePointerCapture(event.pointerId);
  };
  const mapKeys = (event) => {
    if (event.target !== event.currentTarget || isBusy || !tiles.length) return;
    if (["+", "="].includes(event.key)) {
      event.preventDefault();
      changeZoom(1);
    } else if (["-", "_"].includes(event.key)) {
      event.preventDefault();
      changeZoom(-1);
    } else if (["0", "Home"].includes(event.key)) {
      event.preventDefault();
      resetZoom();
    } else if (
      zoom > 1 &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      mapRef.current.scrollBy(
        event.key === "ArrowLeft" ? -80 : event.key === "ArrowRight" ? 80 : 0,
        event.key === "ArrowUp" ? -80 : event.key === "ArrowDown" ? 80 : 0,
      );
    }
  };
  const nameItems = data
    ? view === "sectors"
      ? data.sectors
      : data.stocks
    : [];
  const visibleNames = nameItems.filter((item) =>
    `${item.name} ${item.symbol || ""}`
      .toLowerCase()
      .includes(namesSearch.trim().toLowerCase()),
  );
  const chooseSector = (value) => {
    setSector(value);
    setView(value ? "stocks" : "sectors");
    setHovered(null);
  };
  const activate = (tile) => {
    if (view === "sectors") chooseSector(tile.sector);
    else onStockSelect(tile);
  };
  const current = hovered || null;
  return (
    <section
      className="heatmap-section"
      id="sector-heatmap"
      aria-labelledby="heatmap-heading"
    >
      <div className="heatmap-heading">
        <div>
          <div className="eyebrow">
            <Grid2X2 size={11} /> THE MARKET AT A GLANCE
          </div>
          <h2 id="heatmap-heading">
            Find the market’s moving parts<span>.</span>
          </h2>
          <p>
            Bigger tiles, bigger market caps. Colour shows{" "}
            {periodInfo.label.toLowerCase()} performance.
          </p>
        </div>
        <span className="heatmap-source">
          {mode === "sample"
            ? "ILLUSTRATIVE SAMPLE"
            : "FREE FEED · MAY BE DELAYED"}
        </span>
      </div>
      <div
        className="heatmap-periods"
        role="group"
        aria-label="Heatmap time period"
      >
        {Object.entries(HEATMAP_PERIODS).map(([key, info]) => (
          <button
            key={key}
            aria-pressed={period === key}
            className={period === key ? "active" : ""}
            onClick={() => {
              setPeriod(key);
              setHovered(null);
            }}
          >
            {info.label}
          </button>
        ))}
      </div>
      <p className="heatmap-period-note">{periodInfo.description}</p>
      <div className="heatmap-controls">
        <label className="sector">
          <select
            aria-label="Heatmap grouping"
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value);
              setSector("");
              setView("sectors");
              setHovered(null);
            }}
          >
            <option value="industry">Detailed industries</option>
            <option value="sector">Broad sectors</option>
          </select>
          <ChevronDown size={13} />
        </label>
        <div className="heatmap-views" role="group" aria-label="Heatmap view">
          {["sectors", "stocks"].map((value) => (
            <button
              key={value}
              aria-pressed={view === value}
              className={view === value ? "active" : ""}
              onClick={() => {
                setView(value);
                setHovered(null);
              }}
            >
              {value === "sectors"
                ? groupBy === "industry"
                  ? "Industries"
                  : "Sectors"
                : "Stocks"}
            </button>
          ))}
        </div>
        <label className="sector">
          <select
            aria-label="Heatmap exchange"
            value={exchange}
            onChange={(e) => {
              setExchange(e.target.value);
              setSector("");
              setHovered(null);
            }}
          >
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
            <option value="all">NSE + BSE</option>
          </select>
          <ChevronDown size={13} />
        </label>
        <label className="sector heatmap-sector">
          <select
            aria-label="Heatmap category"
            value={sector}
            onChange={(e) => chooseSector(e.target.value)}
          >
            <option value="">
              {groupBy === "industry" ? "All industries" : "All sectors"}
            </option>
            {[
              ...new Set([
                ...(data?.availableGroups || data?.availableSectors || []),
                ...(sector ? [sector] : []),
              ]),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        {view === "stocks" && (
          <label className="sector">
            <select
              aria-label="Heatmap stock limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            >
              <option value="100">Largest 100</option>
              <option value="250">Largest 250</option>
            </select>
            <ChevronDown size={13} />
          </label>
        )}
        {sector && (
          <button className="heatmap-back" onClick={() => chooseSector("")}>
            <ArrowLeft size={13} />
            {groupBy === "industry" ? "All industries" : "All sectors"}
          </button>
        )}
        <button
          className="heatmap-refresh"
          aria-label="Refresh heatmap"
          disabled={loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>
      {sector && data?.selectedFilter && onBrowseGroup && (
        <button
          className="heatmap-browse"
          onClick={() =>
            onBrowseGroup({
              ...data.selectedFilter,
              exchange: exchange === "all" ? "" : exchange,
            })
          }
        >
          View this category in the stock table <ArrowUpRight size={13} />
        </button>
      )}
      {groupBy === "industry" && data?.unclassifiedIndustries > 0 && (
        <p className="heatmap-classification-note">
          Industry data is unavailable for{" "}
          {data.unclassifiedIndustries.toLocaleString("en-IN")} companies. These
          remain under their broad sector with an explicit label.
        </p>
      )}
      {data?.totalListings > 0 && data.missingChange === data.totalListings && (
        <p className="heatmap-classification-note" role="status">
          No {periodInfo.label.toLowerCase()} returns are available in this
          snapshot. Tiles remain grey; another period’s returns are never
          substituted.
        </p>
      )}
      <div className="heatmap-summary">
        <span>
          <b>{data?.totalListings?.toLocaleString("en-IN") ?? "—"}</b> companies
        </span>
        <span className="positive">
          <b>{data?.advances ?? "—"}</b> advancing
        </span>
        <span className="negative">
          <b>{data?.declines ?? "—"}</b> declining
        </span>
        <span>
          <b>{data?.unchanged ?? "—"}</b> unchanged
        </span>
        <span className="weighted-move">
          {periodInfo.label} cap-weighted move{" "}
          <b
            className={
              data?.change == null
                ? ""
                : data.change >= 0
                  ? "positive"
                  : "negative"
            }
          >
            {changeText(data?.change)}
          </b>
        </span>
      </div>
      {error && (
        <div role="alert" className="heatmap-error">
          {error}
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      )}
      <div className="heatmap-navigation">
        <div
          className="heatmap-zoom-controls"
          role="group"
          aria-label="Heatmap zoom controls"
        >
          <button
            aria-label="Zoom out heatmap"
            title="Zoom out"
            disabled={zoom === 1 || isBusy || !tiles.length}
            onClick={() => changeZoom(-1)}
          >
            <ZoomOut size={15} />
          </button>
          <span aria-label="Heatmap zoom level" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            aria-label="Zoom in heatmap"
            title="Zoom in"
            disabled={zoom === 8 || isBusy || !tiles.length}
            onClick={() => changeZoom(1)}
          >
            <ZoomIn size={15} />
          </button>
          <button
            aria-label="Reset heatmap zoom"
            title="Reset to fit"
            disabled={zoom === 1}
            onClick={resetZoom}
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <span className="heatmap-navigation-hint" id="heatmap-zoom-help">
          Zoom to reveal labels. Drag or swipe to pan; focus the map for + / −,
          arrow keys, and 0 to reset.
        </span>
        <button
          className="heatmap-names-toggle"
          aria-expanded={namesOpen}
          aria-controls="heatmap-name-directory"
          disabled={isBusy || !data}
          onClick={() => setNamesOpen((value) => !value)}
        >
          <List size={14} />
          Names list
        </button>
      </div>
      <div ref={frameRef} className="heatmap-frame">
        <div
          ref={mapRef}
          className={
            "heatmap-canvas" +
            (zoom > 1 ? " is-zoomed" : "") +
            (dragging ? " is-dragging" : "")
          }
          role="region"
          tabIndex={0}
          aria-describedby="heatmap-zoom-help"
          onKeyDown={mapKeys}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={finishPan}
          onPointerCancel={finishPan}
          onLostPointerCapture={finishPan}
          onClickCapture={(event) => {
            if (suppressClick.current && event.detail > 0) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
          aria-label={`${view === "sectors" ? (groupBy === "industry" ? "Industry" : "Sector") : "Stock"} market-cap heatmap`}
          aria-busy={isBusy}
        >
          {isBusy ? (
            <div className="heatmap-placeholder" role="status">
              <span className="heatmap-loading-icon">
                <Grid2X2 size={25} />
              </span>
              Building the market picture…
            </div>
          ) : error ? (
            <div className="heatmap-placeholder">
              <Grid2X2 size={25} />
              <b>No heatmap loaded</b>
              <span>Use Retry above to request the directory again.</span>
            </div>
          ) : tiles.length ? (
            <div
              className="heatmap-surface"
              style={{ width: size.width * zoom, height: size.height * zoom }}
            >
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  className="heatmap-tile"
                  style={{
                    left: tile.x,
                    top: tile.y,
                    width: Math.max(0, tile.width - 2),
                    height: Math.max(0, tile.height - 2),
                    backgroundColor: heatColor(
                      tileReturn(tile),
                      periodInfo.colorMax,
                    ),
                  }}
                  title={`${tile.name}${view === "stocks" ? " · " + tile.symbol : ""} · ${changeText(tileReturn(tile))} · ${capText(tile.marketCap)}`}
                  aria-label={`${view === "sectors" ? tile.name : tile.symbol + " — " + tile.name}, ${changeText(tileReturn(tile))}, ${capText(tile.marketCap)}. ${view === "sectors" ? (groupBy === "industry" ? "Explore industry" : "Explore sector") : "Open stock details"}`}
                  onMouseEnter={() => setHovered(tile)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(tile)}
                  onBlur={() => setHovered(null)}
                  onClick={() => activate(tile)}
                >
                  {tile.width > 70 && tile.height > 42 ? (
                    <>
                      <b
                        className={
                          tile.width > 170 && tile.height > 100
                            ? "large-label"
                            : ""
                        }
                      >
                        {view === "sectors" ? tile.name : tile.symbol}
                      </b>
                      <span>{changeText(tileReturn(tile))}</span>
                      {tile.width > 140 && tile.height > 100 && (
                        <small>
                          {view === "sectors"
                            ? `${tile.count} companies · ${capText(tile.marketCap)}`
                            : `${exchangeLabel(tile)} · ${capText(tile.marketCap)}`}
                        </small>
                      )}
                    </>
                  ) : tile.width > 37 && tile.height > 24 ? (
                    <span className="tiny-change">
                      {tileReturn(tile) == null
                        ? "—"
                        : changeText(tileReturn(tile))}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            !error && (
              <div className="heatmap-placeholder">
                <Grid2X2 size={25} />
                <b>No market-cap tiles available</b>
                <span>
                  {data?.totalListings
                    ? "These listings have no usable market caps."
                    : "No companies match this exchange and sector."}
                </span>
              </div>
            )
          )}
        </div>
      </div>
      <div className="heatmap-inspector" aria-live="polite">
        {current ? (
          <>
            <b>
              {view === "sectors"
                ? current.name
                : current.name + " · " + exchangeLabel(current)}
            </b>
            <span
              style={{
                color:
                  tileReturn(current) == null
                    ? "#a7b2c1"
                    : tileReturn(current) >= 0
                      ? "#b5e987"
                      : "#f7a5aa",
              }}
            >
              {changeText(tileReturn(current))}
            </span>
            <span>{capText(current.marketCap)}</span>
            <small>
              {view === "sectors"
                ? `${current.count} companies · ${Math.round((current.changeCoverage ?? 0) * 100)}% of known cap has ${periodInfo.label.toLowerCase()} returns`
                : "Click to open stock details"}
            </small>
          </>
        ) : (
          <>
            <Grid2X2 size={13} />
            <span>
              {view === "sectors"
                ? `Select ${groupBy === "industry" ? "an industry" : "a sector"} tile to explore its stocks.`
                : "Select a stock tile to see its details."}{" "}
              Hover or focus a tile for more information.
            </span>
          </>
        )}
      </div>
      <div className="heatmap-bottom">
        <div
          className="heatmap-legend"
          aria-label={`${periodInfo.label} return colour scale`}
        >
          <span>−{periodInfo.colorMax}% or less</span>
          {[-1, -1 / 3, -1 / 6, 0, 1 / 6, 1 / 3, 1]
            .map((ratio) => ratio * periodInfo.colorMax)
            .map((value) => (
              <i
                key={value}
                style={{
                  backgroundColor: heatColor(value, periodInfo.colorMax),
                }}
                title={changeText(value)}
              />
            ))}
          <span>+{periodInfo.colorMax}% or more</span>
          <i style={{ backgroundColor: heatColor(null) }} />
          <span>No return data</span>
        </div>
        <span>
          {view === "sectors"
            ? `${data?.sectors?.filter((s) => s.marketCap > 0).length ?? 0} ${groupBy === "industry" ? "industries" : "sectors"}`
            : `${data?.shownListings ?? 0} of ${data?.eligibleListings ?? 0} companies with market caps shown`}
        </span>
      </div>
      {data && !loading && !error && (
        <details
          className="heatmap-directory"
          id="heatmap-name-directory"
          open={namesOpen}
          onToggle={(event) => setNamesOpen(event.currentTarget.open)}
        >
          <summary>
            {view === "sectors"
              ? `Browse all ${data.sectors.length} ${groupBy === "industry" ? "industry" : "sector"} categories — including small and unweighted groups`
              : `Browse all ${data.stocks.length} displayed stock names`}
          </summary>
          <label className="heatmap-names-search">
            <Search size={14} />
            <input
              aria-label="Search heatmap names"
              placeholder="Find a name or symbol…"
              value={namesSearch}
              onChange={(event) => setNamesSearch(event.target.value)}
            />
          </label>
          <div className="heatmap-category-grid">
            {visibleNames.map((group) => (
              <button key={group.id} onClick={() => activate(group)}>
                <b>{group.name}</b>
                <span>
                  {view === "sectors"
                    ? `${group.count} companies`
                    : `${group.symbol} · ${exchangeLabel(group)}`}
                </span>
                <span>
                  {group.marketCap > 0
                    ? capText(group.marketCap)
                    : "Market cap unavailable"}
                </span>
                <strong
                  className={
                    tileReturn(group) == null
                      ? "muted"
                      : tileReturn(group) >= 0
                        ? "positive"
                        : "negative"
                  }
                >
                  {changeText(tileReturn(group))}
                </strong>
              </button>
            ))}
          </div>
          {!visibleNames.length && (
            <p className="heatmap-names-empty">
              No matching names in this heatmap.
            </p>
          )}
        </details>
      )}
      <p className="heatmap-method">
        {periodInfo.label} sector moves are weighted by current known market
        caps and exclude missing returns for the selected period.
        {data
          ? ` ${data.excludedListings} companies lack positive market caps and cannot form tiles; ${data.missingChange} lack ${periodInfo.label.toLowerCase()} returns.`
          : ""}{" "}
        {exchange === "all"
          ? "Matched dual listings count once; NSE quotes are preferred. "
          : ""}
        {mode === "sample"
          ? "All displayed values are illustrative."
          : data?.fetchedAt
            ? `Snapshot fetched ${new Date(data.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST; this is not the exchange quote time.`
            : ""}{" "}
        Heatmap filters apply to this view.
      </p>
    </section>
  );
}
