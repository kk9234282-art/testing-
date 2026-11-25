import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  ChevronLeft,
  ChevronRight,
  Newspaper,
  ScanLine,
  ArrowUpRight,
} from "lucide-react";
import NewsStory from "./NewsStory.jsx";
import { groupChartNews } from "../shared/news.js";
export default function CandleChart({
  candles,
  dividends,
  articles,
  onOpenNews,
}) {
  const container = useRef(null),
    chartRef = useRef(null),
    markersRef = useRef(null),
    newsRef = useRef(new Map());
  const [showNews, setShowNews] = useState(true),
    [showDividends, setShowDividends] = useState(true),
    [selectedDay, setSelectedDay] = useState(null);
  const newsGroups = useMemo(
    () => groupChartNews(candles, articles),
    [candles, articles],
  );
  const activeDay = newsGroups.some((group) => group.time === selectedDay)
    ? selectedDay
    : newsGroups.at(-1)?.time;
  const activeIndex = newsGroups.findIndex((group) => group.time === activeDay);
  const selectedNews = newsGroups.find((group) => group.time === activeDay);

  const [reading, setReading] = useState(candles.at(-1));
  useEffect(() => {
    setReading(candles.at(-1));
    const element = container.current;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: 360,
      layout: {
        background: { color: "#0f161e" },
        textColor: "#a6b2bf",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1c2733" },
        horzLines: { color: "#1c2733" },
      },
      timeScale: { borderColor: "#344151" },
      rightPriceScale: { borderColor: "#344151" },
      crosshair: { mode: 0 },
      localization: { locale: "en-IN" },
    });
    chartRef.current = chart;
    const prices = chart.addSeries(CandlestickSeries, {
      upColor: "#afe669",
      downColor: "#f48390",
      borderVisible: false,
      wickUpColor: "#afe669",
      wickDownColor: "#f48390",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    prices.setData(
      candles.map(({ time, open, high, low, close }) => ({
        time,
        open,
        high,
        low,
        close,
      })),
    );
    const volumes = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    volumes.setData(
      candles
        .filter((item) => item.volume != null)
        .map((item) => ({
          time: item.time,
          value: item.volume,
          color: item.close >= item.open ? "#65884b" : "#985967",
        })),
    );
    chart.panes()[1]?.setHeight(75);
    const markers = createSeriesMarkers(prices, []);
    markersRef.current = markers;
    chart.subscribeClick((event) => {
      const id = event.hoveredObjectId;
      const time =
        typeof id === "string" && id.startsWith("news:")
          ? id.slice(5)
          : typeof event.time === "string"
            ? event.time
            : event.time && typeof event.time === "object"
              ? `${event.time.year}-${String(event.time.month).padStart(2, "0")}-${String(event.time.day).padStart(2, "0")}`
              : null;
      if (time && newsRef.current.has(time)) setSelectedDay(time);
    });
    chart.subscribeCrosshairMove((event) => {
      const price = event.seriesData.get(prices),
        volume = event.seriesData.get(volumes);
      if (!price || !("open" in price)) return;
      setReading({ ...price, volume: volume?.value });
    });
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() =>
      chart.applyOptions({ width: element.clientWidth }),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      markers.detach();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);
  useEffect(() => {
    newsRef.current = new Map(
      showNews ? newsGroups.map((group) => [group.time, group]) : [],
    );
    const times = new Set(candles.map((item) => item.time));
    const markers = [
      ...(showDividends
        ? (dividends || [])
            .filter((item) => times.has(item.exDate))
            .map((item) => ({
              time: item.exDate,
              position: "belowBar",
              color: "#7bb5ee",
              shape: "circle",
              text: `D ₹${item.amount}`,
            }))
        : []),
      ...(showNews
        ? newsGroups.map((group) => ({
            id: `news:${group.time}`,
            time: group.time,
            position: "aboveBar",
            color: group.time === activeDay ? "#e6c983" : "#82b3cb",
            shape: "circle",
            size: group.time === activeDay ? 1 : 0.65,
            text: "N",
          }))
        : []),
    ].sort((a, b) => a.time.localeCompare(b.time));
    markersRef.current?.setMarkers(markers);
  }, [candles, dividends, newsGroups, showNews, showDividends, activeDay]);
  const activateDay = (time) => {
    setSelectedDay(time);
    const scale = chartRef.current?.timeScale(),
      range = scale?.getVisibleLogicalRange();
    const index = candles.findIndex((candle) => candle.time === time);
    if (range && index >= 0 && (index < range.from || index > range.to)) {
      const span = Math.max(1, range.to - range.from);
      scale.setVisibleLogicalRange({
        from: index - span / 2,
        to: index + span / 2,
      });
    }
  };
  const prettyDay = (value) =>
    new Date(value + "T12:00:00Z").toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
    });
  return (
    <div className={"chart-workspace" + (showNews ? " has-news" : "")}>
      <div className="chart-main">
        <div className="candle-controls">
          <span>
            <i />
            Daily candles <em>INR · Volume</em>
          </span>
          <button onClick={() => chartRef.current?.timeScale().fitContent()}>
            <ScanLine size={12} aria-hidden="true" />
            Fit chart
          </button>
        </div>
        <div
          className="chart-event-filters"
          role="group"
          aria-label="Chart event filters"
        >
          <label>
            <input
              type="checkbox"
              checked={showNews}
              onChange={(event) => setShowNews(event.target.checked)}
            />
            <span className="news-marker-key" aria-hidden="true">
              N
            </span>
            News markers (N)
          </label>
          <label>
            <input
              type="checkbox"
              checked={showDividends}
              onChange={(event) => setShowDividends(event.target.checked)}
            />
            <span className="dividend-marker-key" aria-hidden="true">
              D
            </span>
            Dividend markers (D)
          </label>
        </div>
        <div className="candle-reading" aria-label="Candle OHLC and volume">
          {[
            ["O", "open"],
            ["H", "high"],
            ["L", "low"],
            ["C", "close"],
            ["VOL", "volume"],
          ].map(([label, key]) => (
            <span key={key}>
              <small>{label}</small>
              <b>
                {reading?.[key]?.toLocaleString("en-IN", {
                  minimumFractionDigits: key === "volume" ? 0 : 2,
                  maximumFractionDigits: key === "volume" ? 0 : 2,
                }) ?? "—"}
              </b>
            </span>
          ))}
        </div>
        <div
          ref={container}
          className="candle-chart"
          role="img"
          aria-label="Interactive candlestick and volume chart"
        />
        {showNews && (
          <div className="chart-timeline">
            <div className="chart-timeline-label">
              <Newspaper size={12} aria-hidden="true" />
              News timeline<span>{newsGroups.length} days</span>
            </div>
            <div className="chart-news-dates">
              {newsGroups.map((group) => (
                <button
                  key={group.time}
                  aria-label={`Show news for ${group.time}`}
                  aria-pressed={activeDay === group.time}
                  onClick={() => activateDay(group.time)}
                >
                  <time dateTime={group.time}>{prettyDay(group.time)}</time>
                  <span>{group.articles.length}</span>
                </button>
              ))}
              {!newsGroups.length && (
                <span className="chart-timeline-empty">
                  No matching news on these trading dates
                </span>
              )}
            </div>
          </div>
        )}
        <p className="chart-gesture-note">
          Drag to pan · Scroll or pinch to zoom · N news · D ex-dividend
        </p>
        <details className="research-chart-data">
          <summary>Price data · {candles.length} sessions</summary>
          <p className="research-note">
            Unadjusted daily OHLC, not total returns. News uses publication
            dates in IST, which can be after market close. Non-trading dates
            remain in the News tab.
          </p>
          <div className="research-table-scroll">
            <table>
              <thead>
                <tr>
                  {["Date", "Open", "High", "Low", "Close", "Volume"].map(
                    (label) => (
                      <th key={label}>{label}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {candles
                  .slice()
                  .reverse()
                  .map((item) => (
                    <tr key={item.time}>
                      <td>{item.time}</td>
                      {["open", "high", "low", "close", "volume"].map((key) => (
                        <td key={key}>
                          {item[key]?.toLocaleString("en-IN") ?? "Unavailable"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="research-attribution">
          Charts by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noreferrer"
          >
            TradingView Lightweight Charts™
          </a>{" "}
          · Copyright © 2025 TradingView, Inc. · Apache 2.0
        </p>
      </div>
      {showNews && (
        <section
          className="chart-news-events"
          aria-label="News events on chart"
        >
          <div className="chart-news-heading">
            <span>
              <Newspaper size={13} aria-hidden="true" />
              On this day
            </span>
            <div>
              <button
                aria-label="Previous news day"
                disabled={activeIndex <= 0}
                onClick={() => activateDay(newsGroups[activeIndex - 1].time)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                aria-label="Next news day"
                disabled={
                  activeIndex < 0 || activeIndex === newsGroups.length - 1
                }
                onClick={() => activateDay(newsGroups[activeIndex + 1].time)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          {selectedNews ? (
            <>
              <div className="chart-news-day">
                <time dateTime={activeDay}>
                  {new Date(activeDay + "T12:00:00Z").toLocaleDateString(
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
                  {selectedNews.articles.length}{" "}
                  {selectedNews.articles.length === 1 ? "story" : "stories"}
                </span>
              </div>
              <div className="chart-news-detail" aria-live="polite">
                <ul>
                  {selectedNews.articles.map((item, i) => (
                    <li key={item.url || i}>
                      <NewsStory article={item} />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="chart-news-empty">
              <Newspaper size={26} aria-hidden="true" />
              <h4>No events in this view</h4>
              <p>
                Try All news or another timeframe. Headlines on non-trading
                dates stay in the News tab.
              </p>
            </div>
          )}
          <button className="chart-all-news" onClick={onOpenNews}>
            View all company news
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </section>
      )}
    </div>
  );
}
