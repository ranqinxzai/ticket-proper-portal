/** Page numbers to render in a pager: first, last, current ±1, with "ellipsis"
 *  markers for the gaps. The ticket queue renders the same shape from its own
 *  local copy; point it at this helper the next time that file is touched. */
export function pageList(current: number, total: number): (number | "ellipsis")[] {
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}
