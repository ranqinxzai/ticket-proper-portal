/** Pure helpers shared by the asset screens (no React). */

import { ItsmApiError } from "@/lib/itsm/client";
import type { AssetFilters, AssetUserRef } from "@/lib/itsm/assets-types";
import type { ReadonlyURLSearchParams } from "next/navigation";

/** Filter keys kept in the URL (list, report and dashboard drill-through). */
export const FILTER_KEYS = [
  "search",
  "category",
  "sub_category",
  "status",
  "state_type",
  "location",
  "department",
  "vendor",
  "assigned_user",
  "warranty",
  "expiry",
  "purchased_from",
  "purchased_to",
  "import",
] as const satisfies readonly (keyof AssetFilters)[];

export type FilterKey = (typeof FILTER_KEYS)[number];
export type FilterValues = Partial<Record<FilterKey, string>>;

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Read the filters from the URL (unknown keys ignored, blanks dropped). */
export function filtersFromParams(sp: URLSearchParams | ReadonlyURLSearchParams): FilterValues {
  const out: FilterValues = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) out[k] = v;
  }
  return out;
}

export function hasFilters(f: FilterValues): boolean {
  return FILTER_KEYS.some((k) => !!f[k]);
}

/** Build a `?a=b` query string from a flat record (blank values dropped). */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Asset list URL with filters, e.g. `assetListHref(base, { state_type: "in_use" })`. */
export function assetListHref(base: string, filters: FilterValues = {}): string {
  return `${base}/assets/list${toQuery(filters)}`;
}

/** Positive page number from the URL, default 1. */
export function intParam(raw: string | null, fallback: number, allowed?: readonly number[]): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  const v = Math.floor(n);
  if (allowed && !allowed.includes(v)) return fallback;
  return v;
}

/** The best single message from an API error: a DRF `{"detail": [msg]}` or `{field: [msg]}`
 *  body otherwise reaches us as "detail: msg" (see `client.extractError`). */
export function apiMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ItsmApiError)) return fallback;
  const fe = e.fieldErrors;
  if (fe?.detail?.[0]) return fe.detail[0];
  if (fe && /^[\w.]+: /.test(e.message)) {
    const first = Object.values(fe).find((v) => Array.isArray(v) && v.length)?.[0];
    if (first) return first;
  }
  return e.message || fallback;
}

/** First field error for `key`, if any. */
export function fieldErr(bag: Record<string, string[]> | undefined, key: string): string | undefined {
  const v = bag?.[key];
  return Array.isArray(v) ? v[0] : undefined;
}

// ── Dates & money ────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the browser's time zone (the API judges on the org's). */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "12 Nov 2026" for a YYYY-MM-DD date (no time-zone shift); "—" when empty. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** "12 Nov 2026, 14:30" for a datetime; "—" when empty. */
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Whole days from today to `iso` (negative = in the past). */
export function daysUntil(iso?: string | null, today = todayIso()): number | null {
  if (!iso) return null;
  const a = parseIsoDate(today);
  const b = parseIsoDate(iso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type DateTone = "expired" | "soon" | "ok" | "none";

/** Warranty / expiry colouring: ended (before today), within 30 days, or fine. */
export function dateTone(iso?: string | null, today = todayIso()): DateTone {
  const d = daysUntil(iso, today);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d <= 30) return "soon";
  return "ok";
}

/** "45,000.00" — no currency (the API stores a bare 2-decimal amount). */
export function fmtMoney(v?: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function userLabel(u?: AssetUserRef | { full_name?: string; username?: string } | null): string {
  if (!u) return "";
  return (u.full_name || "").trim() || u.username || "";
}

// ── Import rows ──────────────────────────────────────────────────────────────

const IMPORT_ALIASES = {
  name: ["asset name", "name", "asset"],
  asset_tag: ["asset tag", "tag", "asset id", "asset number"],
  category: ["category"],
  sub_category: ["sub-category", "sub category", "subcategory"],
} as const;

function normHeader(h: string): string {
  return h.replace(/\*/g, " ").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** A failed import row's raw cell for a core column. `data` is keyed by the file's own
 *  header text (e.g. "Asset Name *"), so match the importer's header aliases. */
export function importCell(data: Record<string, string>, key: keyof typeof IMPORT_ALIASES): string {
  const wanted: readonly string[] = IMPORT_ALIASES[key];
  for (const [h, v] of Object.entries(data ?? {})) {
    if (wanted.includes(normHeader(h))) return v ?? "";
  }
  return "";
}
