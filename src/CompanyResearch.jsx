import React, { useEffect, useRef, useState } from "react";
import CandleChart from "./CandleChart.jsx";
import useCompanyNews from "./useCompanyNews.js";
import { sampleResearch } from "../shared/sample-research.js";
const TABS = ["Chart", "News", "Results", "Dividends"];
const date = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " IST"
    : "Unavailable";
const amount = (value, divisor = 1) =>
  value == null
    ? "Unavailable"
    : (value / divisor).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export default function CompanyResearch({ company, mode }) {
  const [tab, setTab] = useState("Chart"),
    [range, setRange] = useState("1y"),
    [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const cache = useRef(new Map());
  const section = tab.toLowerCase(),
    key = `${mode}:${company.id}:${section}:${section === "chart" ? range : ""}:${retry}`;
  const news = useCompanyNews(
    company,
    mode,
    retry,
    tab === "Chart" || tab === "News",
  );
  const state =
    tab === "News"
      ? {
          ...news,
          loading: news.loading && !news.data?.articles?.length,
          error: news.error && !news.data?.articles?.length,
        }
      : snapshot?.key === key
        ? snapshot
        : { loading: true };
  useEffect(() => {
    if (section === "news") return;
    const controller = new AbortController();
    if (mode === "sample") {
      setSnapshot({ key, data: sampleResearch(company, section) });
      return () => controller.abort();
    }
    if (
      cache.current.has(key) &&
      Date.now() - cache.current.get(key).time < 900000
    ) {
      setSnapshot({ key, data: cache.current.get(key).data });
      return () => controller.abort();
    }
    setSnapshot({ key, loading: true });
    (async () => {
      try {
        const response = await fetch(
          `/api/company/${encodeURIComponent(company.id)}?${new URLSearchParams({ section, range })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        const field = {
          chart: "candles",
          news: "articles",
          results: "quarters",
          dividends: "dividends",
        }[section];
        if (
          !response.ok ||
          data.symbol !== company.id ||
          data.section !== section ||
          !Array.isArray(data[field])
        )
          throw new Error("Unavailable");
        if (!controller.signal.aborted) {
          if (cache.current.size >= 30)
            cache.current.delete(cache.current.keys().next().value);
          cache.current.set(key, { data, time: Date.now() });
          setSnapshot({ key, data });
        }
      } catch {
        if (!controller.signal.aborted) setSnapshot({ key, error: true });
      }
    })();
    return () => controller.abort();
  }, [key, company, mode, section, range]);
  const data = state.data;
  return (
    <section
      className="company-research-panel"
      aria-label="Company chart and research"
    >
      <div
        className="company-research-tabs"
        role="tablist"
        aria-label="Company research tabs"
      >
        {TABS.map((label, i) => (
          <button
            key={label}
            role="tab"
            id={`company-tab-${label}`}
            aria-selected={tab === label}
            aria-controls="company-research-content"
            tabIndex={tab === label ? 0 : -1}
            onClick={() => setTab(label)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 3
                    : (i + (event.key === "ArrowRight" ? 1 : 3)) % 4;
              setTab(TABS[next]);
              document.getElementById(`company-tab-${TABS[next]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="research-note">
        {mode === "sample"
          ? "ILLUSTRATIVE SAMPLE — fictional prices, news, results and dividends."
          : "Free finance and public RSS data · may be delayed or incomplete. No paid API or account."}
      </p>
      {(tab === "Chart" || tab === "News") && (
        <div className="news-collection-note">
          {news.loading && <p role="status">Checking news feeds…</p>}
          {news.error && (
            <p>
              News refresh unavailable.{" "}
              {news.data?.articles?.length
                ? "Showing previously saved headlines."
                : "No headlines were substituted."}
            </p>
          )}
          {mode === "market" && (
            <p>
              {news.saved && news.data?.articles?.length
                ? "Headlines saved locally in this browser."
                : news.loading
                  ? "Checking headlines for your local history."
                  : news.error
                    ? "Existing local history is kept when feeds fail."
                    : news.saved
                      ? "No matching headlines fetched yet."
                      : "News could not be saved locally; fetched headlines remain visible."}{" "}
              Up to 200 per company and 2,000 overall; no complete historical
              archive. Collected only while you open this company’s chart or
              news; clearing browser data removes saved history.
            </p>
          )}
          {news.data?.sources?.length > 0 && (
            <p>
              {news.data.sources
                .map(
                  (item) =>
                    `${item.source}: ${item.status}${item.status === "available" ? ` (${item.count})` : ""}`,
                )
                .join(" · ")}
            </p>
          )}
        </div>
      )}
      {tab === "Chart" && (
        <div
          className="research-ranges"
          role="group"
          aria-label="Chart timeframe"
        >
          {["1m", "3m", "6m", "1y", "5y"].map((value) => (
            <button
              key={value}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {mode === "market" && (
        <button
          className="secondary-button"
          disabled={!!state.loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          Refresh {section}
        </button>
      )}
      <div
        role="tabpanel"
        id="company-research-content"
        aria-labelledby={`company-tab-${tab}`}
        tabIndex={0}
        aria-busy={!!state.loading}
      >
        {state.loading ? (
          <p role="status">Loading {section}…</p>
        ) : state.error ? (
          <div role="alert">
            <p>
              {tab} unavailable from the free source. No sample values have been
              substituted.
            </p>
            <button
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry {section}
            </button>
          </div>
        ) : (
          <>
            {tab === "Chart" &&
              (data.candles.length ? (
                <CandleChart
                  candles={data.candles}
                  dividends={data.dividends}
                  articles={news.data?.articles}
                />
              ) : (
                <p>No usable OHLC candles were supplied for this range.</p>
              ))}
            {tab === "News" && (
              <>
                {data.articles.length ? (
                  <ul className="company-news-list">
                    {data.articles.map((item, i) => (
                      <li key={item.url || i}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            {item.title}
                          </a>
                        ) : (
                          <b>{item.title}</b>
                        )}
                        <p>
                          {item.publisher} · {date(item.publishedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No company-matched headlines were supplied by the available
                    feeds. This does not mean there is no news.
                  </p>
                )}
                <p className="research-note">
                  Headlines link to original articles; full articles are not
                  copied. Yahoo matches use ticker tags; RSS matches use the
                  company name or ticker in the headline and may mention other
                  companies.
                </p>
              </>
            )}
            {tab === "Results" && (
              <>
                <p className="research-note">
                  Quarterly reported figures, where available. Revenue and net
                  income in ₹ crore; diluted EPS in ₹ per share. Period-end
                  dates are not earnings announcement dates.
                </p>
                {data.quarters.length ? (
                  <div className="research-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Period ended</th>
                          <th>Revenue (₹ Cr)</th>
                          <th>Net income (₹ Cr)</th>
                          <th>Diluted EPS (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.quarters.map((item) => (
                          <tr key={item.periodEnd}>
                            <td>{item.periodEnd}</td>
                            <td>{amount(item.revenue, 1e7)}</td>
                            <td>{amount(item.netIncome, 1e7)}</td>
                            <td>{amount(item.eps)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    Quarterly results are not available from this free source
                    for this listing.
                  </p>
                )}
                <p className="research-note">
                  Upcoming earnings date: Unavailable. Earnings markers are
                  omitted because announcement dates are not supplied. Check
                  company filings for consolidated/standalone reporting details.
                </p>
              </>
            )}
            {tab === "Dividends" && (
              <>
                <p className="research-note">
                  Reported cash dividends in the past year. Amount is ₹ per
                  share; historical ex-dividend dates are not upcoming payout
                  promises.
                </p>
                {data.dividends.length ? (
                  <div className="research-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Ex-dividend date</th>
                          <th>Amount (₹)</th>
                          <th>Record date</th>
                          <th>Payment date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dividends.map((item, i) => (
                          <tr key={item.exDate + ":" + i}>
                            <td>{item.exDate}</td>
                            <td>{amount(item.amount)}</td>
                            <td>{item.recordDate || "Unavailable"}</td>
                            <td>{item.paymentDate || "Unavailable"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    No dividend events were supplied for the past year. Coverage
                    may be incomplete.
                  </p>
                )}
                <p className="research-note">
                  Record and payment dates are not supplied by this feed; they
                  are never inferred from the ex-dividend date.
                </p>
              </>
            )}
            {mode === "market" && (
              <p className="research-note">
                Source: {data.source} · Fetched: {date(data.fetchedAt)}
                {tab === "Chart" && data.asOf
                  ? ` · Quote: ${date(data.asOf)}`
                  : ""}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
