"use client";

/** Lightweight, dependency-free charts (SVG/CSS) for dashboards + reports. */

import { cn } from "@/lib/utils";

const PALETTE = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"];

export type Series = { label: string; value: number; color?: string }[];

export function KpiCard({ value, label, accent }: { value: number | string | null; label: string; accent?: string }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-lg border bg-white p-4">
      <div className="text-3xl font-semibold" style={{ color: accent ?? "#111827" }}>
        {value ?? "—"}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function BarChart({ data, height = 180 }: { data: Series; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.length === 0 && <Empty />}
      {data.map((d, i) => (
        <div key={d.label + i} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-xs tabular-nums text-muted-foreground">{d.value}</span>
          <div
            className="w-full rounded-t"
            style={{
              height: `${(d.value / max) * (height - 30)}px`,
              background: d.color ?? PALETTE[i % PALETTE.length],
              minHeight: 2,
            }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="max-w-full truncate text-[10px] text-muted-foreground" title={d.label}>
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PieChart({ data, size = 160 }: { data: Series; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty />;
  const r = size / 2;
  const cx = r;
  const cy = r;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const color = d.color ?? PALETTE[i % PALETTE.length];
    return { path: `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`, color, label: d.label, value: d.value };
  });
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1} />
        ))}
      </svg>
      <ul className="space-y-1 text-xs">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-1 font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type TrendSeries = { name: string; color: string; points: { date: string; value: number }[] }[];

export function TrendChart({ series, height = 200, width = 480 }: { series: TrendSeries; height?: number; width?: number }) {
  const allDates = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.date)))).sort();
  if (allDates.length === 0) return <Empty />;
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const pad = 24;
  const xFor = (i: number) => pad + (i / Math.max(1, allDates.length - 1)) * (width - pad * 2);
  const yFor = (v: number) => height - pad - (v / max) * (height - pad * 2);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e5e7eb" />
        {series.map((s) => {
          const byDate = new Map(s.points.map((p) => [p.date, p.value]));
          const pts = allDates.map((d, i) => `${xFor(i)},${yFor(byDate.get(d) ?? 0)}`).join(" ");
          return <polyline key={s.name} points={pts} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
      </svg>
      <div className="mt-1 flex gap-3 text-xs">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GaugePct({ pct, label }: { pct: number | null; label: string }) {
  const v = pct ?? 0;
  const color = v >= 90 ? "#22c55e" : v >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-white p-4">
      <div className="relative grid place-items-center">
        <svg width={120} height={120} viewBox="0 0 120 120">
          <circle cx={60} cy={60} r={50} fill="none" stroke="#e5e7eb" strokeWidth={10} />
          <circle
            cx={60} cy={60} r={50} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round"
            strokeDasharray={`${(v / 100) * 314} 314`} transform="rotate(-90 60 60)"
          />
        </svg>
        <span className="absolute text-xl font-semibold">{pct == null ? "—" : `${v}%`}</span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty() {
  return <div className={cn("grid h-full w-full place-items-center text-xs text-muted-foreground")}>No data</div>;
}

export { PALETTE };
