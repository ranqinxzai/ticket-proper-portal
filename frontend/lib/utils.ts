import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The chrome spacing tokens from tailwind.config.ts (`top-header`, `px-main-x`,
// `-my-main-y`, `w-sidebar`, `top-rail`) must be known to tailwind-merge, or `cn()`
// can't dedupe them against e.g. `px-4` / `top-0`.
const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: ["header", "main-x", "main-y", "sidebar", "rail"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
