import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronRight,
  Star,
  ArrowUpDown,
  X,
  Menu,
  TrendingUp,
  Globe,
  Command,
  Sun,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { listings } from "../server/market.js";
import { filterDirectory, CAP_RANGES } from "../server/directory.js";
import "./style.css";
const money = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(n);
const capMoney = (n) =>
  n == null
    ? "—"
    : n >= 1e12
      ? `₹${(n / 1e12).toFixed(2)}T`
      : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n / 1e7)} Cr`;
const pct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
function points(seed, up = true) {
  let v = 50;
  return Array.from({ length: 32 }, (_, i) => {
    v +=
      Math.sin(i * 1.9 + seed) * 9 +
      Math.cos(i * 0.6 + seed) * 5 +
      (up ? -1 : 1);
    return v;
  });
}
function Spark({ seed = 0, up = true, values, large = false }) {
  const data = values?.length > 1 ? values : points(seed, up);
  const min = Math.min(...data),
    max = Math.max(...data);
  const path = data
    .map(
      (n, i) =>
        `${(i * 160) / (data.length - 1)},${48 - ((n - min) / (max - min || 1)) * 40}`,
    )
    .join(" ");
  return (
    <svg
      className={large ? "spark large" : "spark"}
      viewBox="0 0 160 56"
      preserveAspectRatio="none"
    >
      <polyline
        points={path}
        fill="none"
        stroke={up ? "#a9e858" : "#f47d89"}
        strokeWidth={large ? "1.1" : "1.5"}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
const samples = listings.map((s) => ({
  ...s,
  id: `NSE:${s.symbol}`,
  exchange: "NSE",
  marketCap: s.cap * 1e12,
  volume: s.volume * 1e6,
}));
function App() {
  const [tab, setTab] = useState("All stocks"),
    [search, setSearch] = useState(""),
    [debouncedSearch, setDebouncedSearch] = useState("");
  const [sector, setSector] = useState(""),
    [exchange, setExchange] = useState(""),
    [category, setCategory] = useState("");
  const [sort, setSort] = useState("marketCap"),
    [direction, setDirection] = useState("desc"),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25);
  const [mode, setMode] = useState("market"),
    [directory, setDirectory] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(null),
    [chart, setChart] = useState(null),
    [chartLoading, setChartLoading] = useState(false),
    [chartError, setChartError] = useState("");
  const [menu, setMenu] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [watch, setWatch] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tickr-watch"));
      return Array.isArray(saved)
        ? saved.filter((s) => typeof s === "string")
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("tickr-watch", JSON.stringify(watch));
    } catch {}
  }, [watch]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = useMemo(
    () =>
      new URLSearchParams({
        search: debouncedSearch,
        sector,
        exchange,
        category,
        sort,
        direction,
        page: String(page),
        pageSize: String(pageSize),
        tab,
        watch: tab === "Watchlist" ? watch.join(",") : "",
      }),
    [
      debouncedSearch,
      sector,
      exchange,
      category,
      sort,
      direction,
      page,
      pageSize,
      tab,
      watch,
    ],
  );
  const query = params.toString();
  useEffect(() => {
    if (mode !== "market") {
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDirectory(null);
    (async () => {
      try {
        const response = await fetch(`/api/stocks?${query}`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => {
          throw new Error(
            "The market API is not available. Redeploy the latest GitHub code on Vercel.",
          );
        });
        if (!response.ok)
          throw new Error(data.error || "Market directory is unavailable.");
        if (
          !Array.isArray(data.stocks) ||
          !Number.isInteger(data.total) ||
          !Number.isInteger(data.pages)
        )
          throw new Error("Invalid directory response.");
        if (!controller.signal.aborted) setDirectory(data);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [mode, query, refresh]);
  const data =
    mode === "sample"
      ? filterDirectory(samples, Object.fromEntries(params))
      : directory;
  const rows = (data?.stocks || []).map((s) => ({
    ...s,
    cap: s.marketCap == null ? null : s.marketCap / 1e12,
    volume: s.volume == null ? null : s.volume / 1e6,
  }));
  const sectors = data?.sectors || [];
  const categories =
    data?.categories ||
    Object.entries(CAP_RANGES).map(([id, { label }]) => ({ id, label }));
  const updateFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };
  const changeSort = (key) => {
    if (sort === key) setDirection((v) => (v === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDirection("desc");
    }
    setPage(1);
  };
  const isWatched = (s) => watch.includes(s.id) || watch.includes(s.symbol);
  const toggle = (s) =>
    setWatch((w) =>
      isWatched(s)
        ? w.filter((x) => x !== s.id && x !== s.symbol)
        : [...w, s.id],
    );
  useEffect(() => {
    setChart(null);
    setChartError("");
    setChartLoading(false);
    if (mode !== "market" || !selected?.id) return;
    const controller = new AbortController();
    setChartLoading(true);
    (async () => {
      try {
        const response = await fetch(
          `/api/quote/${encodeURIComponent(selected.id)}`,
          { signal: controller.signal },
        );
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Chart unavailable");
        if (!controller.signal.aborted) setChart(value);
      } catch (e) {
        if (!controller.signal.aborted)
          setChartError("Price history is unavailable from the free provider.");
      } finally {
        if (!controller.signal.aborted) setChartLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selected?.id, mode]);
  const detail = selected && selected !== "about" ? selected : null;
  return (
    <>
      <div className="ticker">
        <div>
          <span className="status-dot" /> INDIAN MARKETS{" "}
          <span className="muted">/</span>{" "}
          {mode === "sample" ? "SAMPLE SNAPSHOT" : "FREE DATA · MAY BE DELAYED"}
        </div>
        <span>
          Built for the curious investor <ArrowUpRight size={12} />
        </span>
      </div>
      <header>
        <a className="brand" href="#">
          <span className="brand-icon">
            <TrendingUp size={24} />
          </span>
          tickr<span className="brand-period">.</span>
        </a>
        <nav className={menu ? "open" : ""}>
          {["Markets", "Watchlist", "About"].map((n) => (
            <button
              key={n}
              className={
                (n === "Markets" && tab !== "Watchlist") || n === tab
                  ? "nav-active"
                  : ""
              }
              onClick={() => {
                if (n === "About") setSelected("about");
                else updateFilter(setTab, n === "Markets" ? "All stocks" : n);
                setMenu(false);
              }}
            >
              {n}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="india">
            🇮🇳 <b>India</b>
            <ChevronDown size={13} />
          </span>
          <span className="avatar">K</span>
          <button
            className="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
        </div>
      </header>
      <main>
        <div className="intro">
          <div className="eyebrow">
            <span /> THE BIG PICTURE
          </div>
          <div className="title-row">
            <div>
              <h1>
                Indian markets, in focus<span>.</span>
              </h1>
              <p>
                Your daily pulse on stocks, sectors, and everything in between.
              </p>
            </div>
            <label className="mode-select">
              <Globe size={15} />
              <select
                aria-label="Data source"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setPage(1);
                  setSelected(null);
                }}
              >
                <option value="sample">Sample data</option>
                <option value="market">Free market data</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </div>
        <div className="notice">
          <span className="status-dot" />
          {mode === "sample"
            ? "You’re exploring sample data. Prices, charts, and market summaries are illustrative, not current quotes."
            : "NSE & BSE directory from TradingView’s public scanner. Prices may be delayed. Dual listings appear separately; directory refreshes every 15 minutes."}
          {mode === "market" && (
            <button onClick={() => setRefresh((v) => v + 1)} disabled={loading}>
              <RefreshCw size={13} className={loading ? "spin" : ""} />
              Refresh
            </button>
          )}
        </div>
        <section className="market-cards">
          {[
            ["NIFTY 50", "25,356.50", "+0.84%", 0],
            ["SENSEX", "82,890.94", "+0.79%", 3],
            ["NIFTY BANK", "52,045.20", "+1.12%", 6],
          ].map(([name, price, change, seed]) => (
            <article className="index-card" key={name}>
              <div className="card-label">
                {name}
                <span className="sample-tag">ILLUSTRATIVE</span>
              </div>
              <div className="index-bottom">
                <div>
                  <h2>{price}</h2>
                  <span className="positive">
                    <ArrowUpRight size={14} />
                    {change}
                    <span className="muted"> today</span>
                  </span>
                </div>
                <Spark seed={seed} />
              </div>
            </article>
          ))}
          <article className="breadth">
            <div className="card-label">
              MARKET BREADTH <span className="sample-tag">SAMPLE</span>
            </div>
            <div className="breadth-numbers">
              <span>
                1,482 <small>Advances</small>
              </span>
              <span>
                876 <small>Declines</small>
              </span>
            </div>
            <div className="breadth-bar">
              <i />
              <i />
            </div>
          </article>
        </section>
        <section className="stocks">
          <div className="section-title">
            <div>
              <h2>
                Explore the market{" "}
                <span>
                  {data?.universeTotal?.toLocaleString("en-IN") ?? "—"}
                </span>
              </h2>
              <p>NSE & BSE stocks. Find your sector, compare market caps.</p>
            </div>
            <span className="currency">
              Prices in <b>INR ₹</b>
            </span>
          </div>
          <div className="toolbar">
            <div className="tabs">
              {["All stocks", "Gainers", "Losers", "Watchlist"].map((t) => (
                <button
                  key={t}
                  onClick={() => updateFilter(setTab, t)}
                  className={tab === t ? "active" : ""}
                >
                  {t === "Watchlist" && <Star size={13} />}
                  {t}
                  {t === "Watchlist" && watch.length > 0 && (
                    <small>{watch.length}</small>
                  )}
                </button>
              ))}
            </div>
            <div className="filters">
              <div className="search">
                <Search size={15} />
                <input
                  aria-label="Search stocks"
                  placeholder="Search stocks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>⌕</kbd>
              </div>
              <label className="sector">
                <select
                  aria-label="Filter sector"
                  value={sector}
                  onChange={(e) => updateFilter(setSector, e.target.value)}
                >
                  <option value="">All sectors</option>
                  {[...new Set([...sectors, ...(sector ? [sector] : [])])].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </div>
          <div className="category-bar">
            <label className="sector">
              <select
                aria-label="Filter exchange"
                value={exchange}
                onChange={(e) => updateFilter(setExchange, e.target.value)}
              >
                <option value="">NSE + BSE</option>
                <option>NSE</option>
                <option>BSE</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="sector">
              <select
                aria-label="Market cap category"
                value={category}
                onChange={(e) => updateFilter(setCategory, e.target.value)}
              >
                <option value="">All market caps</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <label className="sector">
              <select
                aria-label="Sort stocks"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
              >
                <option value="marketCap">Market cap</option>
                <option value="price">Price</option>
                <option value="change">Daily change</option>
                <option value="volume">Volume</option>
                <option value="name">Company name</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <button
              className="sort-direction"
              onClick={() => {
                setDirection((d) => (d === "desc" ? "asc" : "desc"));
                setPage(1);
              }}
            >
              <ArrowUpDown size={13} />
              {direction === "desc" ? "High to low" : "Low to high"}
            </button>
            {(sector || exchange || category || search) && (
              <button
                className="reset-filters"
                onClick={() => {
                  setSector("");
                  setExchange("");
                  setCategory("");
                  setSearch("");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
            <span className="cap-help">
              Market caps in INR · missing values last
            </span>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>#</th>
                  <th>Company</th>
                  <th>
                    <button
                      aria-label="Sort by price"
                      onClick={() => changeSort("price")}
                    >
                      Price <ArrowUpDown size={11} />
                    </button>
                  </th>
                  <th>
                    <button
                      aria-label="Sort by daily change"
                      onClick={() => changeSort("change")}
                    >
                      Daily % <ArrowUpDown size={11} />
                    </button>
                  </th>
                  <th>
                    <button
                      aria-label="Sort by market cap"
                      onClick={() => changeSort("marketCap")}
                    >
                      Market cap <ChevronDown size={12} />
                    </button>
                  </th>
                  <th>Daily volume</th>
                  <th>Sector</th>
                  <th>Price history</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        className={"star " + (isWatched(s) ? "saved" : "")}
                        aria-label={`${isWatched(s) ? "Remove" : "Add"} ${s.name} ${isWatched(s) ? "from" : "to"} watchlist`}
                        onClick={() => toggle(s)}
                      >
                        <Star
                          size={15}
                          fill={isWatched(s) ? "currentColor" : "none"}
                        />
                      </button>
                    </td>
                    <td className="rank">
                      {((data?.page || 1) - 1) * (data?.pageSize || pageSize) +
                        i +
                        1}
                    </td>
                    <td>
                      <button
                        className="company"
                        onClick={() => setSelected(s)}
                      >
                        <span className={"logo logo-" + (i % 12)}>
                          {s.logo}
                        </span>
                        <span>
                          <b>{s.name}</b>
                          <small>
                            {s.symbol} · {s.exchange}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td className="price">
                      {s.price == null ? "—" : "₹" + money(s.price)}
                    </td>
                    <td>
                      <span className={s.change >= 0 ? "positive" : "negative"}>
                        {s.change != null &&
                          (s.change >= 0 ? (
                            <ArrowUpRight size={12} />
                          ) : (
                            <ArrowDownRight size={12} />
                          ))}
                        {pct(s.change)}
                      </span>
                    </td>
                    <td>{capMoney(s.marketCap)}</td>
                    <td className="muted">
                      {s.volume == null ? "—" : `${s.volume.toFixed(2)}M`}
                    </td>
                    <td>
                      <span className="sector-pill">{s.sector}</span>
                    </td>
                    <td>
                      {mode === "sample" ? (
                        <Spark seed={i * 3} up={s.change >= 0} />
                      ) : (
                        <button
                          className="chart-link"
                          onClick={() => setSelected(s)}
                        >
                          View chart <ArrowUpRight size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && !loading && !error && (
              <div className="empty">
                <Search size={26} />
                <h3>
                  {tab === "Watchlist"
                    ? "Your watchlist starts here"
                    : "No stocks found"}
                </h3>
                <p>
                  {tab === "Watchlist"
                    ? "Tap the star beside a company to keep it close."
                    : "Try another company name or sector."}
                </p>
              </div>
            )}
            {loading && (
              <div className="loading">Loading market directory…</div>
            )}
          </div>
          <div className="table-footer">
            <span>
              {data
                ? `Showing ${data.total ? (data.page - 1) * data.pageSize + 1 : 0}–${(data.page - 1) * data.pageSize + rows.length} of ${data.total.toLocaleString("en-IN")} matching listings`
                : loading
                  ? "Fetching directory…"
                  : "No directory loaded"}
            </span>
            <span>
              <span className="status-dot" />{" "}
              {mode === "sample"
                ? "Sample dataset · Not investment advice"
                : "Free provider · May be delayed"}
            </span>
          </div>
          <div className="pagination">
            <label className="sector">
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[25, 50, 100].map((n) => (
                  <option value={n} key={n}>
                    {n} per page
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <span>
              Page {data?.page || 1} of {data?.pages || 1}
            </span>
            <button
              disabled={loading || !data || data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              Previous
            </button>
            <button
              disabled={loading || !data || data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
          {mode === "market" && data?.fetchedAt && (
            <p className="snapshot-note">
              Directory fetched{" "}
              {new Date(data.fetchedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}{" "}
              IST. Quote delays vary. Market-cap ranges are value bands, not
              SEBI classifications.
            </p>
          )}
        </section>
        <section className="bottom-banner">
          <div className="banner-icon">
            <Star size={23} />
          </div>
          <div>
            <h3>Your market. Your watchlist.</h3>
            <p>Keep the companies you care about a little closer.</p>
          </div>
          <button
            onClick={() => {
              updateFilter(setTab, "Watchlist");
              document
                .querySelector(".stocks")
                .scrollIntoView({ behavior: "smooth" });
            }}
          >
            Open watchlist <ArrowUpRight size={16} />
          </button>
        </section>
        <footer>
          <a className="brand" href="#">
            tickr<span className="brand-period">.</span>
          </a>
          <p>A clearer view of Indian markets.</p>
          <span>Made for the long view. ↗</span>
        </footer>
      </main>
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Stock details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close details"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            {selected === "about" ? (
              <>
                <div className="eyebrow">MEET TICKR</div>
                <h2>Clarity for your next move.</h2>
                <p>
                  A first version of an Indian market dashboard inspired by
                  CoinMarketCap. Search leading companies, compare available
                  quotes, and save a watchlist on this browser.
                </p>
                <p>
                  The market directory covers NSE and BSE stock listings
                  available through TradingView’s public scanner. The same
                  company can appear on both exchanges. Market caps, prices and
                  sectors come from that feed and can be delayed or missing.
                  Yahoo Finance supplies on-demand charts. Both are unofficial
                  free endpoints without an API key or uptime guarantee. Value
                  bands are not official SEBI classifications. The 12-stock
                  sample and index cards remain illustrative.
                </p>
                <p>
                  No trading or investment recommendations. Your watchlist stays
                  on this device.
                </p>
              </>
            ) : (
              <>
                <div className="eyebrow">
                  {detail.sector} · {detail.exchange}
                </div>
                <h2>{detail.name}</h2>
                <p>
                  {detail.symbol} ·{" "}
                  {mode === "sample"
                    ? "Illustrative sample"
                    : "TradingView directory · unofficial"}
                </p>
                <div className="detail-price">
                  {detail.price == null
                    ? "Unavailable"
                    : "₹" + money(detail.price)}{" "}
                  <span
                    className={detail.change >= 0 ? "positive" : "negative"}
                  >
                    {pct(detail.change)}
                  </span>
                </div>
                {(mode === "sample" || chart?.history?.length > 1) && (
                  <Spark
                    large
                    up={detail.change >= 0}
                    seed={detail.symbol.length}
                    values={chart?.history?.map((p) => p.price)}
                  />
                )}
                {chartLoading && <p>Loading price history…</p>}
                {chartError && (
                  <p role="alert" className="negative">
                    {chartError}
                  </p>
                )}
                <p className="detail-note">
                  {mode === "sample"
                    ? "Illustrative sample prices and chart."
                    : `Directory fetched ${new Date(detail.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Prices may be delayed.`}
                  {mode === "market" &&
                    chart?.asOf &&
                    ` Chart quote: ${new Date(chart.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`}
                </p>
                <div className="detail-facts">
                  <span>
                    Market cap{" "}
                    <b>
                      {detail.marketCap == null
                        ? "Unavailable"
                        : "₹" +
                          (detail.marketCap / 1e7).toLocaleString("en-IN", {
                            maximumFractionDigits: 0,
                          }) +
                          " crore"}
                    </b>
                  </span>
                  <span>
                    Sector <b>{detail.sector}</b>
                  </span>
                  <span>
                    Exchange <b>{detail.exchange}</b>
                  </span>
                </div>
                <button className="watch-button" onClick={() => toggle(detail)}>
                  <Star size={16} />
                  {isWatched(detail)
                    ? "Remove from watchlist"
                    : "Add to watchlist"}
                </button>
                <a
                  className="provider-link"
                  href={`https://finance.yahoo.com/quote/${encodeURIComponent(detail.symbol)}.${detail.exchange === "BSE" ? "BO" : "NS"}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source on Yahoo Finance <ExternalLink size={13} />
                </a>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
