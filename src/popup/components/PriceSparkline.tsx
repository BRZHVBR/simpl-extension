// Lightweight dependency-free SVG sparkline for the asset price chart.
// Normalizes points into a responsive viewBox and draws a single polyline.

import type { PricePoint } from "../../core/prices/price-history.service";

type PriceSparklineProps = {
  points: PricePoint[];
  // Drawn in green when the range change is positive, red when negative.
  positive: boolean;
  height?: number;
};

const VIEW_W = 300;

export function PriceSparkline({
  points,
  positive,
  height = 100,
}: PriceSparklineProps) {
  if (points.length < 2) return null;

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  // Leave 6px vertical padding so the stroke is never clipped at the edges.
  const padY = 6;
  const usableH = height - padY * 2;
  const stepX = VIEW_W / (points.length - 1);

  const coords = points.map((point, index) => {
    const x = index * stepX;
    const y = padY + (1 - (point.price - min) / span) * usableH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = `M ${coords.join(" L ")}`;
  const areaPath = `${linePath} L ${VIEW_W},${height} L 0,${height} Z`;
  const stroke = positive ? "#5d8f3f" : "#a83939";
  const fill = positive ? "rgba(93,143,63,0.08)" : "rgba(168,57,57,0.07)";

  return (
    <svg
      className="price-sparkline"
      viewBox={`0 0 ${VIEW_W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={areaPath} fill={fill} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default PriceSparkline;
