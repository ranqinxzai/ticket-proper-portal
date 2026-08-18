"""Keyword → project routing for a shared mailbox.

A mailbox (``EmailChannel``) keeps its ``project`` as the *fallback* project and can
carry an ordered list of ``EmailRoutingRule`` rows. ``resolve_target`` picks the project
a new inbound ticket lands in: the first active rule whose keywords match the mail's
subject/body wins; otherwise the fallback project. The set of projects a mailbox *serves*
(``served_projects``) is derived from the same source — fallback ∪ active-rule targets —
and is what inbound threading and outbound transport scan across.

Matching is **whole-word / phrase, case-insensitive** (word-boundary, like the ticket-key
matcher in ``threading``), NOT raw substring — so ``access``
matches the word "access" but
not "accessory", while ``password reset`` still matches the phrase. HTML-only mail leaves
``parsed.body_text`` blank, so we derive text from ``body_html`` when needed.
"""

from __future__ import annotations

import re

from apps.itsm_core.services.html import html_to_text

# Cap how much body text we scan — routing keywords live near the top, and
# ``max_size_bytes`` allows multi-MB mail we don't want to regex end-to-end.
_MAX_SCAN_CHARS = 16_000

# Cache compiled keyword patterns (keyword string is the key). Bounded by the number of
# distinct keywords an org configures — tiny in practice.
_PATTERN_CACHE: dict[str, re.Pattern] = {}


def _keyword_pattern(keyword: str) -> re.Pattern | None:
    """Compile a whole-word / phrase, case-insensitive matcher for one keyword.

    Internal runs of whitespace collapse to ``\\s+`` so a configured phrase matches
    regardless of how the email wraps it; the ``(?<!\\w)…(?!\\w)`` guards stop a match
    inside a longer word (``access`` ≠ "accessory"). Returns ``None`` for a blank keyword.
    """
    kw = (keyword or "").strip().lower()
    if not kw:
        return None
    cached = _PATTERN_CACHE.get(kw)
    if cached is not None:
        return cached
    body = r"\s+".join(re.escape(part) for part in kw.split())
    pattern = re.compile(rf"(?<!\w){body}(?!\w)", re.IGNORECASE)
    _PATTERN_CACHE[kw] = pattern
    return pattern


def _text_for(parsed, match_in: str) -> str:
    """The (lower-cased, capped) text a rule scans, per its ``match_in``.

    HTML-only (or empty-text-part) mail leaves ``body_text`` blank/whitespace, so we
    derive plain text from the HTML when the text part carries no real content.
    """
    subject = parsed.subject or ""
    body = (parsed.body_text or "").strip() or html_to_text(parsed.body_html or "")
    if match_in == "subject":
        text = subject
    elif match_in == "body":
        text = body
    else:  # subject_body
        text = f"{subject}\n{body}"
    return text[:_MAX_SCAN_CHARS].lower()


def rule_matches(rule, parsed) -> bool:
    """Does ``parsed`` satisfy ``rule``? Empty / all-blank keyword list ⇒ never matches."""
    patterns = [p for kw in (rule.keywords or []) if (p := _keyword_pattern(kw)) is not None]
    if not patterns:
        return False
    text = _text_for(parsed, rule.match_in)
    if not text:
        return False
    if rule.match_type == "all":
        return all(p.search(text) for p in patterns)
    return any(p.search(text) for p in patterns)


def _active_rules(channel):
    """Live, active routing rules for a channel, in evaluation order, with a live target.

    A soft-deleted / archived ``target_project`` bypasses the DB ``PROTECT``, so we filter
    it out here (and in the serializer) rather than trust the FK constraint.
    """
    return list(
        channel.routing_rules.filter(is_active=True, is_deleted=False)
        .select_related("target_project")
        .order_by("order", "created_at")
    )


def allowed_projects(channel) -> list:
    """The projects a mailbox is ALLOWED to create/serve tickets in — the whitelist.

    Read from ``EmailChannelProject`` (live rows, live target), order-stable. A channel with
    NO rows is treated as ``[channel.project]`` (backward compatible with mailboxes created
    before the whitelist existed / before the backfill migration ran). This is the ceiling:
    inbound mail can never open a ticket outside it.
    """
    out: list = []
    seen: set = set()
    for link in (channel.allowed_project_links.filter(is_deleted=False)
                 .select_related("project").order_by("created_at")):
        p = link.project
        if p is None or p.is_deleted or p.pk in seen:
            continue
        seen.add(p.pk)
        out.append(p)
    if not out:  # legacy / un-backfilled channel ⇒ the fallback project alone
        fallback = channel.project
        if fallback is not None and not fallback.is_deleted:
            out.append(fallback)
    return out


def resolve_target(channel, parsed):
    """Return ``(project, matched_rule)`` for a new inbound ticket.

    First active rule (by order) whose keywords match AND whose ``target_project`` is in the
    channel's whitelist wins → its target; no match → the channel's fallback ``project``.
    A rule whose target is not allowed is skipped, so email can NEVER file outside the
    whitelist even if a stale rule survives.
    """
    allowed_ids = {p.pk for p in allowed_projects(channel)}
    for rule in _active_rules(channel):
        target = rule.target_project
        if target is None or target.is_deleted or target.pk not in allowed_ids:
            continue
        if rule_matches(rule, parsed):
            return target, rule
    return channel.project, None


def served_projects(channel) -> list:
    """The projects inbound threading + outbound transport scan across = the whitelist."""
    return allowed_projects(channel)


def served_project_keys(channel) -> list[str]:
    return [p.key for p in served_projects(channel)]
