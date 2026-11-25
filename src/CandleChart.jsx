import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";
export default function CandleChart({ candles, dividends }) {
  const container = useRef(null),
    chartRef = useRef(null);
  const [reading, setReading] = useState(
    "Move the crosshair over a candle for OHLC and volume.",
  );
  useEffect(() => {
    setReading("Move the crosshair over a candle for OHLC and volume.");
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
    const times = new Set(candles.map((item) => item.time));
    const markers = createSeriesMarkers(
      prices,
      (dividends || [])
        .filter((item) => times.has(item.exDate))
        .slice()
        .sort((a, b) => a.exDate.localeCompare(b.exDate))
        .map((item) => ({
          time: item.exDate,
          position: "belowBar",
          color: "#7bb5ee",
          shape: "circle",
          text: `D ₹${item.amount}`,
        })),
    );
    chart.subscribeCrosshairMove((event) => {
      const price = event.seriesData.get(prices),
        volume = event.seriesData.get(volumes);
      if (!price || !("open" in price)) return;
      setReading(
        `O ${price.open.toFixed(2)} · H ${price.high.toFixed(2)} · L ${price.low.toFixed(2)} · C ${price.close.toFixed(2)} · Volume ${volume?.value?.toLocaleString("en-IN") ?? "unavailable"}`,
      );
    });
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() =>
      chart.applyOptions({ width: element.clientWidth }),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, dividends]);
  return (
    <>
      <div className="candle-controls">
        <span>Daily candles · INR · Volume</span>
        <button onClick={() => chartRef.current?.timeScale().fitContent()}>
          Fit chart
        </button>
      </div>
      <div className="candle-reading">{reading}</div>
      <div
        ref={container}
        className="candle-chart"
        role="img"
        aria-label="Interactive candlestick and volume chart"
      />
      <p className="research-note">
        Scroll or pinch to zoom; drag to pan. D marks a reported ex-dividend
        date. Prices are unadjusted daily OHLC, not total returns.
      </p>
      <details className="research-chart-data">
        <summary>Accessible price data ({candles.length} sessions)</summary>
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
        Charts powered by{" "}
        <a
          href="https://www.tradingview.com/lightweight-charts/"
          target="_blank"
          rel="noreferrer"
        >
          TradingView Lightweight Charts™
        </a>{" "}
        · Copyright © 2025 TradingView, Inc. · Apache 2.0
      </p>
    </>
  );
}
