import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Grid2X2,
  ArrowUpRight,
  ArrowLeft,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { buildHeatmap, layoutTreemap, heatColor } from "../shared/heatmap.js";
const changeText = (value) =>
  value == null ? "Unavailable" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const capText = (value) =>
  value >= 1e12
    ? `₹${(value / 1e12).toFixed(2)}T`
    : `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
export default function Heatmap({ mode, samples, refresh, onStockSelect }) {
  const [exchange, setExchange] = useState("NSE"),
    [sector, setSector] = useState(""),
    [view, setView] = useState("sectors"),
    [limit, setLimit] = useState("100");
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [hovered, setHovered] = useState(null);
  const mapRef = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 400 });
  useEffect(() => {
    const element = mapRef.current;
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
      setData(buildHeatmap(samples, { exchange, sector, limit }));
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    (async () => {
      try {
        const response = await fetch(
          "/api/heatmap?" + new URLSearchParams({ exchange, sector, limit }),
          { signal: controller.signal },
        );
        const result = await response.json();
        if (
          !response.ok ||
          !Array.isArray(result.sectors) ||
          !Array.isArray(result.stocks)
        )
          throw new Error(result.error || "Heatmap data is unavailable.");
        if (!controller.signal.aborted) setData(result);
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
  }, [mode, samples, exchange, sector, limit, refresh, retry]);
  const tiles = useMemo(
    () =>
      layoutTreemap(
        data ? (view === "sectors" ? data.sectors : data.stocks) : [],
        size.width,
        size.height,
      ),
    [data, view, size],
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
          <p>Bigger tiles, bigger market caps. Colour shows daily change.</p>
        </div>
        <span className="heatmap-source">
          {mode === "sample"
            ? "ILLUSTRATIVE SAMPLE"
            : "FREE FEED · MAY BE DELAYED"}
        </span>
      </div>
      <div className="heatmap-controls">
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
              {value === "sectors" ? "Sectors" : "Stocks"}
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
            aria-label="Heatmap sector"
            value={sector}
            onChange={(e) => chooseSector(e.target.value)}
          >
            <option value="">All sectors</option>
            {[
              ...new Set([
                ...(data?.availableSectors || []),
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
            All sectors
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
      <div className="heatmap-summary">
        <span>
          <b>{data?.totalListings?.toLocaleString("en-IN") ?? "—"}</b> listings
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
          Cap-weighted move{" "}
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
      <div
        ref={mapRef}
        className="heatmap-canvas"
        aria-label={`${view === "sectors" ? "Sector" : "Stock"} market-cap heatmap`}
        aria-busy={loading}
      >
        {loading ? (
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
          tiles.map((tile) => (
            <button
              key={tile.id}
              className="heatmap-tile"
              style={{
                left: tile.x,
                top: tile.y,
                width: Math.max(0, tile.width - 2),
                height: Math.max(0, tile.height - 2),
                backgroundColor: heatColor(tile.change),
              }}
              aria-label={`${view === "sectors" ? tile.name : tile.symbol}, ${changeText(tile.change)}, ${capText(tile.marketCap)}. ${view === "sectors" ? "Explore sector" : "Open stock details"}`}
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
                      tile.width > 170 && tile.height > 100 ? "large-label" : ""
                    }
                  >
                    {view === "sectors" ? tile.name : tile.symbol}
                  </b>
                  <span>{changeText(tile.change)}</span>
                  {tile.width > 140 && tile.height > 100 && (
                    <small>
                      {view === "sectors"
                        ? `${tile.count} listings · ${capText(tile.marketCap)}`
                        : `${tile.exchange} · ${capText(tile.marketCap)}`}
                    </small>
                  )}
                </>
              ) : tile.width > 37 && tile.height > 24 ? (
                <span className="tiny-change">
                  {tile.change == null ? "—" : changeText(tile.change)}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          !error && (
            <div className="heatmap-placeholder">
              <Grid2X2 size={25} />
              <b>No market-cap tiles available</b>
              <span>
                {data?.totalListings
                  ? "These listings have no usable market caps."
                  : "No listings match this exchange and sector."}
              </span>
            </div>
          )
        )}
      </div>
      <div className="heatmap-inspector" aria-live="polite">
        {current ? (
          <>
            <b>
              {view === "sectors"
                ? current.name
                : current.name + " · " + current.exchange}
            </b>
            <span
              style={{
                color:
                  current.change == null
                    ? "#a7b2c1"
                    : current.change >= 0
                      ? "#b5e987"
                      : "#f7a5aa",
              }}
            >
              {changeText(current.change)}
            </span>
            <span>{capText(current.marketCap)}</span>
            <small>
              {view === "sectors"
                ? `${current.count} listings · ${Math.round((current.changeCoverage ?? 0) * 100)}% of known cap has daily changes`
                : "Click to open stock details"}
            </small>
          </>
        ) : (
          <>
            <Grid2X2 size={13} />
            <span>
              {view === "sectors"
                ? "Select a sector tile to explore its stocks."
                : "Select a stock tile to see its details."}{" "}
              Hover or focus a tile for more information.
            </span>
          </>
        )}
      </div>
      <div className="heatmap-bottom">
        <div className="heatmap-legend" aria-label="Daily change colour scale">
          <span>−3% or less</span>
          {[-3, -1, -0.5, 0, 0.5, 1, 3].map((value) => (
            <i
              key={value}
              style={{ backgroundColor: heatColor(value) }}
              title={changeText(value)}
            />
          ))}
          <span>+3% or more</span>
          <i style={{ backgroundColor: heatColor(null) }} />
          <span>No change data</span>
        </div>
        <span>
          {view === "sectors"
            ? `${data?.sectors?.filter((s) => s.marketCap > 0).length ?? 0} sectors`
            : `${data?.shownListings ?? 0} of ${data?.eligibleListings ?? 0} listings with market caps shown`}
        </span>
      </div>
      <p className="heatmap-method">
        Sector moves are weighted by known market caps and exclude missing daily
        changes.
        {data
          ? ` ${data.excludedListings} listings lack positive market caps and cannot form tiles; ${data.missingChange} lack daily changes.`
          : ""}{" "}
        {exchange === "all" ? "Dual listings count separately. " : ""}
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
