"use client";

import { useMemo, useState } from "react";

interface EquityPoint {
  ts: string;
  equity: number;
}

interface EquityChartProps {
  points: EquityPoint[];
  startingCash: number;
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD_LEFT = 56;
const PAD_RIGHT = 16;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    return [min - 1, min, min + 1];
  }
  const range = max - min;
  const rawStep = range / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function formatCurrency(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EquityChart({ points, startingCash }: EquityChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, areaPath, xForIndex, yForValue, ticks, minV, maxV } = useMemo(() => {
    const values = points.map((p) => p.equity);
    const minV = Math.min(startingCash, ...values);
    const maxV = Math.max(startingCash, ...values);
    const padded = (maxV - minV) * 0.1 || Math.max(startingCash * 0.02, 10);
    const domainMin = minV - padded;
    const domainMax = maxV + padded;

    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

    const xForIndex = (i: number) =>
      points.length <= 1 ? PAD_LEFT : PAD_LEFT + (i / (points.length - 1)) * plotWidth;
    const yForValue = (v: number) =>
      PAD_TOP + plotHeight - ((v - domainMin) / (domainMax - domainMin)) * plotHeight;

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xForIndex(i)},${yForValue(p.equity)}`).join(" ");
    const areaPath =
      points.length > 0
        ? `${path} L${xForIndex(points.length - 1)},${PAD_TOP + plotHeight} L${xForIndex(0)},${PAD_TOP + plotHeight} Z`
        : "";

    const ticks = niceTicks(domainMin, domainMax, 4);

    return { path, areaPath, xForIndex, yForValue, ticks, minV: domainMin, maxV: domainMax };
  }, [points, startingCash]);

  if (points.length < 2) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] text-sm text-[var(--text-muted)]">
        No equity history yet — this fills in once the bot starts running.
      </div>
    );
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const lastPoint = points[points.length - 1];

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
    const ratio = Math.min(1, Math.max(0, (relX - PAD_LEFT) / plotWidth));
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(idx);
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        role="img"
        aria-label={`Equity curve from ${formatCurrency(points[0].equity)} to ${formatCurrency(lastPoint.equity)}`}
      >
        {/* gridlines + y-axis labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yForValue(t)}
              y2={yForValue(t)}
              stroke="var(--chart-gridline)"
              strokeWidth={1}
            />
            <text x={PAD_LEFT - 8} y={yForValue(t)} textAnchor="end" dominantBaseline="middle" className="fill-[var(--text-muted)] text-[10px]">
              {formatCurrency(t)}
            </text>
          </g>
        ))}

        {/* starting-cash baseline */}
        {startingCash >= minV && startingCash <= maxV && (
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={yForValue(startingCash)}
            y2={yForValue(startingCash)}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {/* area wash */}
        <path d={areaPath} fill="var(--series-1)" opacity={0.1} stroke="none" />

        {/* line */}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* end marker + direct label */}
        <circle cx={xForIndex(points.length - 1)} cy={yForValue(lastPoint.equity)} r={4} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />
        <text
          x={xForIndex(points.length - 1) - 6}
          y={yForValue(lastPoint.equity) - 10}
          textAnchor="end"
          className="fill-[var(--text-primary)] text-[11px] font-semibold"
        >
          {formatCurrency(lastPoint.equity)}
        </text>

        {/* hover crosshair */}
        {hovered && (
          <>
            <line
              x1={xForIndex(hoverIndex!)}
              x2={xForIndex(hoverIndex!)}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--text-muted)"
              strokeWidth={1}
            />
            <circle cx={xForIndex(hoverIndex!)} cy={yForValue(hovered.equity)} r={4} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-[var(--chart-border)] bg-[var(--chart-surface)] px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${Math.min(85, Math.max(2, (xForIndex(hoverIndex!) / WIDTH) * 100))}%`,
          }}
        >
          <div className="font-semibold text-[var(--text-primary)]">{formatCurrency(hovered.equity)}</div>
          <div className="text-[var(--text-muted)]">{formatTimestamp(hovered.ts)}</div>
        </div>
      )}
    </div>
  );
}
