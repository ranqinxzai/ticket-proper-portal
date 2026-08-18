/**
 * Shared form-control styling for the agent ticket Create form and Detail inline
 * editors. Centralised so the two pages stay visually in sync. Refreshed for the
 * "soft & vibrant" look: same radius as the shadcn <Input>, a primary-tinted
 * hover border and a SMOOTH, low-intensity focus glow. Native <select>/<textarea>
 * only — the layout-driven field engine renders these directly.
 */

// A calm focus treatment: a half-strength primary border + a faint, wide glow
// (deliberately softer than the app's default 1px full-colour ring, which read
// too bright on these large fields). `transition-all` fades it in smoothly.
export const focusSoft =
  "focus-visible:outline-none focus-visible:border-ring/50 focus-visible:ring-[3px] focus-visible:ring-ring/15";

export const inputCls =
  `flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-all placeholder:text-muted-foreground hover:border-ring/40 ${focusSoft} disabled:cursor-not-allowed disabled:opacity-50`;

export const selectCls =
  `flex h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-all hover:border-ring/40 ${focusSoft} disabled:cursor-not-allowed disabled:opacity-50`;

export const textareaCls =
  `flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground hover:border-ring/40 ${focusSoft} disabled:cursor-not-allowed disabled:opacity-50`;
