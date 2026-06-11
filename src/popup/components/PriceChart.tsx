// src/popup/components/PriceChart.tsx
//
// Interactive financial price chart for the Asset Detail screen, built directly
// on TradingView's `lightweight-charts` (canvas, no remote scripts / widgets —
// safe for a Chrome extension). Renders a smooth area chart by default and a
// candlestick chart when real OHLC candles are supplied. All data is passed in
// by the caller (sourced from the Simpl API Gateway); this component never
// fetches anything itself.

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartPoint = {
  // Epoch milliseconds.
  t: number;
  price: number;
};

export type CandlePoint = {
  // Epoch milliseconds.
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type PriceChartProps = {
  points?: ChartPoint[];
  candles?: CandlePoint[];
  mode?: "area" | "candles";
  height?: number;
  currency?: string;
  // Drives the area chart colour: green when the range is up, red when down.
  positive?: boolean;
  loading?: boolean;
};

// Brand green / red, matching the rest of the wallet's price semantics.
const UP_COLOR = "#16a34a";
const DOWN_COLOR = "#dc2626";
const AXIS_TEXT = "#9aa0a6";
// Barely-there horizontal grid — present for orientation, not for a terminal look.
const GRID_LINE = "rgba(148, 163, 184, 0.06)";

// Adaptive fiat formatting: more decimals for sub-dollar tokens, fewer for
// large prices. Used by both the price axis and the crosshair tooltip.
function formatPrice(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits,
    }).format(value);
  } catch {
    // Unknown currency code — fall back to a plain number.
    return value.toLocaleString("en-US", { maximumFractionDigits });
  }
}

function formatTooltipDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Convert epoch-ms series into ascending, second-unique data the chart accepts.
// lightweight-charts requires strictly increasing, unique time values.
function toUtcSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function dedupeSorted<T extends { time: UTCTimestamp }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const out: T[] = [];
  for (const row of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.time === row.time) {
      out[out.length - 1] = row; // keep the latest sample for that second
    } else {
      out.push(row);
    }
  }
  return out;
}

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  price: string;
};

const HIDDEN_TOOLTIP: TooltipState = {
  visible: false,
  x: 0,
  y: 0,
  date: "",
  price: "",
};

export function PriceChart({
  points,
  candles,
  mode = "area",
  height = 210,
  currency = "usd",
  positive = true,
  loading = false,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area" | "Candlestick"> | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(HIDDEN_TOOLTIP);

  // Latest currency for the crosshair handler without re-subscribing.
  const currencyRef = useRef(currency);
  currencyRef.current = currency;

  const useCandles = mode === "candles" && (candles?.length ?? 0) >= 2;

  // Create the chart once and keep it alive across data updates. A ResizeObserver
  // keeps it filling the card in both popup and fullscreen surfaces.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: AXIS_TEXT,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: GRID_LINE, style: LineStyle.Solid },
      },
      rightPriceScale: {
        // Hidden by default (clean line mode); turned on only for candles where
        // reading levels matters. Toggled per-mode in the data effect below.
        visible: false,
        borderVisible: false,
        // Generous vertical headroom so the line never touches the edges.
        scaleMargins: { top: 0.2, bottom: 0.2 },
        ticksVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: false,
        // Breathing room on the right so the last candle/point isn't jammed
        // against the edge.
        rightOffset: 4,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        // Crosshair appears on hover/drag only; no permanent axis labels in line
        // mode (the floating tooltip carries date + price instead).
        vertLine: { color: AXIS_TEXT, width: 1, style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: AXIS_TEXT, width: 1, style: LineStyle.Dashed, labelVisible: false },
      },
      // Keep it calm inside the card — crosshair stays interactive, but the
      // chart doesn't hijack page scroll / pinch in the popup.
      handleScroll: false,
      handleScale: false,
      localization: {
        priceFormatter: (value: number) => formatPrice(value, currencyRef.current),
      },
    });

    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && chartRef.current) {
        chartRef.current.applyOptions({ width: Math.floor(width) });
        chartRef.current.timeScale().fitContent();
      }
    });
    ro.observe(container);

    chart.subscribeCrosshairMove((param) => {
      const series = seriesRef.current;
      if (
        !series ||
        !param.point ||
        param.time === undefined ||
        !param.seriesData.has(series)
      ) {
        setTooltip((prev) => (prev.visible ? HIDDEN_TOOLTIP : prev));
        return;
      }

      const data = param.seriesData.get(series) as
        | { value?: number; close?: number }
        | undefined;
      const price = data?.value ?? data?.close;
      if (typeof price !== "number") {
        setTooltip((prev) => (prev.visible ? HIDDEN_TOOLTIP : prev));
        return;
      }

      const ms = (param.time as number) * 1000;
      // Clamp so the tooltip stays inside the card near the right/bottom edges.
      const cw = containerRef.current?.clientWidth ?? 0;
      const ch = containerRef.current?.clientHeight ?? 0;
      const x = Math.max(0, Math.min(param.point.x, cw - 132));
      const y = Math.max(0, Math.min(param.point.y, ch - 44));
      setTooltip({
        visible: true,
        x,
        y,
        date: formatTooltipDate(ms),
        price: formatPrice(price, currencyRef.current),
      });
    });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // height is intentionally part of recreation; data is handled separately.
  }, [height]);

  // (Re)build the series whenever the chart mode or data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    setTooltip(HIDDEN_TOOLTIP);

    // Candles get a subtle price axis + crosshair price label (reading levels
    // matters); line mode stays axis-free and relies on the hover tooltip.
    chart.priceScale("right").applyOptions({ visible: useCandles });
    chart.applyOptions({
      crosshair: { horzLine: { labelVisible: useCandles } },
    });

    if (useCandles && candles) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const data = dedupeSorted(
        candles
          .filter(
            (c) =>
              Number.isFinite(c.t) &&
              Number.isFinite(c.open) &&
              Number.isFinite(c.high) &&
              Number.isFinite(c.low) &&
              Number.isFinite(c.close),
          )
          .map((c) => ({
            time: toUtcSeconds(c.t),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
      );
      series.setData(data as Array<{ time: Time; open: number; high: number; low: number; close: number }>);
      seriesRef.current = series;
    } else if (points && points.length >= 2) {
      const lineColor = positive ? UP_COLOR : DOWN_COLOR;
      const series = chart.addSeries(AreaSeries, {
        lineColor,
        lineWidth: 2,
        // Subtle gradient fill; fades fully to transparent at the bottom.
        topColor: positive ? "rgba(22,163,74,0.16)" : "rgba(220,38,38,0.14)",
        bottomColor: positive ? "rgba(22,163,74,0.00)" : "rgba(220,38,38,0.00)",
        // No permanent price line / last-value tag — keeps line mode clean.
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: "#ffffff",
        crosshairMarkerBackgroundColor: lineColor,
      });
      const data = dedupeSorted(
        points
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
          .map((p) => ({ time: toUtcSeconds(p.t), value: p.price })),
      );
      series.setData(data as Array<{ time: Time; value: number }>);
      seriesRef.current = series;
    }

    chart.timeScale().fitContent();
  }, [useCandles, candles, points, positive]);

  return (
    <div className="price-chart" style={{ height }}>
      <div ref={containerRef} className="price-chart__canvas" style={{ height }} />
      {tooltip.visible ? (
        <div
          className="price-chart__tooltip"
          style={{
            transform: `translate(${tooltip.x}px, ${tooltip.y}px)`,
          }}
        >
          <div className="price-chart__tooltip-price">{tooltip.price}</div>
          <div className="price-chart__tooltip-date">{tooltip.date}</div>
        </div>
      ) : null}
      {loading ? <div className="price-chart__loading">Loading chart…</div> : null}
    </div>
  );
}

export default PriceChart;
