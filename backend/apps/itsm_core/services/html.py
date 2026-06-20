"""HTML sanitization for rich-text bodies (ticket descriptions, comments,
canned notes, email templates).

Tiptap emits clean HTML, but we never trust the client: every rich body is run
through ``sanitize_html`` on save so the frontend can render the stored markup
with ``dangerouslySetInnerHTML`` safely. ``html_to_text`` produces the plain
mirror used for search and notification previews.
"""

from __future__ import annotations

import bleach

ALLOWED_TAGS = [
    "p", "br", "hr", "div", "span",
    "strong", "b", "em", "i", "u", "s", "strike", "code", "pre",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "mark",
]

ALLOWED_ATTRIBUTES = {
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "span": ["data-type", "data-id", "data-label", "class"],  # @mention nodes
    "code": ["class"],
    "pre": ["class"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
    "*": ["class"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def sanitize_html(raw: str | None) -> str:
    """Strip scripts / event handlers / disallowed tags from a rich-text body."""
    if not raw:
        return ""
    cleaned = bleach.clean(
        raw,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    return cleaned.strip()


def html_to_text(raw: str | None) -> str:
    """Flatten HTML to a plain-text mirror (search / notification preview)."""
    if not raw:
        return ""
    return bleach.clean(raw, tags=[], attributes={}, strip=True).strip()
