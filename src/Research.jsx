import React, { useState, useEffect, useRef } from "react";
import {
  SlidersHorizontal,
  ArrowRightLeft,
  ChevronDown,
  X,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  FUNDAMENTALS,
  SCREEN_PRESETS,
  parseScreenFilters,
} from "../shared/fundamentals.js";

export function Screener({ applied, onApply, coverage, mode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(applied);
    setError("");
  }, [applied]);
  const count = FUNDAMENTALS.filter(
    (m) => applied[m.key + "Min"] != null || applied[m.key + "Max"] != null,
  ).length;
  function apply(event) {
    event.preventDefault();
    try {
      parseScreenFilters(draft);
      onApply(
        Object.fromEntries(
          Object.entries(draft).filter(([, v]) => v.trim() !== ""),
        ),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="screener" aria-label="Advanced stock screener">
      <button
        className="screener-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={16} />
        <b>Advanced screener</b>
        <span>
          {count
            ? `${count} active filter${count === 1 ? "" : "s"}`
            : "Valuation, growth & financial health"}
        </span>
        <ChevronDown size={15} className={open ? "rotated" : ""} />
      </button>
      {open && (
        <form className="screener-body" onSubmit={apply}>
          <div className="preset-row">
            <span>START WITH A TEMPLATE</span>
            {SCREEN_PRESETS.map((p) => (
              <button
                type="button"
                key={p.name}
                title={p.description}
                onClick={() => {
                  setDraft(p.filters);
                  setError("");
                }}
              >
                {p.name} <Plus size={12} />
              </button>
            ))}
          </div>
          <p className="research-note">
            Set any minimum or maximum. Only applied filters exclude missing
            values. Templates fill the form; press Apply to run them.{" "}
            {mode === "sample"
              ? "All financial values in sample mode are illustrative."
              : "Provider coverage varies; a blank value is never treated as zero."}
          </p>
          <div className="metric-filters">
            {FUNDAMENTALS.map((m) => (
              <fieldset key={m.key}>
                <legend title={m.help}>
                  {m.label} <span>{m.unit}</span>
                </legend>
                <small>{m.period}</small>
                <div className="range-inputs">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    aria-label={`${m.label} minimum`}
                    placeholder="Min"
                    value={draft[m.key + "Min"] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [m.key + "Min"]: e.target.value,
                      }))
                    }
                  />
                  <span>to</span>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    aria-label={`${m.label} maximum`}
                    placeholder="Max"
                    value={draft[m.key + "Max"] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [m.key + "Max"]: e.target.value,
                      }))
                    }
                  />
                </div>
                {coverage?.[m.key] === 0 && mode === "market" && (
                  <small className="coverage-warning">
                    No values available in this snapshot
                  </small>
                )}
              </fieldset>
            ))}
          </div>
          {error && (
            <p className="validation-error" role="alert">
              {error}
            </p>
          )}
          <div className="screener-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setDraft({});
                onApply({});
                setError("");
              }}
            >
              <RotateCcw size={13} />
              Reset screener
            </button>
            <span>Filters run across the full directory.</span>
            <button className="primary-button" type="submit">
              Apply filters <SlidersHorizontal size={14} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function CompareTray({ items, onRemove, onOpen, onClear }) {
  if (!items.length) return null;
  return (
    <aside className="compare-tray" aria-label="Selected stocks for comparison">
      <div className="tray-label">
        <ArrowRightLeft size={17} />
        <b>Compare</b>
        <span>{items.length}/4</span>
      </div>
      <div className="compare-chips">
        {items.map((s) => (
          <span key={s.id}>
            {s.symbol}
            <small>{s.exchange}</small>
            <button
              aria-label={`Remove ${s.symbol} from comparison`}
              onClick={() => onRemove(s.id)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <button className="clear-comparison" onClick={onClear}>
        Clear
      </button>
      <button
        className="primary-button"
        disabled={items.length < 2}
        onClick={onOpen}
      >
        {items.length < 2 ? "Select one more" : "Compare stocks"}
        <ArrowRightLeft size={14} />
      </button>
    </aside>
  );
}
const number = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
const formatCap = (n) =>
  n >= 1e12 ? `₹${number(n / 1e12)}T` : `₹${number(n / 1e7)} Cr`;
function display(value, kind = "number") {
  if (value == null || (typeof value === "number" && !Number.isFinite(value)))
    return <span className="missing-value">Not available</span>;
  if (kind === "price") return "₹" + number(value);
  if (kind === "cap") return formatCap(value);
  if (kind === "percent") return number(value) + "%";
  if (kind === "ratio") return number(value) + "×";
  return typeof value === "number" ? number(value) : value;
}
export function Comparison({
  open,
  onClose,
  items,
  onRemove,
  mode,
  samples,
  refresh,
}) {
  const ref = useRef(null);
  const [stocks, setStocks] = useState([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const ids = items.map((s) => s.id).join(",");
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) {
      setStocks([]);
      setError("");
      setLoading(false);
      return;
    }
    setError("");
    setStocks([]);
    if (mode === "sample") {
      setLoading(false);
      setStocks(samples.filter((s) => ids.split(",").includes(s.id)));
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(
          "/api/stocks?" + new URLSearchParams({ ids, pageSize: "4" }),
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.stocks))
          throw new Error(
            "Comparison data is unavailable. Close this panel and retry.",
          );
        if (!controller.signal.aborted) setStocks(data.stocks);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, ids, mode, samples, refresh]);
  const columns = items.map(
    (s) => stocks.find((stock) => stock.id === s.id) || s,
  );
  return (
    <dialog
      ref={ref}
      className="comparison-dialog"
      onCancel={onClose}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="comparison-title"
    >
      <div className="comparison-content">
        <div className="comparison-heading">
          <div>
            <div className="eyebrow">SIDE BY SIDE</div>
            <h2 id="comparison-title">
              A closer comparison<span>.</span>
            </h2>
            <p>Compare the numbers. Understand the differences.</p>
          </div>
          <button
            className="comparison-close"
            aria-label="Close comparison"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="comparison-notice">
          {mode === "sample"
            ? "Illustrative sample financials — not actual company results."
            : "Values come from the same free directory feed and may be delayed or unavailable. TTM means trailing 12 months."}{" "}
          {new Set(items.map((s) => s.exchange + ":" + s.symbol)).size !==
            new Set(items.map((s) => s.symbol)).size &&
            "You have selected dual listings of the same symbol."}
        </div>
        {loading && (
          <p className="research-loading" role="status">
            Loading comparison…
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {open && !loading && !error && (
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Company / metric</th>
                  {columns.map((s) => (
                    <th key={s.id}>
                      <button
                        className="remove-compare"
                        aria-label={`Remove ${s.symbol} from comparison`}
                        onClick={() => onRemove(s.id)}
                      >
                        <X size={13} />
                      </button>
                      <span className="compare-symbol">{s.symbol}</span>
                      <b>{s.name}</b>
                      <small>{s.exchange}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="metric-group">
                  <th colSpan={columns.length + 1}>Market overview</th>
                </tr>
                {[
                  ["Price", "price", "price"],
                  ["Market cap", "marketCap", "cap"],
                  ["Daily change", "change", "percent"],
                  ["Daily volume", "volume", "number"],
                  ["Sector", "sector", "text"],
                ].map(([label, key, kind]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    {columns.map((s) => (
                      <td key={s.id}>{display(s[key], kind)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="metric-group">
                  <th colSpan={columns.length + 1}>
                    Valuation, growth & financial health
                  </th>
                </tr>
                {FUNDAMENTALS.map((m) => (
                  <tr key={m.key}>
                    <th title={m.help}>
                      {m.label}
                      <small>{m.period}</small>
                    </th>
                    {columns.map((s) => (
                      <td key={s.id}>
                        {m.positiveOnly && s[m.key] != null && s[m.key] <= 0 ? (
                          <span className="missing-value">Not meaningful</span>
                        ) : (
                          display(
                            s[m.key],
                            m.unit === "%" ? "percent" : "ratio",
                          )
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th>
                    Snapshot fetched<small>IST · not exchange quote time</small>
                  </th>
                  {columns.map((s) => (
                    <td className="comparison-timestamp" key={s.id}>
                      {mode === "sample"
                        ? "Illustrative"
                        : s.fetchedAt
                          ? new Date(s.fetchedAt).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                            })
                          : "Not available"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="comparison-footnote">
          Compare companies in similar sectors. Ratios can be misleading for
          banks, negative equity, or loss-making businesses. No single metric
          determines a better investment. Missing values are not zero.
        </p>
      </div>
    </dialog>
  );
}
