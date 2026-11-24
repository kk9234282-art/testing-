import {
  SUMMARY_REFRESH_MS,
  shouldRefreshSummary,
} from "../shared/market-hours.js";
import React, { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react";
import { INDEX_DEFINITIONS, marketBreadth } from "../shared/market-summary.js";
const number = (value) =>
  value == null
    ? "—"
    : value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const percent = (value) =>
  value == null
    ? "Return unavailable"
    : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const timestamp = (value) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " IST"
    : "Time unavailable";
};
const sampleIndices = INDEX_DEFINITIONS.map((item, i) => ({
  ...item,
  price: [25356.5, 82890.94, 52045.2][i],
  change: [0.84, 0.79, 1.12][i],
  status: "available",
  history: [],
}));
function useSummary(path, mode, refresh) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: false,
  });
  useEffect(() => {
    if (mode !== "market") {
      setState({ data: null, loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    let lastAttempt = 0;
    const load = async () => {
      lastAttempt = Date.now();
      setState({ data: null, loading: true, error: false });
      try {
        const response = await fetch(path, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error("Unavailable");
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: true });
      }
    };
    load();
    const timer = setInterval(
      () => {
        if (shouldRefreshSummary(Date.now(), lastAttempt)) load();
      },
      Math.min(60000, SUMMARY_REFRESH_MS),
    );
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [path, mode, refresh]);
  return state;
}
function IndexLine({ history, up }) {
  const prices =
    history?.map((item) => item.price).filter(Number.isFinite) ?? [];
  if (prices.length < 2) return null;
  const min = Math.min(...prices),
    range = Math.max(...prices) - min || 1;
  const points = prices
    .map(
      (price, i) =>
        `${(i / (prices.length - 1)) * 100},${34 - ((price - min) / range) * 30}`,
    )
    .join(" ");
  return (
    <svg
      className="spark"
      viewBox="0 0 100 38"
      aria-label="Intraday index price chart"
      role="img"
    >
      <polyline
        points={points}
        fill="none"
        stroke={up ? "#afe669" : "#f48390"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
export default function MarketSummary({ mode, samples, refresh }) {
  const [retry, setRetry] = useState(0);
  const key = `${refresh}:${retry}`;
  const indexState = useSummary("/api/indices", mode, key);
  const breadthState = useSummary("/api/breadth", mode, key);
  const sample = mode === "sample";
  const indices = sample ? sampleIndices : indexState.data?.indices;
  const breadth = sample ? marketBreadth(samples) : breadthState.data;
  const total = breadth
    ? breadth.advances +
      breadth.declines +
      breadth.unchanged +
      breadth.unavailable
    : 0;
  return (
    <>
      <section className="market-cards" aria-label="Market summary">
        {INDEX_DEFINITIONS.map((definition) => {
          const item = indices?.find(
            (index) => index.symbol === definition.symbol,
          );
          const available =
            item?.status === "available" && Number.isFinite(item.price);
          const loading = !sample && indexState.loading;
          const up = item?.change >= 0;
          const Direction = up ? ArrowUpRight : ArrowDownRight;
          return (
            <article
              className="index-card"
              key={definition.symbol}
              aria-label={definition.name}
              aria-busy={loading}
            >
              <div className="card-label">
                {definition.name}
                <span className="sample-tag">
                  {sample
                    ? "ILLUSTRATIVE"
                    : loading
                      ? "LOADING"
                      : available
                        ? "MAY BE DELAYED"
                        : "UNAVAILABLE"}
                </span>
              </div>
              <div className="index-bottom">
                <div>
                  <h2>{available ? number(item.price) : "—"}</h2>
                  <span
                    className={
                      item?.change == null
                        ? "muted"
                        : up
                          ? "positive"
                          : "negative"
                    }
                  >
                    {available && item.change != null && (
                      <Direction size={14} />
                    )}{" "}
                    {available
                      ? percent(item.change)
                      : loading
                        ? "Loading…"
                        : "Data unavailable"}
                  </span>
                </div>
                {available && <IndexLine history={item.history} up={up} />}
              </div>
              <div className="summary-meta">
                {sample
                  ? "Sample values"
                  : available
                    ? `Quote: ${timestamp(item.asOf)}`
                    : "No sample values substituted"}
              </div>
              {available && !sample && (
                <div className="summary-meta">
                  Change vs previous close · Yahoo Finance
                </div>
              )}
            </article>
          );
        })}
        <article
          className="breadth"
          aria-label="Market breadth"
          aria-busy={!sample && breadthState.loading}
        >
          <div className="card-label">
            MARKET BREADTH
            <span className="sample-tag">
              {sample
                ? "SAMPLE"
                : breadth
                  ? "DIRECTORY SNAPSHOT"
                  : breadthState.loading
                    ? "LOADING"
                    : "UNAVAILABLE"}
            </span>
          </div>
          <div className="breadth-numbers">
            <span>
              {breadth ? breadth.advances.toLocaleString("en-IN") : "—"}
              <small>Advances</small>
            </span>
            <span>
              {breadth ? breadth.declines.toLocaleString("en-IN") : "—"}
              <small>Declines</small>
            </span>
          </div>
          {total > 0 && (
            <div
              className="breadth-bar"
              aria-label={`${breadth.advances} advances, ${breadth.declines} declines, ${breadth.unchanged} unchanged, ${breadth.unavailable} unavailable`}
            >
              <i style={{ width: `${(breadth.advances / total) * 100}%` }} />
              <i style={{ width: `${(breadth.declines / total) * 100}%` }} />
              <i
                style={{
                  width: `${(breadth.unchanged / total) * 100}%`,
                  background: "#929aaa",
                }}
              />
              <i
                style={{
                  width: `${(breadth.unavailable / total) * 100}%`,
                  background: "#47515e",
                }}
              />
            </div>
          )}
          <div className="summary-meta">
            {breadth
              ? `${breadth.unchanged.toLocaleString("en-IN")} unchanged · ${breadth.unavailable.toLocaleString("en-IN")} unavailable`
              : breadthState.loading
                ? "Loading directory…"
                : "Breadth unavailable"}
          </div>
          <div className="summary-meta">
            {sample
              ? "Sample companies only"
              : breadth
                ? `NSE + BSE · ${breadth.total.toLocaleString("en-IN")} companies · counted once`
                : "No sample values substituted"}
          </div>
          {breadth && !sample && (
            <div className="summary-meta">
              Snapshot fetched: {timestamp(breadth.fetchedAt)} · May be delayed
            </div>
          )}
        </article>
      </section>
      {!sample && (
        <div className="summary-controls">
          <span>
            Auto-refresh: every 15 minutes, Mon–Fri 9:15 AM–3:30 PM IST. Paused
            outside regular hours; holidays and special sessions are not
            tracked. Indices: Yahoo Finance (unofficial). Breadth: full cached
            directory, independent of table filters.
          </span>
          <button
            onClick={() => setRetry((value) => value + 1)}
            disabled={indexState.loading || breadthState.loading}
            aria-label="Refresh market summary"
          >
            <RefreshCw size={12} /> Refresh summary
          </button>
        </div>
      )}
    </>
  );
}
