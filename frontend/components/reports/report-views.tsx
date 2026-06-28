"use client";

import { cn } from "@/lib/utils";

/** Presentational building blocks shared by the workspace + global report pages.
 * No data fetching here — callers pass already-loaded report rows. */

export type ReportRow = Record<string, unknown>;

/** Categorical palette for chart segments that don't carry their own colour.
 * Maps to the `--chart-*` theme tokens (light + dark variants in globals.css). */
export const CHART_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

export function labelOf(r: ReportRow): string {
  return String(
    r.label ??
      r.status ??
      r.priority ??
      r.group ??
      r.group_name ??
      r.project ??
      r.project_key ??
      r.agent ??
      r.date ??
      "—",
  );
}

export function valueOf(r: ReportRow): number {
  const v = r.value ?? r.n ?? r.count ?? r.total ?? 0;
  return typeof v === "number" ? v : Number(v) || 0;
}

export function ReportCard({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ label = "No data for this period." }: { label?: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{label}</p>;
}

/** Horizontal bar list — one bar per row, scaled to the largest value. */
export function BarList({ rows, capitalize }: { rows: ReportRow[]; capitalize?: boolean }) {
  if (rows.length === 0) return <EmptyState />;
  const max = Math.max(1, ...rows.map(valueOf));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => {
        const v = valueOf(r);
        const color = typeof r.color === "string" ? r.color : undefined;
        return (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "w-28 shrink-0 truncate text-muted-foreground",
                capitalize && "capitalize",
              )}
              title={labelOf(r)}
            >
              {labelOf(r)}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(v / max) * 100}%`,
                  backgroundColor: color ?? "hsl(var(--primary))",
                }}
              />
            </span>
            <span className="w-10 text-right font-medium tabular-nums">{v}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A compact KPI tile. */
export function StatTile({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums", accent)}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Simple data table for the agent-performance report. */
export function MiniTable({
  columns,
  rows,
}: {
  columns: { key: string; header: string; align?: "left" | "right"; fmt?: (v: unknown) => string }[];
  rows: ReportRow[];
}) {
  if (rows.length === 0) return <EmptyState />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn("px-2 py-2 font-medium", c.align === "right" && "text-right")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map((c) => {
                const raw = r[c.key];
                const text = c.fmt ? c.fmt(raw) : raw == null ? "—" : String(raw);
                return (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-2 tabular-nums",
                      c.align === "right" && "text-right",
                      c.key === columns[0].key && "font-medium",
                    )}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lightweight SVG area/line trend — no charting dependency. */
export function TrendChart({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) return <EmptyState />;
  const points = rows.map((r) => ({ date: String(r.date ?? ""), value: valueOf(r) }));
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 100;
  const H = 36;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 4) - 2;

  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const total = points.reduce((s, p) => s + p.value, 0);
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`Trend, total ${total}`}
      >
        <polygon points={area} fill="hsl(var(--primary))" fillOpacity={0.12} />
        <polyline
          points={line}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{first}</span>
        <span className="font-medium text-foreground">Total {total}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

// ── Dashboard "command center" primitives (dependency-free SVG) ──────────────

/** Percentage change between two periods. `null` when there's no baseline. */
export function pctChange(curr: number, prev: number): number | null {
  if (!prev) return curr ? null : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

/** A delta pill — coloured by whether the movement is good. `dir` says which
 * direction is positive: "up-good" (resolved↑), "down-good" (backlog↓), or
 * "neutral" (volume — informational only). */
export function DeltaBadge({
  delta,
  dir = "neutral",
}: {
  delta: number | null;
  dir?: "up-good" | "down-good" | "neutral";
}) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  const flat = delta === 0;
  const good = dir === "neutral" ? null : dir === "up-good" ? up : !up;
  const tone = flat || good == null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", tone)}>
      <span aria-hidden="true">{flat ? "→" : up ? "▲" : "▼"}</span>
      {Math.abs(delta)}%
    </span>
  );
}

/** Tiny inline trend line for KPI cards — no axes, no labels. */
export function Sparkline({ values, color }: { values: number[]; color?: string }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const W = 100;
  const H = 24;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 3) - 1.5;
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const stroke = color ?? "hsl(var(--primary))";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden="true">
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={stroke} fillOpacity={0.1} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Hero KPI tile — big number, optional delta pill, optional sparkline. */
export function KpiCard({
  label,
  value,
  icon,
  delta = null,
  deltaDir = "neutral",
  spark,
  sparkColor,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  delta?: number | null;
  deltaDir?: "up-good" | "down-good" | "neutral";
  spark?: number[];
  sparkColor?: string;
  accent?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
          {label}
        </span>
        <DeltaBadge delta={delta} dir={deltaDir} />
      </div>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums", accent)}>{value}</p>
      {spark && spark.length > 1 ? (
        <div className="mt-2">
          <Sparkline values={spark} color={sparkColor} />
        </div>
      ) : null}
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Donut/pie with a centred total and a value+percent legend. Honours each
 * row's `color` (e.g. status colours) and falls back to the chart palette. */
export function DonutChart({
  rows,
  centerValue,
  centerLabel = "total",
}: {
  rows: ReportRow[];
  centerValue?: string | number;
  centerLabel?: string;
}) {
  const data = rows
    .map((r, i) => ({
      label: labelOf(r),
      value: valueOf(r),
      color: typeof r.color === "string" && r.color ? r.color : CHART_PALETTE[i % CHART_PALETTE.length],
    }))
    .filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <EmptyState />;

  const R = 15.91549431; // circumference = 100 → dasharray maps to percent
  let acc = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label={`Total ${total}`}>
          <circle cx="21" cy="21" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
          {data.map((d, i) => {
            const pct = (d.value / total) * 100;
            const seg = (
              <circle
                key={i}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="4"
                strokeDasharray={`${pct.toFixed(3)} ${(100 - pct).toFixed(3)}`}
                strokeDashoffset={`${(-acc).toFixed(3)}`}
              />
            );
            acc += pct;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{centerValue ?? total}</span>
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.label}>
              {d.label}
            </span>
            <span className="font-medium tabular-nums">{d.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Semicircular gauge for a 0–100 metric (e.g. SLA compliance %). Colour bands:
 * ≥90 success, ≥75 warning, else destructive. */
export function GaugeChart({
  value,
  sub,
}: {
  value: number | null;
  sub?: React.ReactNode;
}) {
  const ARC = Math.PI * 40; // length of the r=40 semicircle path
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color =
    value == null
      ? "hsl(var(--muted-foreground))"
      : pct >= 90
        ? "hsl(var(--success))"
        : pct >= 75
          ? "hsl(var(--warning))"
          : "hsl(var(--destructive))";
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-48">
        <svg viewBox="0 0 100 56" className="w-full" role="img" aria-label={`Compliance ${value ?? "n/a"}%`}>
          <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--muted))" strokeWidth="9" strokeLinecap="round" />
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${((pct / 100) * ARC).toFixed(2)} ${ARC.toFixed(2)}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          <span className="text-3xl font-semibold tabular-nums" style={{ color }}>
            {value == null ? "—" : `${value}%`}
          </span>
        </div>
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Two overlaid area/line series sharing a y-scale (created vs resolved). */
export function DualTrendChart({
  seriesA,
  seriesB,
}: {
  seriesA: { label: string; rows: ReportRow[]; color: string };
  seriesB: { label: string; rows: ReportRow[]; color: string };
}) {
  const mapOf = (rows: ReportRow[]) => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(String(r.date ?? ""), valueOf(r)));
    return m;
  };
  const a = mapOf(seriesA.rows);
  const b = mapOf(seriesB.rows);
  const dates = Array.from(new Set([...a.keys(), ...b.keys()])).filter(Boolean).sort();
  if (dates.length === 0) return <EmptyState />;

  const va = dates.map((d) => a.get(d) ?? 0);
  const vb = dates.map((d) => b.get(d) ?? 0);
  const max = Math.max(1, ...va, ...vb);
  const W = 100;
  const H = 40;
  const n = dates.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 4) - 2;
  const poly = (vals: number[]) => vals.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const totalA = va.reduce((s, v) => s + v, 0);
  const totalB = vb.reduce((s, v) => s + v, 0);

  // Plain render helper (not a component) so DualTrendChart never re-creates a
  // child component type on re-render — see the component-stability QA rule.
  const renderSeries = (vals: number[], color: string, key: string) => (
    <g key={key}>
      <polygon points={`0,${H} ${poly(vals)} ${W},${H}`} fill={color} fillOpacity={0.1} />
      <polyline
        points={poly(vals)}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesA.color }} />
          {seriesA.label}
          <span className="font-medium tabular-nums text-foreground">{totalA}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seriesB.color }} />
          {seriesB.label}
          <span className="font-medium tabular-nums text-foreground">{totalB}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label="Created vs resolved trend">
        {renderSeries(va, seriesA.color, "a")}
        {renderSeries(vb, seriesB.color, "b")}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{dates[0]}</span>
        <span>{dates[dates.length - 1]}</span>
      </div>
    </div>
  );
}

/** Compact "needs attention" count card with a coloured accent + icon. */
export function AlertTile({
  label,
  value,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning" | "info" | "neutral";
  icon?: React.ReactNode;
}) {
  const tones: Record<string, { text: string; ring: string }> = {
    danger: { text: "text-destructive", ring: "border-l-destructive" },
    warning: { text: "text-warning", ring: "border-l-warning" },
    info: { text: "text-primary", ring: "border-l-primary" },
    neutral: { text: "text-foreground", ring: "border-l-border" },
  };
  const t = tones[tone] ?? tones.neutral;
  return (
    <div className={cn("rounded-lg border border-l-4 bg-card p-4 shadow-sm", t.ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", value > 0 ? t.text : "text-muted-foreground")}>
          {value}
        </span>
        {icon ? <span className={cn(value > 0 ? t.text : "text-muted-foreground/60")}>{icon}</span> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
