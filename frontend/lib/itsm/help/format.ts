/** Formatting helpers for hover help (tooltips / `title` attributes). */

/** "18 Oct 2026, 14:30" in the viewer's locale; "" for empty / invalid input. */
export function fullDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** 245 → "4h 5m", 45 → "45m", 2880 → "2d". */
export function humanMinutes(mins?: number | null): string {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return "";
  const m = Math.round(Math.abs(mins));
  if (m < 60) return `${m}m`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", r ? `${r}m` : ""].filter(Boolean).join(" ");
}
