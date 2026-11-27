import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  RefreshCw,
  Search,
  SlidersHorizontal,
  ChevronDown,
  Radio,
} from "lucide-react";
import { indiaNewsDay } from "../shared/news.js";
import NewsStory from "./NewsStory.jsx";
import { selectQualityNews, publisherKey } from "../shared/news-quality.js";
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
  const [newsMode, setNewsMode] = useState("important"),
    [selectedPublishers, setSelectedPublishers] = useState(null);
  const [newsSearch, setNewsSearch] = useState(""),
    [eventType, setEventType] = useState("");
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
  const allArticles = news.data?.articles;
  const quality = useMemo(
    () =>
      selectQualityNews(allArticles, company, {
        mode: newsMode,
        publishers: selectedPublishers,
      }),
    [allArticles, company, newsMode, selectedPublishers],
  );
  const publishers = useMemo(
    () =>
      [
        ...new Map(
          (allArticles || []).map((item) => [
            publisherKey(item.publisher),
            item.publisher || "Publisher unavailable",
          ]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [allArticles],
  );
  const visibleStories = useMemo(() => {
    const query = newsSearch.trim().toLowerCase();
    return quality.stories.filter(
      (item) =>
        (!eventType || item.category === eventType) &&
        (!query ||
          [item, ...(item.relatedArticles || [])].some((story) =>
            `${story.title} ${story.publisher}`.toLowerCase().includes(query),
          )),
    );
  }, [quality.stories, newsSearch, eventType]);
  const newsDays = useMemo(() => {
    const days = new Map();
    for (const item of visibleStories) {
      const day = indiaNewsDay(item.publishedAt);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(item);
    }
    return [...days];
  }, [visibleStories]);
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
      <div className="research-status-row">
        <span
          className={
            mode === "sample"
              ? "research-sample-label"
              : "research-delayed-label"
          }
        >
          <Radio size={10} aria-hidden="true" />
          {mode === "sample" ? "ILLUSTRATIVE SAMPLE" : "May be delayed"}
        </span>
        <span>Times in IST</span>
      </div>
      {(tab === "Chart" || tab === "News") && (
        <>
          {news.error && (
            <p className="research-inline-warning">
              News refresh unavailable.{" "}
              {news.partial
                ? "Showing the headlines received so far."
                : news.data?.articles?.length
                  ? "Showing previously saved headlines."
                  : "No headlines were substituted."}
            </p>
          )}
          <details className="research-coverage">
            <summary>
              Sources & coverage{" "}
              <span>
                {news.loading
                  ? "Checking feeds…"
                  : news.data?.sources?.length
                    ? `${news.data.sources.filter((item) => item.status === "available").length}/${news.data.sources.length} feeds available`
                    : mode === "sample"
                      ? "Sample only"
                      : "Local history"}
              </span>
            </summary>
            <div className="news-collection-note">
              {news.data?.sources?.map((item) => (
                <p key={item.source}>
                  <span className={"feed-status-dot " + item.status} />
                  {item.source}: {item.status}
                  {item.status === "available"
                    ? ` (${item.count} matches)`
                    : ""}
                </p>
              ))}
              {mode === "sample" ? (
                <p>Fictional sample prices, news, results and dividends.</p>
              ) : (
                <p>
                  {news.saved
                    ? "Headlines saved locally in this browser."
                    : "History is saved when browser storage is available."}{" "}
                  Up to 200 per company and 2,000 overall. Collected only while
                  this chart or News tab is open; clearing browser data removes
                  saved history. Free feeds may be incomplete.
                </p>
              )}
              <p>
                Important news uses headline-based rules, not fact checking. All
                news retains fetched coverage. Publication dates are in IST; a
                story may be published after market close.
              </p>
            </div>
          </details>
        </>
      )}
      {(tab === "Chart" || tab === "News") && (
        <div className="news-quality-controls">
          <div role="group" aria-label="News quality filter">
            {[
              ["important", "Important news"],
              ["all", "All news"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={newsMode === value}
                onClick={() => setNewsMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <details className="news-publisher-filter">
            <summary>
              <SlidersHorizontal size={12} aria-hidden="true" />
              Publishers (
              {selectedPublishers == null
                ? publishers.length
                : publishers.filter(([key]) => selectedPublishers.includes(key))
                    .length}{" "}
              selected)
            </summary>
            <div className="news-publisher-actions">
              <button onClick={() => setSelectedPublishers(null)}>
                All publishers
              </button>
              <button onClick={() => setSelectedPublishers([])}>
                Clear publishers
              </button>
            </div>
            <div className="news-publisher-options">
              {publishers.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    aria-label={`Include publisher ${label}`}
                    checked={
                      selectedPublishers == null ||
                      selectedPublishers.includes(key)
                    }
                    onChange={(event) =>
                      setSelectedPublishers((previous) => {
                        const set = new Set(
                          previous ?? publishers.map(([value]) => value),
                        );
                        if (event.target.checked) set.add(key);
                        else set.delete(key);
                        return [...set];
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
          <div className="news-discovery">
            <label className="news-search">
              <Search size={14} aria-hidden="true" />
              <input
                aria-label="Search company news"
                placeholder="Search headlines or publishers"
                value={newsSearch}
                onChange={(event) => setNewsSearch(event.target.value)}
              />
              {newsSearch && (
                <button
                  aria-label="Clear news search"
                  onClick={() => setNewsSearch("")}
                >
                  ×
                </button>
              )}
            </label>
            <label className="news-type">
              <select
                aria-label="News event type"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
              >
                <option value="">All event types</option>
                {[
                  "Results",
                  "Dividends",
                  "Orders & contracts",
                  "Corporate actions",
                  "Management",
                  "Regulatory & legal",
                  "Operations",
                  "General",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
          </div>
          <div className="news-results-count">
            <b>{visibleStories.length}</b>{" "}
            {visibleStories.length === 1 ? "story" : "stories"}{" "}
            <span>
              · {quality.qualifying} matching headlines · {quality.total} in
              history
            </span>
            {(newsSearch || eventType) && (
              <button
                onClick={() => {
                  setNewsSearch("");
                  setEventType("");
                }}
              >
                Clear search & type
              </button>
            )}
          </div>
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
          className="secondary-button research-refresh"
          disabled={!!state.loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw size={12} aria-hidden="true" />
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
                  articles={visibleStories}
                  onOpenNews={() => setTab("News")}
                />
              ) : (
                <p>No usable OHLC candles were supplied for this range.</p>
              ))}
            {tab === "News" && (
              <>
                {visibleStories.length ? (
                  <div className="news-feed">
                    {newsDays.map(([day, stories]) => (
                      <section
                        className="news-day-group"
                        key={day}
                        aria-label={`News published ${day}`}
                      >
                        <div className="news-day-heading">
                          <time dateTime={day}>
                            {new Date(day + "T12:00:00Z").toLocaleDateString(
                              "en-IN",
                              {
                                timeZone: "Asia/Kolkata",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              },
                            )}
                          </time>
                          <span>
                            {stories.length}{" "}
                            {stories.length === 1 ? "story" : "stories"}
                          </span>
                        </div>
                        <ul className="company-news-list">
                          {stories.map((item, i) => (
                            <li key={item.url || i}>
                              <NewsStory article={item} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="news-empty">
                    <Search size={22} aria-hidden="true" />
                    <h4>
                      {quality.total
                        ? "No matching stories"
                        : "No headlines available yet"}
                    </h4>
                    <p>
                      {quality.total
                        ? "No stories match these quality and publisher filters. Try All news, another publisher, or clear your search and event type."
                        : "Available feeds have no company-matched headlines. Saved coverage will appear here when fetched."}
                    </p>
                  </div>
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
