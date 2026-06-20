/** Pick the higher-contrast text color (near-black or white) for a given hex
 * background, so workspace/status color chips stay WCAG AA regardless of the
 * configured color. Returns a hex string suitable for an inline `color` style. */

const BLACK = "#0b1020";
const WHITE = "#ffffff";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((x) => x + x).join("") : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 0;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Best-contrast foreground for a hex background. */
export function readableOn(hex: string | undefined | null): string {
  if (!hex) return WHITE;
  const bg = luminance(hex);
  return ratio(luminance(BLACK), bg) >= ratio(luminance(WHITE), bg) ? BLACK : WHITE;
}
