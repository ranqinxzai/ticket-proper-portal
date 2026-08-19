"""HTML-aware signature / quoted-reply stripping for inbound mail.

``detectors.strip_quotes`` works on the plain-text part and only knows the RFC
``-- `` delimiter plus reply attributions. Real-world Outlook and Gmail
signatures carry none of that: they are a ``<div id="Signature">`` block (or a
run of bold lines with an embedded logo) inside the HTML part, which used to
land in the ticket description verbatim.

``strip_signature`` finds the earliest *cut point* in the raw HTML and truncates
there. It deliberately does NOT rebuild a DOM — truncating mid-tree leaves
unclosed tags, and the ``sanitize_html`` bleach pass that every rich body already
goes through on save re-balances them for us. That keeps this module dependency
free and makes the cut trivially explainable ("everything from offset N on").

Safety rule, shared with ``strip_quotes``: a non-empty input never yields an
empty output. If the cut would remove everything, the original is kept.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

# ── structural markers ───────────────────────────────────────────────────────
# id / class tokens that mail clients put on the signature or the quoted block.
# Matched case-insensitively against each whitespace-separated token, so
# `class="gmail_signature x_foo"` and Outlook's `x_`-prefixed OWA variants hit.
_SIGNATURE_TOKENS = frozenset({
    "signature",                    # Outlook desktop / OWA  <div id="Signature">
    "gmail_signature",              # Gmail web
    "moz-signature",                # Thunderbird
    "ms-outlook-mobile-signature",  # Outlook mobile
    "protonmail_signature",         # Proton Mail
})
_QUOTE_TOKENS = frozenset({
    "gmail_quote", "gmail_quote_container",
    "divrplyfwdmsg",         # Outlook "-----Original Message-----" wrapper
    "appendonsend",          # Outlook: everything after this div is the quoted trail
    "yahoo_quoted",
    "outlookmessageheader",
    "moz-cite-prefix",
})
_ALL_TOKENS = _SIGNATURE_TOKENS | _QUOTE_TOKENS

# Outlook inserts this immediately above the quoted history.
_OUTLOOK_SEPARATOR_IDS = frozenset({"stopspelling"})

# ── built-in text markers ────────────────────────────────────────────────────
# Deliberately minimal: only forms that cannot plausibly open a real sentence.
# Common sign-offs ("Thanks & Regards") are NOT built in — a genuine message can
# end with one before its last real line. Add those per mailbox instead via
# EmailChannel.signature_markers.
_BUILTIN_TEXT_MARKERS = (
    re.compile(r"^\s*--\s*$"),                                   # RFC 3676 delimiter
    re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^\s*_{10,}\s*$"),
    re.compile(r"^\s*(From|Von|De|Sent|Gesendet|An|Betreff):\s", re.IGNORECASE),
    re.compile(r"^\s*Am\b.*\bschrieb\b.*:\s*$", re.IGNORECASE),  # German attribution
    re.compile(r"^\s*(On|Le|El|Il)\b.{0,300}?\b(wrote|a écrit|escribió|ha scritto)\s*:\s*$",
               re.IGNORECASE | re.DOTALL),
)


def compile_markers(markers) -> list[re.Pattern]:
    """Compile the per-channel marker list into line-anchored patterns.

    Each entry is treated as a literal phrase (not a regex — these are typed by
    admins in the mailbox settings UI) that must START a line, case-insensitively.
    Trailing punctuation in the mail is tolerated: "Thanks & Regards" matches
    "Thanks & Regards," and "Thanks & Regards -".
    """
    out: list[re.Pattern] = []
    for raw in markers or []:
        phrase = (raw or "").strip()
        if not phrase:
            continue
        out.append(re.compile(r"^\s*" + re.escape(phrase) + r"\s*[,.:;!-]*\s*$", re.IGNORECASE))
    return out


def _tokens(attrs) -> set[str]:
    """All id/class tokens on a tag, lowercased, with OWA's `x_` prefix removed."""
    found: set[str] = set()
    for name, value in attrs:
        if name not in ("id", "class") or not value:
            continue
        for tok in value.split():
            tok = tok.strip().lower()
            if tok.startswith("x_"):
                tok = tok[2:]
            if tok:
                found.add(tok)
    return found


class _CutFinder(HTMLParser):
    """Records the offset of the first signature/quote boundary in the raw HTML.

    Offsets come from ``getpos()`` mapped back through a line index, because
    ``HTMLParser`` reports (line, col) rather than an absolute position.
    """

    def __init__(self, html: str, text_markers: list[re.Pattern], *, cut_quotes: bool):
        super().__init__(convert_charrefs=True)
        self._line_starts = [0]
        for line in html.splitlines(keepends=True):
            self._line_starts.append(self._line_starts[-1] + len(line))
        self._markers = text_markers
        self._cut_quotes = cut_quotes
        self.cut: int | None = None
        # Text accumulates across inline tags so "Thanks &amp; Regards" split by a
        # <span> still matches; block-level tags flush it as one logical line.
        self._buf = ""
        self._buf_offset: int | None = None
        # Offset of the block element that opened the current logical line. A text
        # marker cuts *there* rather than at the text itself, so we don't leave a
        # dangling "<p>" behind for bleach to clean up.
        self._block_offset: int | None = None

    _BLOCK = frozenset({
        "p", "div", "br", "tr", "table", "li", "ul", "ol", "blockquote", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6", "pre", "td", "th",
    })

    def _offset(self) -> int:
        line, col = self.getpos()
        return self._line_starts[line - 1] + col

    def _mark(self, offset: int) -> None:
        if self.cut is None or offset < self.cut:
            self.cut = offset

    def _flush_text(self) -> None:
        """Test the buffered logical line against the text markers, then reset."""
        text, offset = self._buf, self._buf_offset
        self._buf, self._buf_offset = "", None
        if not text.strip() or offset is None:
            return
        if any(rx.match(text) for rx in self._markers):
            self._mark(offset)

    def handle_starttag(self, tag, attrs):
        if tag in self._BLOCK:
            self._flush_text()
            self._block_offset = self._offset()
        if self.cut is not None:
            return
        toks = _tokens(attrs)
        wanted = _ALL_TOKENS if self._cut_quotes else _SIGNATURE_TOKENS
        if toks & wanted:
            self._mark(self._offset())
            return
        if self._cut_quotes:
            if toks & _OUTLOOK_SEPARATOR_IDS:
                self._mark(self._offset())
                return
            if tag == "blockquote":
                for name, value in attrs:
                    if name == "type" and (value or "").strip().lower() == "cite":
                        self._mark(self._offset())
                        return

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in self._BLOCK:
            self._flush_text()
            self._block_offset = None

    def handle_data(self, data):
        if self.cut is not None:
            return
        if self._buf_offset is None:
            self._buf_offset = self._block_offset if self._block_offset is not None else self._offset()
        self._buf += data

    def close(self):
        super().close()
        self._flush_text()


def strip_signature(html: str, markers=None, *, cut_quotes: bool = True) -> str:
    """Return ``html`` truncated at the first signature / quoted-reply boundary.

    ``markers`` is the channel's extra list of literal sign-off phrases.
    ``cut_quotes=False`` restricts the cut to signature blocks only, leaving a
    quoted history in place.

    Returns the input unchanged when nothing matches, when parsing fails, or
    when the cut would leave no visible content.
    """
    if not html or not html.strip():
        return html

    finder = _CutFinder(html, list(_BUILTIN_TEXT_MARKERS) + compile_markers(markers),
                        cut_quotes=cut_quotes)
    try:
        finder.feed(html)
        finder.close()
    except Exception:  # noqa: BLE001 — malformed mail must never break ingestion
        return html

    if finder.cut is None or finder.cut <= 0:
        return html

    kept = html[:finder.cut].rstrip()
    if not _has_visible_content(kept):
        return html
    return kept


_TAG_RE = re.compile(r"<[^>]*>")


def _has_visible_content(html: str) -> bool:
    """True if the truncated fragment still carries text or an image."""
    if re.search(r"<img\b", html, re.IGNORECASE):
        return True
    return bool(_TAG_RE.sub(" ", html).replace("&nbsp;", " ").strip())
