"""HTML sanitization for rich-text bodies (ticket descriptions, comments,
canned notes, email templates, KB articles).

Tiptap emits clean HTML, but we never trust the client: every rich body is run
through ``sanitize_html`` on save so the frontend can render the stored markup
with ``dangerouslySetInnerHTML`` safely. ``html_to_text`` produces the plain
mirror used for search and notification previews.
"""

from __future__ import annotations

import re
from html import unescape as _unescape

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

# Elements whose CONTENT is never body text. bleach(strip=True) drops a disallowed
# tag but keeps what's inside it as text, so Outlook-on-the-web mail
# (`<head><style> P {margin-top:0;margin-bottom:0;} </style>`) showed the CSS at the
# top of the ticket (BUG_LOG 2026-10-29). Removed before bleach, which still does
# the actual sanitising; this is clean-up, not the security boundary.
_NON_CONTENT_BLOCK_RE = re.compile(
    r"<(head|style|script|title|xml|template|noscript)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
# An unclosed <style>/<script> runs to the end of the document (as in a browser).
_UNCLOSED_BLOCK_RE = re.compile(r"<(style|script)\b[^>]*>.*\Z", re.IGNORECASE | re.DOTALL)


def strip_non_content(raw: str | None) -> str:
    """Remove ``<head>``, ``<style>``, ``<script>``, ``<title>``, ``<xml>``,
    ``<template>`` and ``<noscript>`` blocks WITH their contents."""
    if not raw:
        return ""
    return _UNCLOSED_BLOCK_RE.sub("", _NON_CONTENT_BLOCK_RE.sub("", raw))


def sanitize_html(raw: str | None) -> str:
    """Strip scripts / event handlers / disallowed tags from a rich-text body."""
    if not raw:
        return ""
    cleaned = bleach.clean(
        strip_non_content(raw),
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
    return bleach.clean(strip_non_content(raw), tags=[], attributes={}, strip=True).strip()


# ── Plain-text preview (the Modern queue's ticket-number hover card, 2026-11-05c) ──
_PREVIEW_BREAK_RE = re.compile(r"<br\s*/?>|</(?:p|div|li|h[1-6]|blockquote|pre|tr|table)\s*>", re.IGNORECASE)
_PREVIEW_TAG_RE = re.compile(r"<[^>]*>")
_PREVIEW_SPACES_RE = re.compile(r"[ \t\r\f\v\u00a0]+")


def html_to_preview(raw: str | None, limit: int = 300) -> str:
    """The first ``limit`` characters of a rich body as plain text, one line per block.

    For STORED (already sanitised) HTML only — it runs on every queue row, so it uses
    regexes, not bleach: non-content blocks (``<style>`` …) are dropped with their
    text, block ends and ``<br>`` become line breaks, tags are removed, entities
    decoded, spaces collapsed and blank lines dropped. A longer text is cut at a word
    boundary and ends in "…". Plain text passes through unchanged (minus the spacing).
    """
    if not raw:
        return ""
    text = _PREVIEW_BREAK_RE.sub("\n", strip_non_content(raw))
    text = _unescape(_PREVIEW_TAG_RE.sub("", text))
    lines = (_PREVIEW_SPACES_RE.sub(" ", line).strip() for line in text.split("\n"))
    text = "\n".join(line for line in lines if line)
    if len(text) > limit:
        cut = text[:limit]
        space = max(cut.rfind(" "), cut.rfind("\n"))
        if space > limit * 0.6:
            cut = cut[:space]
        text = cut.rstrip(" ,;:.-\n") + "…"
    return text
