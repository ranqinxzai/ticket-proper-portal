/** Styling for stored `<span data-type="mention">` nodes inside rendered comment /
 *  description HTML. Kept in this tiny module (not the Tiptap editor file) so
 *  read-only surfaces — the portal conversation, the print sheet — can style
 *  mentions without pulling the editor bundle. The class literals live here so
 *  Tailwind scans them. */

/** On-screen chip: pale brand tint + AA-safe brand ink (`text-primary-ink`). */
export const MENTION_CHIP_CLS =
  "[&_span[data-type=mention]]:rounded [&_span[data-type=mention]]:bg-primary/10 [&_span[data-type=mention]]:px-1 [&_span[data-type=mention]]:py-px [&_span[data-type=mention]]:font-medium [&_span[data-type=mention]]:text-primary-ink";

/** Print sheet: browsers drop backgrounds when printing and the sheet is black on
 *  white, so a mention is just semibold text (the "@Name" label stays readable). */
export const MENTION_PRINT_CLS = "[&_span[data-type=mention]]:font-semibold";
