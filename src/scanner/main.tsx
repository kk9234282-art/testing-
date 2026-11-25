import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  Activity,
  Search,
  RefreshCw,
  Upload,
  ShieldCheck,
  GitBranch,
  Layers,
  FlaskConical,
  ChevronRight,
  Download,
} from "lucide-react";
import StructureChart from "./StructureChart";
import type {
  Demo,
  Scan,
  StockRow,
  Detail,
  Backtest,
  Dataset,
  Cohort,
  Parameters,
} from "./types";
import "./scanner.css";
const STATES = [
  "Early Reversal",
  "Structure Developing",
  "Confirmed Bullish",
  "Strong Bullish",
  "Weakening",
  "Bearish",
];
const DEFAULT: Parameters = {
  pivot_left: 3,
  pivot_right: 3,
  swing_atr: 1,
  break_atr: 0.1,
  retest_bars: 10,
};
const fmt = (value: number | null | undefined, digits = 2) =>
  value == null
    ? "Unavailable"
    : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const pct = (value: number | null | undefined) =>
  value == null ? "Unavailable" : fmt(value) + "%";
const when = (value: string | null | undefined) => value || "—";
function Badge({ value }: { value: string | null }) {
  return (
    <span
      className={
        "sl-badge " +
        (value?.includes("Bullish") || value === "Risk-on"
          ? "bull"
          : value === "Bearish" || value === "Defensive"
            ? "bear"
            : value === "Weakening" || value === "Mixed"
              ? "warn"
              : "neutral")
      }
    >
      {value || "No transition"}
    </span>
  );
}
function Cohorts({ rows }: { rows: Cohort[] }) {
  return (
    <div className="sl-table-scroll">
      <table>
        <thead>
          <tr>
            {[
              "Horizon",
              "Regime at signal",
              "Signals",
              "Completed",
              "Censored",
              "Mean return",
              "Win rate",
              "Worst trade DD",
              "Failed breakout",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{row.horizon} sessions</td>
              <td>{row.regime}</td>
              <td>{row.signals}</td>
              <td>{row.completed}</td>
              <td>{row.censored}</td>
              <td>{pct(row.mean_return_pct)}</td>
              <td>{pct(row.win_rate_pct)}</td>
              <td>{pct(row.worst_trade_drawdown_pct)}</td>
              <td>{pct(row.failed_breakout_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function App() {
  const [demo, setDemo] = useState<Demo | null>(null),
    [error, setError] = useState(""),
    [source, setSource] = useState<"demo" | "private">(() =>
      location.hash.startsWith("#/run/") ? "private" : "demo",
    );
  const [tab, setTab] = useState("Discovery"),
    [phase, setPhase] = useState(""),
    [sector, setSector] = useState(""),
    [exchange, setExchange] = useState(""),
    [search, setSearch] = useState("");
  const [sort, setSort] = useState("initial_signal_date"),
    [direction, setDirection] = useState<"desc" | "asc">("desc"),
    [minRs, setMinRs] = useState(""),
    [minVolume, setMinVolume] = useState(""),
    [minAdx, setMinAdx] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState(""),
    [detailBusy, setDetailBusy] = useState(false);
  const [token, setToken] = useState(""),
    [datasets, setDatasets] = useState<Dataset[]>([]),
    [dataset, setDataset] = useState(""),
    [asOf, setAsOf] = useState(""),
    [liveScan, setLiveScan] = useState<Scan | null>(null),
    [liveBacktest, setLiveBacktest] = useState<Backtest | null>(null),
    [runId, setRunId] = useState(""),
    [busy, setBusy] = useState(false),
    [jobMessage, setJobMessage] = useState("");
  const [parameters, setParameters] = useState<Parameters>(DEFAULT),
    [signal, setSignal] = useState("confirmed"),
    [fee, setFee] = useState(10),
    [slippage, setSlippage] = useState(5);
  const [regimeIndex, setRegimeIndex] = useState("NIFTY_500");
  const [showColumns, setShowColumns] = useState(false),
    [columns, setColumns] = useState(["dates", "rs", "volume", "adx", "rsi"]);
  const generation = useRef(0),
    currentRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/structure-demo.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Demo dataset unavailable");
        return r.json();
      })
      .then((data: Demo) => setDemo(data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const follow = () => {
      const match = /^#\/stock\/([A-Z0-9_-]{1,60})$/.exec(location.hash);
      if (source === "demo" && demo && match) {
        const stock = demo.stocks[match[1]];
        if (stock) {
          setSelected(match[1]);
          setDetail(stock);
          setDetailBusy(false);
          setTab("Stock");
        } else setError("Unknown security in this sample dataset");
      }
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [demo, source]);
  const scan = source === "demo" ? demo?.scan : liveScan;
  const backtest = source === "demo" ? demo?.backtest : liveBacktest;
  const illustrative =
    source === "demo" ||
    scan?.manifest.kind === "sample" ||
    datasets.find((item) => item.id === dataset)?.manifest.kind === "sample";
  const activeRow = scan?.rows.find((row) => row.security_id === selected);
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch("/api/structure/" + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail
                .map(
                  (item: { loc: string[]; msg: string }) =>
                    `${item.loc.join(".")}: ${item.msg}`,
                )
                .join("; ")
            : data.error || "Research request failed",
      );
    return data;
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const list = (await api("datasets")) as Dataset[];
      setDatasets(list);
      if (list[0]) {
        setDataset(list[0].id);
        setAsOf(list[0].manifest.latest_complete_session);
      }
      const bookmark =
        /^#\/run\/([a-f0-9-]{36})\/stock\/([A-Z0-9_-]{1,60})$/.exec(
          location.hash,
        );
      if (bookmark) {
        const record = await api("runs/" + bookmark[1]);
        if (record.kind !== "scan" || record.state !== "complete")
          throw new Error("This stock link requires a completed scan");
        const stock = await api(`runs/${bookmark[1]}/stocks/${bookmark[2]}`);
        setDataset(record.dataset_id);
        setAsOf(record.request.as_of);
        setLiveScan(record.result);
        setRunId(record.id);
        setSelected(bookmark[2]);
        setDetail(stock);
        setDetailBusy(false);
        setTab("Stock");
      }
      setJobMessage(
        list.length
          ? "Private dataset connected. Run a scan."
          : "Connected. Import a validated historical bundle.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (kind: "scan" | "backtest") => {
    if (!dataset || !asOf) {
      setError("Choose a dataset and complete session first");
      return;
    }
    setBusy(true);
    setError("");
    setJobMessage("Queuing " + kind + "…");
    const controller = new AbortController();
    currentRequest.current = controller;
    const version = generation.current;
    try {
      const queued = await api("runs/" + kind, {
        method: "POST",
        body: JSON.stringify({
          dataset_id: dataset,
          as_of: asOf,
          parameters,
          signal,
          fee_bps: fee,
          slippage_bps: slippage,
        }),
        signal: controller.signal,
      });
      setJobMessage(`Job ${queued.run_id}: queued`);
      while (!controller.signal.aborted) {
        const result = await api("runs/" + queued.run_id, {
          signal: controller.signal,
        });
        if (version !== generation.current) return;
        setJobMessage(`Job ${queued.run_id}: ${result.state}`);
        if (result.state === "failed")
          throw new Error(result.error || "Research job failed");
        if (result.state === "complete") {
          if (kind === "scan") {
            setLiveScan(result.result as Scan);
            setRunId(result.id);
            setDetail(null);
            setSelected("");
          } else setLiveBacktest(result.result as Backtest);
          break;
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1500);
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("Stopped waiting; server job may continue"));
            },
            { once: true },
          );
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      currentRequest.current = null;
    }
  };
  const openStock = async (row: StockRow) => {
    setDetailBusy(false);
    setSelected(row.security_id);
    setTab("Stock");
    setDetail(null);
    setError("");
    if (source === "demo") {
      location.hash = "/stock/" + row.security_id;
      setDetail(demo?.stocks[row.security_id] || null);
      return;
    }
    location.hash = `/run/${runId}/stock/${row.security_id}`;
    const version = ++generation.current;
    setDetailBusy(true);
    try {
      const value = await api(`runs/${runId}/stocks/${row.security_id}`);
      if (version === generation.current) setDetail(value as Detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (version === generation.current) setDetailBusy(false);
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3_000_000) {
      setError(
        "Browser import limit is 3 MB. Use the private Python CLI for a full-universe file.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = await file.text();
      JSON.parse(body);
      const result = await api("import", { method: "POST", body });
      setDataset(result.dataset_id);
      setAsOf(result.manifest.latest_complete_session);
      setDatasets((await api("datasets")) as Dataset[]);
      setLiveScan(null);
      setLiveBacktest(null);
      setDetail(null);
      setJobMessage("Dataset validated and stored. Run the daily scan.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const filtered = useMemo(() => {
    const rows = (scan?.rows || []).filter(
      (row) =>
        (!phase || row.status === phase) &&
        (!sector || row.sector === sector) &&
        (!exchange || row.exchanges.includes(exchange)) &&
        `${row.name} ${row.symbol} ${row.isin}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!minRs || (row.rs63 != null && row.rs63 >= Number(minRs))) &&
        (!minVolume ||
          (row.volume_ratio != null &&
            row.volume_ratio >= Number(minVolume))) &&
        (!minAdx || (row.adx14 != null && row.adx14 >= Number(minAdx))),
    );
    return rows.sort((a, b) => {
      const left = a[sort as keyof StockRow],
        right = b[sort as keyof StockRow];
      if (left == null && right == null)
        return a.symbol.localeCompare(b.symbol);
      if (left == null) return 1;
      if (right == null) return -1;
      const value =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return direction === "asc" ? value : -value;
    });
  }, [
    scan,
    phase,
    sector,
    exchange,
    search,
    minRs,
    minVolume,
    minAdx,
    sort,
    direction,
  ]);
  const primaryRegime = scan?.regime.indices.find(
    (row) => row.index_id === "NIFTY_500",
  );
  const changeDataset = (id: string) => {
    generation.current++;
    setDetailBusy(false);
    const item = datasets.find((item) => item.id === id);
    setDataset(id);
    setAsOf(item?.manifest.latest_complete_session || "");
    setLiveScan(null);
    setLiveBacktest(null);
    setDetail(null);
    setRunId("");
    setSelected("");
  };
  return (
    <div className="structure-lab">
      <header className="sl-header">
        <a href="/" className="sl-brand">
          tickr<span>.</span>
          <small>STRUCTURE LAB</small>
        </a>
        <a href="/" className="sl-back">
          <ArrowLeft size={13} />
          Back to markets
        </a>
      </header>
      <main>
        <div className="sl-hero">
          <div>
            <div className="sl-eyebrow">
              <GitBranch size={13} />
              DAILY MARKET STRUCTURE
            </div>
            <h1>
              Find the turn.
              <br />
              <em>Follow the structure.</em>
            </h1>
            <p>
              Confirmed pivots first. Relative strength, volume and market
              breadth provide context.
            </p>
          </div>
          <div className="sl-source">
            <label>
              Research dataset
              <select
                aria-label="Scanner dataset source"
                disabled={busy}
                value={source}
                onChange={(e) => {
                  generation.current++;
                  history.replaceState(
                    null,
                    "",
                    location.pathname + location.search,
                  );
                  setDetailBusy(false);
                  setSource(e.target.value as "demo" | "private");
                  setDetail(null);
                  setSelected("");
                  setTab("Discovery");
                  setError("");
                }}
              >
                <option value="demo">Illustrative research demo</option>
                <option value="private">Private imported history</option>
              </select>
            </label>
            <span>
              <FlaskConical size={12} />
              {illustrative
                ? "Synthetic prices & constituents"
                : "User-attested historical dataset"}
            </span>
          </div>
        </div>
        <div className="sl-notice">
          <ShieldCheck size={16} />
          <div>
            <b>
              {illustrative
                ? "ILLUSTRATIVE SAMPLE — not actual stock signals."
                : "PRIVATE RESEARCH — source completeness must be verified."}
            </b>
            <p>
              Research and discovery only. No automatic buy/sell
              recommendations. End-of-day decisions use confirmed structure,
              never a future pivot.
            </p>
          </div>
        </div>
        {error && (
          <div className="sl-error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <nav className="sl-tabs" aria-label="Structure scanner sections">
          {[
            "Discovery",
            "Market regime",
            "Sector rankings",
            "Backtesting",
            "Data & methodology",
            ...(selected ? ["Stock"] : []),
          ].map((name) => (
            <button
              key={name}
              aria-pressed={tab === name}
              onClick={() => {
                setTab(name);
                if (name !== "Stock")
                  history.replaceState(
                    null,
                    "",
                    location.pathname + location.search,
                  );
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        {source === "private" && (
          <section className="sl-connection">
            <div className="sl-connection-fields">
              <label>
                Service token
                <input
                  aria-label="Scanner service token"
                  type="password"
                  value={token}
                  autoComplete="off"
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Kept in memory only"
                />
              </label>
              <button
                className="sl-primary"
                disabled={busy || !token}
                onClick={connect}
              >
                Connect
              </button>
              <label>
                Dataset
                <select
                  aria-label="Private historical dataset"
                  disabled={busy}
                  value={dataset}
                  onChange={(e) => changeDataset(e.target.value)}
                >
                  <option value="">Choose dataset</option>
                  {datasets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.manifest.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                As-of session
                <input
                  aria-label="Scanner as-of date"
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                />
              </label>
              <button
                className="sl-primary"
                disabled={busy || !dataset}
                onClick={() => run("scan")}
              >
                <RefreshCw size={12} />
                Run EOD scan
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  generation.current++;
                  setToken("");
                  setDatasets([]);
                  setDataset("");
                  setLiveScan(null);
                  setLiveBacktest(null);
                  setDetail(null);
                  setRunId("");
                  setJobMessage("Disconnected");
                }}
              >
                Disconnect
              </button>
            </div>
            <p className="sl-note" role="status">
              {jobMessage ||
                "Connect your private FastAPI service through the same-origin bridge. Demo data is never substituted for private results."}
            </p>
            {busy && (
              <button onClick={() => currentRequest.current?.abort()}>
                Stop waiting (server job can continue)
              </button>
            )}
          </section>
        )}
        {!demo && source === "demo" && (
          <p role="status">Loading computed research sample…</p>
        )}
        {scan && (
          <div className="sl-snapshot">
            <span>
              <Activity size={12} />
              As of <b>{scan.as_of}</b> · {scan.coverage.complete}/
              {scan.coverage.active_equities} complete equities
            </span>
            <span>
              Regime: <b>{primaryRegime?.regime || "Unavailable"}</b> ·{" "}
              {fmt(primaryRegime?.score, 1)}/100
            </span>
          </div>
        )}
        {tab === "Discovery" && (
          <>
            <section
              className="sl-stages"
              aria-label="Structural classifications"
            >
              {STATES.map((name, index) => (
                <button
                  key={name}
                  className={phase === name ? "active" : ""}
                  aria-pressed={phase === name}
                  onClick={() => setPhase(phase === name ? "" : name)}
                >
                  <span>0{index + 1}</span>
                  <b>{scan?.counts[name] || 0}</b>
                  <small>{name}</small>
                </button>
              ))}
            </section>
            <section className="sl-panel">
              <div className="sl-panel-heading">
                <div>
                  <h2>Daily discovery</h2>
                  <p>
                    Initial signal, confirmation and current status are separate
                    events.
                  </p>
                </div>
                <button onClick={() => setShowColumns((value) => !value)}>
                  <Layers size={13} />
                  Columns
                </button>
              </div>
              <div className="sl-filters">
                <label className="sl-search">
                  <Search size={14} />
                  <input
                    aria-label="Search structure stocks"
                    placeholder="Company, ticker or ISIN"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter structural stage"
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                >
                  <option value="">All stages</option>
                  {STATES.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter structure sector"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                >
                  <option value="">All sectors</option>
                  {[...new Set(scan?.rows.map((row) => row.sector))]
                    .sort()
                    .map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                </select>
                <select
                  aria-label="Filter structure exchange"
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value)}
                >
                  <option value="">NSE + BSE</option>
                  <option>NSE</option>
                  <option>BSE</option>
                </select>
                <label>
                  RS ≥
                  <input
                    aria-label="Minimum relative strength"
                    type="number"
                    value={minRs}
                    onChange={(e) => setMinRs(e.target.value)}
                  />
                </label>
                <label>
                  Volume × ≥
                  <input
                    aria-label="Minimum volume ratio"
                    type="number"
                    min="0"
                    step=".1"
                    value={minVolume}
                    onChange={(e) => setMinVolume(e.target.value)}
                  />
                </label>
                <label>
                  ADX ≥
                  <input
                    aria-label="Minimum ADX"
                    type="number"
                    min="0"
                    value={minAdx}
                    onChange={(e) => setMinAdx(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => {
                    setPhase("");
                    setSector("");
                    setExchange("");
                    setSearch("");
                    setMinRs("");
                    setMinVolume("");
                    setMinAdx("");
                  }}
                >
                  Clear filters
                </button>
              </div>
              {showColumns && (
                <div className="sl-columns">
                  {["dates", "rs", "volume", "adx", "rsi"].map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={columns.includes(key)}
                        onChange={(e) =>
                          setColumns((current) =>
                            e.target.checked
                              ? [...current, key]
                              : current.filter((item) => item !== key),
                          )
                        }
                      />
                      {key.toUpperCase()}
                    </label>
                  ))}
                </div>
              )}
              <div className="sl-table-tools">
                <span>
                  {filtered.length} equities ·{" "}
                  {scan?.coverage.excluded_instruments || 0} non-equity
                  instruments excluded
                </span>
                <label>
                  Sort
                  <select
                    aria-label="Sort structural stocks"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="initial_signal_date">
                      Initial transition date
                    </option>
                    <option value="confirmation_date">Confirmation date</option>
                    <option value="status_date">Status change date</option>
                    <option value="rs63">Relative strength</option>
                    <option value="volume_ratio">Volume ratio</option>
                    <option value="adx14">ADX</option>
                    <option value="symbol">Symbol</option>
                  </select>
                </label>
                <button
                  aria-label="Reverse structure sort"
                  onClick={() =>
                    setDirection(direction === "desc" ? "asc" : "desc")
                  }
                >
                  {direction === "desc" ? "↓ Descending" : "↑ Ascending"}
                </button>
              </div>
              <div className="sl-table-scroll">
                <table aria-label="Structure scanner stocks">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Stage</th>
                      <th>Close (₹)</th>
                      {columns.includes("dates") && (
                        <>
                          <th>Initial signal</th>
                          <th>Confirmed</th>
                          <th>Status since</th>
                        </>
                      )}
                      {columns.includes("rs") && <th>RS 63 (pp)</th>}
                      {columns.includes("volume") && <th>Volume ×</th>}
                      {columns.includes("adx") && <th>ADX 14</th>}
                      {columns.includes("rsi") && <th>RSI 14</th>}
                      <th>Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.security_id}>
                        <td>
                          <button
                            className="sl-stock-link"
                            onClick={() => openStock(row)}
                          >
                            {row.symbol}
                            <ArrowUpRight size={12} />
                            <small>
                              {row.name} · {row.exchanges.join(" + ")}
                            </small>
                          </button>
                        </td>
                        <td>
                          <Badge value={row.status} />
                        </td>
                        <td>{fmt(row.close)}</td>
                        {columns.includes("dates") && (
                          <>
                            <td>{when(row.initial_signal_date)}</td>
                            <td>{when(row.confirmation_date)}</td>
                            <td>{when(row.status_date)}</td>
                          </>
                        )}
                        {columns.includes("rs") && <td>{fmt(row.rs63)}</td>}
                        {columns.includes("volume") && (
                          <td>{fmt(row.volume_ratio)}</td>
                        )}
                        {columns.includes("adx") && <td>{fmt(row.adx14)}</td>}
                        {columns.includes("rsi") && <td>{fmt(row.rsi14)}</td>}
                        <td>
                          {row.data_quality}
                          <small>{row.history_sessions} sessions</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <p className="sl-empty">
                  {scan
                    ? "No equities match these filters."
                    : "Connect and scan an imported dataset, or choose the illustrative demo."}
                </p>
              )}
            </section>
          </>
        )}
        {tab === "Market regime" && (
          <>
            <section className="sl-index-grid">
              {scan?.regime.indices.map((index) => (
                <article className="sl-panel" key={index.index_id}>
                  <span className="sl-eyebrow">
                    {index.index_id.replaceAll("_", " ")}
                  </span>
                  <h2>
                    {fmt(index.score, 1)}
                    <small>/100</small>
                  </h2>
                  <Badge value={index.regime} />
                  <p>
                    {index.advances} advances · {index.declines} declines ·{" "}
                    {index.unchanged} unchanged
                  </p>
                  <div className="sl-breadth">
                    <i style={{ width: `${index.coverage * 100}%` }} />
                  </div>
                  <p className="sl-note">
                    {index.members}/{index.expected_members} members ·{" "}
                    {fmt(index.coverage * 100, 1)}% breadth coverage
                  </p>
                  <dl>
                    <div>
                      <dt>Above SMA 50</dt>
                      <dd>{fmt(index.above50_pct, 1)}%</dd>
                    </div>
                    <div>
                      <dt>Above SMA 200</dt>
                      <dd>{fmt(index.above200_pct, 1)}%</dd>
                    </div>
                    <div>
                      <dt>252-session highs / lows</dt>
                      <dd>
                        {fmt(index.new_highs, 0)} / {fmt(index.new_lows, 0)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </section>
            <section className="sl-panel">
              <h2>Advance–decline line</h2>
              <p>
                Net advances accumulated since this dataset starts, using
                point-in-time Nifty 500 membership.
              </p>
              {scan && (
                <svg
                  className="sl-ad-line"
                  role="img"
                  aria-label="Advance decline line since dataset start"
                  viewBox="0 0 900 160"
                >
                  <polyline
                    fill="none"
                    stroke="#aecf83"
                    strokeWidth="2"
                    points={(() => {
                      const rows =
                        scan.regime.advance_decline_lines?.[regimeIndex] || [];
                      const values = rows.map((row) => row.value);
                      const min = Math.min(...values),
                        range = Math.max(...values) - min || 1;
                      return rows
                        .map(
                          (row, i) =>
                            `${(i / Math.max(1, rows.length - 1)) * 900},${150 - ((row.value - min) / range) * 140}`,
                        )
                        .join(" ");
                    })()}
                  />
                </svg>
              )}
              <p className="sl-note">
                New-high/low counts require 252 sessions. Regime scores require
                a 200-session benchmark, exact imported membership count and at
                least 80% constituent SMA-200 coverage. Missing indices are not
                substituted.
              </p>
            </section>
          </>
        )}
        {tab === "Sector rankings" && (
          <section className="sl-panel">
            <h2>Where structure is improving</h2>
            <p>
              Ranked by the share of complete-history equities in Confirmed or
              Strong Bullish states. Unclassified but eligible equities remain
              in the denominator.
            </p>
            <div className="sl-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Sector</th>
                    <th>Companies</th>
                    <th>Classified / eligible</th>
                    <th>Bullish</th>
                    <th>Bullish share</th>
                    <th>Developing / early</th>
                  </tr>
                </thead>
                <tbody>
                  {scan?.sectors.map((row, i) => (
                    <tr key={row.sector}>
                      <td>{i + 1}</td>
                      <td>
                        <button
                          className="sl-stock-link"
                          onClick={() => {
                            setSector(row.sector);
                            setPhase("");
                            setTab("Discovery");
                          }}
                        >
                          {row.sector}
                          <ChevronRight size={12} />
                        </button>
                      </td>
                      <td>{row.companies}</td>
                      <td>
                        {row.classified} / {row.eligible}
                      </td>
                      <td>{row.bullish}</td>
                      <td>{fmt(row.bullish_pct, 1)}%</td>
                      <td>{row.early}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "Stock" && (
          <section className="sl-panel">
            {detailBusy ? (
              <p role="status">Calculating point-in-time stock history…</p>
            ) : detail ? (
              <>
                <div className="sl-panel-heading">
                  <div>
                    <div className="sl-eyebrow">
                      {detail.security.symbol} · {detail.security.isin}
                    </div>
                    <h2>{detail.security.name}</h2>
                    <p>
                      {detail.security.sector} · As of {detail.as_of}
                    </p>
                  </div>
                  <Badge value={activeRow?.status || null} />
                </div>
                <div className="sl-date-cards">
                  <div>
                    <small>Initial signal</small>
                    <b>{when(activeRow?.initial_signal_date)}</b>
                  </div>
                  <div>
                    <small>Confirmation</small>
                    <b>{when(activeRow?.confirmation_date)}</b>
                  </div>
                  <div>
                    <small>Latest status change</small>
                    <b>{when(activeRow?.status_date)}</b>
                  </div>
                </div>
                <StructureChart detail={detail} />
                <div className="sl-confirmations">
                  {(
                    [
                      "ema20",
                      "sma50",
                      "sma200",
                      "rsi14",
                      "macd",
                      "macd_signal",
                      "macd_hist",
                      "adx14",
                      "rs63",
                      "volume_ratio",
                      "delivery_pct",
                    ] as const
                  ).map((key) => (
                    <div key={key}>
                      <small>{key.replaceAll("_", " ").toUpperCase()}</small>
                      <b>{fmt(activeRow?.[key])}</b>
                    </div>
                  ))}
                </div>
                <h3>Confirmed structural history</h3>
                <div className="sl-table-scroll sl-history">
                  <table>
                    <thead>
                      <tr>
                        <th>Known on</th>
                        <th>Event</th>
                        <th>Level / state</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.events
                        .slice()
                        .reverse()
                        .map((event, i) => (
                          <tr key={i}>
                            <td>{event.date}</td>
                            <td>{event.type}</td>
                            <td>{event.status || fmt(event.level)}</td>
                            <td>{event.reason}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>Pivot audit trail ({detail.pivots.length})</summary>
                  <div className="sl-table-scroll sl-history">
                    <table>
                      <thead>
                        <tr>
                          <th>Pivot date</th>
                          <th>Confirmed on</th>
                          <th>Label</th>
                          <th>Adjusted level</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.pivots
                          .slice()
                          .reverse()
                          .map((pivot) => (
                            <tr key={pivot.id}>
                              <td>{pivot.pivot_date}</td>
                              <td>{pivot.confirmed_on}</td>
                              <td>{pivot.label}</td>
                              <td>{fmt(pivot.price)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <h3>Point-in-time fundamentals</h3>
                {detail.fundamentals ? (
                  <>
                    <p className="sl-note">
                      Period ended {detail.fundamentals.period_end} · Published{" "}
                      {detail.fundamentals.known_on} ·{" "}
                      {detail.fundamentals.source}
                    </p>
                    <div className="sl-confirmations">
                      {Object.entries(detail.fundamentals.values).map(
                        ([key, value]) => (
                          <div key={key}>
                            <small>{key.replaceAll("_", " ")}</small>
                            <b>{fmt(value)}</b>
                          </div>
                        ),
                      )}
                    </div>
                  </>
                ) : (
                  <p>
                    No verified published fundamentals were supplied. Delivery
                    percentage is shown only when explicitly verified in the
                    import.
                  </p>
                )}
              </>
            ) : (
              <p>Choose an equity from Discovery.</p>
            )}
          </section>
        )}
        {tab === "Backtesting" && (
          <>
            <section className="sl-panel">
              <div className="sl-panel-heading">
                <div>
                  <div className="sl-eyebrow">CAUSAL COHORT RESEARCH</div>
                  <h2>What happened after the signal?</h2>
                  <p>
                    20, 40 and 60 exchange sessions. Entry is the next
                    executable session’s open.
                  </p>
                </div>
                <FlaskConical size={22} />
              </div>
              {source === "private" ? (
                <div className="sl-filters">
                  <label>
                    Signal
                    <select
                      aria-label="Backtest signal"
                      value={signal}
                      onChange={(e) => setSignal(e.target.value)}
                    >
                      <option value="confirmed">Confirmed structure</option>
                      <option value="initial">Initial CHoCH</option>
                    </select>
                  </label>
                  <label>
                    Fee per side (bps)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={fee}
                      onChange={(e) => setFee(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Slippage per side (bps)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={slippage}
                      onChange={(e) => setSlippage(Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="sl-primary"
                    disabled={busy || !dataset}
                    onClick={() => run("backtest")}
                  >
                    Run historical cohorts
                  </button>
                </div>
              ) : (
                <p className="sl-note">
                  Computed synthetic confirmed-signal cohorts · 10 bps fee + 5
                  bps slippage per side. Connect a private dataset to change the
                  model.
                </p>
              )}
              {backtest ? (
                <>
                  <Cohorts rows={backtest.summary} />
                  <h3>Regime at the signal date</h3>
                  <Cohorts rows={backtest.by_regime} />
                  <p className="sl-note">{backtest.method}</p>
                  <details>
                    <summary>
                      Trade-level audit ({backtest.trades.length} horizon
                      outcomes)
                    </summary>
                    <div className="sl-table-scroll sl-history">
                      <table>
                        <thead>
                          <tr>
                            <th>Security</th>
                            <th>Signal</th>
                            <th>Entry</th>
                            <th>Horizon</th>
                            <th>Regime</th>
                            <th>Return</th>
                            <th>Drawdown</th>
                            <th>Failed breakout</th>
                            <th>Censor reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtest.trades.map((trade, i) => (
                            <tr key={i}>
                              <td>{trade.security_id}</td>
                              <td>{trade.signal_date}</td>
                              <td>{when(trade.entry_date)}</td>
                              <td>{trade.horizon}</td>
                              <td>{trade.regime}</td>
                              <td>{pct(trade.return_pct)}</td>
                              <td>{pct(trade.drawdown_pct)}</td>
                              <td>{trade.failed_breakout ? "Yes" : "No"}</td>
                              <td>{trade.reason || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              ) : (
                <p>
                  Run a backtest to inspect completed and censored outcomes.
                </p>
              )}
            </section>
          </>
        )}
        {tab === "Data & methodology" && (
          <section className="sl-panel sl-method">
            <h2>An auditable daily process</h2>
            <div className="sl-method-grid">
              <article>
                <GitBranch size={19} />
                <h3>Structure before confirmation</h3>
                <p>
                  Unique centered pivots require both left and right bars. ATR
                  filters reject small swings. A close beyond a confirmed high
                  creates CHoCH; a confirmed higher low and subsequent BOS are
                  needed for bullish confirmation.
                </p>
              </article>
              <article>
                <ShieldCheck size={19} />
                <h3>Point-in-time inputs</h3>
                <p>
                  Versioned identifiers, historical membership, publication
                  dates and inactive securities are imported together. Source
                  completeness is attested by the importer, not independently
                  certified by this app.
                </p>
              </article>
              <article>
                <FlaskConical size={19} />
                <h3>Explicit uncertainty</h3>
                <p>
                  Missing holding-period bars and unresolved delistings are
                  censored, not assigned imaginary returns. Corporate actions
                  use verified provider factors, split/bonus share counts and
                  gross dividend receivables without reinvestment.
                </p>
              </article>
            </div>
            <details open>
              <summary>Engine parameters</summary>
              <div className="sl-filters">
                {(Object.keys(parameters) as (keyof Parameters)[]).map(
                  (key) => (
                    <label key={key}>
                      {key.replaceAll("_", " ")}
                      <input
                        aria-label={key}
                        type="number"
                        step={key.includes("atr") ? ".1" : "1"}
                        disabled={source === "demo" || busy}
                        value={parameters[key]}
                        onChange={(e) =>
                          setParameters((current) => ({
                            ...current,
                            [key]: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <p className="sl-note">
                Applied on the next private scan/backtest. Demo calculations use
                fixed published defaults.
              </p>
            </details>
            <h3>Import historical data</h3>
            {scan && (
              <p className="sl-note">
                Source: {scan.manifest.source} · {scan.manifest.notes}
              </p>
            )}
            <p>
              Use raw finalized OHLCV, a trading-session calendar,
              security-master validity intervals, verified corporate-action
              factors, historical index membership and published fundamentals.
              ETFs, indices, warrants and other non-equities never enter the
              equity scanner.
            </p>
            <div className="sl-import-actions">
              <a
                className="sl-button"
                download
                href="/structure-import-schema.json"
              >
                JSON import schema
              </a>
              <a
                className="sl-button"
                download
                href="/structure-import-example.json"
              >
                <Download size={13} />
                Download synthetic import example
              </a>
              {source === "private" && (
                <label className="sl-button">
                  <Upload size={13} />
                  Import validated JSON
                  <input
                    aria-label="Import scanner history"
                    type="file"
                    accept=".json,application/json"
                    disabled={busy || !token}
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
            <p className="sl-note">
              Browser imports are limited to 3 MB; the Python CLI supports
              larger full-universe bundles. No licensed provider is configured
              yet. This section does not scrape or repurpose the main
              dashboard’s free quote feed.
            </p>
            <h3>Daily workflow</h3>
            <ol>
              <li>
                Import a versioned licensed provider bundle after the session is
                final.
              </li>
              <li>
                Run the EOD job and review coverage, structure events and
                regime.
              </li>
              <li>
                Run 20/40/60-session cohorts with disclosed costs and inspect
                censored cases.
              </li>
            </ol>
          </section>
        )}
        <footer className="sl-footer">
          <span>STRUCTURE LAB · END-OF-DAY RESEARCH</span>
          <a href="/">
            Return to the existing market dashboard <ArrowUpRight size={12} />
          </a>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("scanner-root")!).render(<App />);
