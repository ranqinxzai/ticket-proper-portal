/** Slug helpers for KB authoring. The backend `slug` field is a required, globally
 *  unique `SlugField` and is NOT auto-generated, so the client derives it from the
 *  title/name and disambiguates on a uniqueness collision. */

/** Lowercase, hyphenated, alphanumeric slug derived from arbitrary text. */
export function slugify(text: string): string {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Append a short random suffix to an existing slug (used to retry on a 409/400
 *  uniqueness collision). Kept within the backend's 60-char SlugField cap. */
export function withSlugSuffix(slug: string): string {
  const rand = Math.random().toString(36).slice(2, 6);
  const base = (slug || "item").slice(0, 60 - rand.length - 1).replace(/-+$/g, "");
  return `${base}-${rand}`;
}
