import React, { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  type Time,
} from "lightweight-charts";
import type { Detail } from "./types";
export default function StructureChart({ detail }: { detail: Detail }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: 470,
      layout: {
        background: { color: "#101a24" },
        textColor: "#9fb0c0",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1d2b38" },
        horzLines: { color: "#1d2b38" },
      },
      localization: { locale: "en-IN" },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#a4d17a",
      downColor: "#ef8e93",
      wickUpColor: "#a4d17a",
      wickDownColor: "#ef8e93",
      borderVisible: false,
    });
    candle.setData(
      detail.series.map((row) => ({
        time: row.time as Time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      })),
    );
    for (const [key, color] of [
      ["ema20", "#dfc379"],
      ["sma50", "#79b8e3"],
      ["sma200", "#b49ae1"],
    ] as const) {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: key.toUpperCase(),
      });
      series.setData(
        detail.series
          .filter((row) => row[key] != null)
          .map((row) => ({ time: row.time as Time, value: row[key]! })),
      );
    }
    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );
    volume.setData(
      detail.series
        .filter((row) => row.volume != null)
        .map((row) => ({
          time: row.time as Time,
          value: row.volume!,
          color: row.close >= row.open ? "#526e42" : "#86545d",
        })),
    );
    chart.panes()[1]?.setHeight(65);
    const relative = chart.addSeries(
      LineSeries,
      {
        color: "#81bbca",
        lineWidth: 1,
        title: "RS / Nifty 500 (100 base)",
        lastValueVisible: false,
        priceLineVisible: false,
      },
      2,
    );
    relative.setData(
      detail.series
        .filter((row) => row.relative_line != null)
        .map((row) => ({ time: row.time as Time, value: row.relative_line! })),
    );
    chart.panes()[2]?.setHeight(80);
    const dates = new Set(detail.series.map((row) => row.time));
    const markerData = detail.events
      .filter(
        (event) =>
          [
            "CHOCH_UP",
            "BOS_UP",
            "CHOCH_DOWN",
            "BOS_DOWN",
            "FAILED_BREAKOUT",
            "RETEST",
          ].includes(event.type) && dates.has(event.date),
      )
      .map((event) => ({
        time: event.date as Time,
        position: "aboveBar" as const,
        shape: "circle" as const,
        color:
          event.type.includes("DOWN") || event.type === "FAILED_BREAKOUT"
            ? "#e79891"
            : "#c4d99a",
        text: event.type
          .replace("_UP", " ↑")
          .replace("_DOWN", " ↓")
          .replace("FAILED_BREAKOUT", "Failed"),
      }));
    markerData.push(
      ...detail.pivots
        .filter((pivot) => dates.has(pivot.confirmed_on))
        .map((pivot) => ({
          time: pivot.confirmed_on as Time,
          position: "aboveBar" as const,
          shape: "circle" as const,
          color: "#718ea9",
          text: pivot.label,
        })),
    );
    markerData.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const markers = createSeriesMarkers(candle, markerData);
    const latest = detail.timeline.at(-1);
    if (latest?.support != null)
      candle.createPriceLine({
        price: latest.support,
        color: "#a4d17a",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Support",
      });
    if (latest?.resistance != null)
      candle.createPriceLine({
        price: latest.resistance,
        color: "#dfc379",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Swing high",
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
    };
  }, [detail]);
  return (
    <>
      <div
        className="sl-chart"
        ref={ref}
        role="img"
        aria-label="Confirmed structure, volume and relative strength chart"
      />
      <p className="sl-note">
        Pivots are marked on their confirmation session, not backdated to the
        swing. Gold: EMA 20 · Blue: SMA 50 · Violet: SMA 200. Bottom pane:
        relative-strength ratio versus Nifty 500, normalized to 100.
      </p>
      <p className="sl-note">
        {detail.price_basis}. Historical levels are rescaled into this chart’s
        as-of price basis.
      </p>
      <p className="sl-note">
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
