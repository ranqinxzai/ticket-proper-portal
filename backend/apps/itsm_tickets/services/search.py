"""Ticket search (G6): Postgres full-text + pg_trgm typo tolerance, ranked.

Used by the agent queue (`GET tickets/?search=`), the "Linked issues" picker and
`tickets/pulse/` (same WHERE, no ranking). The KB reuses the primitives here
(`apps.itsm_knowledge.search`).

**Matching** (OR of arms, AND-ed onto the caller's already helpdesk/project-scoped
and filtered queryset — search can never widen scope, rule 15):

- *Substring* (today's DRF ``SearchFilter`` semantics, so nothing that matched before
  stops matching): every whitespace term must ``icontains`` one of ticket number /
  summary / description. Queries shorter than ``MIN_FUZZY_LEN`` (1–2 chars) only
  look at ticket number + summary and skip the fuzzy arms below (graceful, cheap).
- *Ticket number*: ``#42`` / ``ITINC-42`` / ``itinc 42`` normalise to ``ITINC42``
  (exact), and a moved ticket's old number (``TicketNumberAlias``) finds it.
- *Full text* (≥3 chars): stemmed, prefix-matched words over summary + description
  (``printers disconnected`` finds "printer keeps disconnecting").
- *Typo tolerant* (≥3 chars): ``UPPER(summary) %> term`` — pg_trgm word similarity
  ≥ ``pg_trgm.word_similarity_threshold`` (0.6), e.g. ``printr`` → "Printer jammed".
- *Comments* (≥3 chars, full text only): public comments for everyone; internal notes
  only when ``include_private_comments`` (callers pass the
  ``itsm.tickets.comments_private`` read bit, mirroring the comments endpoint).

**Ranking** (only when the caller kept the default sort — see ``RankedSearchFilter``):
exact ticket number / alias, then number prefix, then a digits-only number suffix
(``42`` → ITINC42 before ITINC142), then full-text rank (summary weight A >
description B), then trigram similarity, then the view's default order.

**Indexes / multi-tenancy:** the vector/UPPER expressions below are mirrored by the
GIN indexes on ``Ticket``/``Comment`` (``models.py``; a test asserts they are equal —
Postgres only uses an expression index when the query expression is identical). The
``gin_trgm_ops`` opclass and ``%>``/``word_similarity`` come from pg_trgm, which
migration ``itsm_tickets/0011_search`` installs **WITH SCHEMA public** (database-wide,
visible to every tenant because django-tenants' search_path is ``<tenant>, public``).
Every arm is index-capable (no correlated subquery inside the OR), so Postgres can
BitmapOr the indexes instead of computing ``to_tsvector`` row by row.
"""

from __future__ import annotations

import functools
import operator
import re

from django.contrib.postgres.search import (
    SearchQuery,
    SearchRank,
    SearchVector,
    TrigramWordSimilarity,
)
from django.db.models import Case, FloatField, IntegerField, Q, Value, When
from django.db.models.functions import Left, Upper
from rest_framework.filters import SearchFilter
from rest_framework.settings import api_settings

FTS_CONFIG = "english"
# Below this many characters a query is substring-only (no FTS / trigram / comments).
MIN_FUZZY_LEN = 3
# Mirrors models.SEARCH_TEXT_CAP (to_tsvector errors on >1 MB vectors).
FTS_TEXT_CAP = 100_000
MAX_TERM_LEN = 200
MAX_TOKENS = 8
# Most tickets a comment-text match may contribute to one search (keeps the IN list sane).
COMMENT_MATCH_CAP = 1000

_TOKEN_RE = re.compile(r"[^\W_]+")          # letters/digits only → never tsquery syntax
_NUMBER_SEP_RE = re.compile(r"[\s\-_#]+")
_NUMBER_RE = re.compile(r"[A-Za-z]{0,20}\d{1,12}")


# ── shared primitives (also used by apps.itsm_knowledge.search) ─────────────────
def normalize_term(raw) -> str:
    """Trim, drop NULs, collapse whitespace and cap the length of a search string."""
    if not raw:
        return ""
    term = " ".join(str(raw).replace("\x00", "").split())
    return term[:MAX_TERM_LEN]


def prefix_tsquery(term: str):
    """A safe prefix ``to_tsquery`` for ``term`` (AND of words), or ``None``.

    Tokens are letters/digits only, so user input can never produce tsquery syntax
    errors. 1-char tokens are dropped (``c++`` would otherwise prefix-match every
    "c…" word); 2-char tokens match exactly; longer ones as prefixes (``vp`` exact,
    ``passw`` → password)."""
    tokens = []
    for tok in _TOKEN_RE.findall(term.lower()):
        if len(tok) < 2:
            continue
        tokens.append(f"{tok}:*" if len(tok) >= 3 else tok)
        if len(tokens) >= MAX_TOKENS:
            break
    if not tokens:
        return None
    return SearchQuery(" & ".join(tokens), search_type="raw", config=FTS_CONFIG)


def substring_q(terms, fields) -> Q:
    """DRF-SearchFilter semantics: every term must ``icontains`` at least one field."""
    per_term = [functools.reduce(operator.or_, (Q(**{f"{f}__icontains": t}) for f in fields))
                for t in terms]
    return functools.reduce(operator.and_, per_term)


def has_explicit_ordering(request, view) -> bool:
    """True when the request picked a sort other than the view's default.

    The queue always sends its default (``ordering=-created_at``), so an ordering equal
    to ``view.ordering`` still counts as "not sorted" and gets relevance order."""
    raw = request.query_params.get(api_settings.ORDERING_PARAM) or ""
    terms = [t.strip() for t in raw.split(",") if t.strip()]
    if not terms:
        return False
    default = getattr(view, "ordering", None) or []
    if isinstance(default, str):
        default = [default]
    return terms != list(default)


class RankedSearchFilter(SearchFilter):
    """``SearchFilter`` replacement backed by a ``run_search`` function.

    Put it AFTER the ordering backend in ``filter_backends``: the WHERE always applies,
    and on ``list`` with the default sort it re-orders by ``relevance_ordering`` (then
    the view's default order). An explicit user sort is kept as-is. Other actions
    (``pulse``, detail lookups) get the WHERE only, without the ranking cost."""

    relevance_ordering: tuple[str, ...] = ()

    def run_search(self, queryset, term, request, view, *, rank):  # pragma: no cover
        raise NotImplementedError

    def filter_queryset(self, request, queryset, view):
        term = normalize_term(request.query_params.get(self.search_param, ""))
        if not term:
            return queryset
        rank = getattr(view, "action", None) == "list" and not has_explicit_ordering(request, view)
        qs = self.run_search(queryset, term, request, view, rank=rank)
        if rank:
            default = getattr(view, "ordering", None) or list(qs.model._meta.ordering)
            if isinstance(default, str):
                default = [default]
            qs = qs.order_by(*self.relevance_ordering, *default)
        return qs


# ── tickets ──────────────────────────────────────────────────────────────────────
def ticket_fts_vector():
    """The WHERE vector — identical to the ``itsm_tkt_search_fts`` index expression."""
    return SearchVector("summary", Left("description_text", FTS_TEXT_CAP), config=FTS_CONFIG)


def ticket_rank_vector():
    """Weighted vector for ranking only (summary A, description B); not indexed."""
    return (SearchVector("summary", weight="A", config=FTS_CONFIG)
            + SearchVector(Left("description_text", FTS_TEXT_CAP), weight="B", config=FTS_CONFIG))


def comment_fts_vector():
    """Identical to the ``itsm_cmt_body_fts`` index expression."""
    return SearchVector(Left("body_text", FTS_TEXT_CAP), config=FTS_CONFIG)


def number_term(term: str) -> str | None:
    """``#42`` / ``ITINC-42`` / ``itinc 42`` → ``ITINC42`` (or ``42``); else ``None``."""
    if len(term.split()) > 2:
        return None
    compact = _NUMBER_SEP_RE.sub("", term)
    if compact and _NUMBER_RE.fullmatch(compact):
        return compact.upper()
    return None


RELEVANCE_TICKET_ORDER = ("-search_number_rank", "-search_rank", "-search_similarity")


def search_tickets(qs, raw_term, *, include_private_comments=False, rank=False):
    """Filter ``qs`` (already scoped) by ``raw_term``; with ``rank`` also annotate
    ``search_number_rank`` / ``search_rank`` / ``search_similarity`` (order by
    ``RELEVANCE_TICKET_ORDER``)."""
    from apps.itsm_tickets.models import Comment, TicketNumberAlias

    term = normalize_term(raw_term)
    if not term:
        return qs
    terms = term.split()
    fuzzy = len(term) >= MIN_FUZZY_LEN
    fields = ("ticket_number", "summary", "description_text") if fuzzy else ("ticket_number", "summary")
    match = substring_q(terms, fields)

    number = number_term(term)
    alias_ids: list = []
    if number:
        match |= Q(ticket_number__iexact=number)
        alias_ids = list(TicketNumberAlias.objects.filter(old_number__iexact=number)
                         .values_list("ticket_id", flat=True)[:50])
        if alias_ids:
            match |= Q(pk__in=alias_ids)

    query = prefix_tsquery(term) if fuzzy else None
    if fuzzy:
        if query is not None:
            # Comment matches, restricted to the caller's scoped tickets BEFORE the cap.
            visibility = ["public", "private"] if include_private_comments else ["public"]
            comment_ids = list(
                Comment.objects.filter(
                    is_deleted=False, visibility__in=visibility,
                    ticket_id__in=qs.order_by().values("pk"),
                )
                .alias(search_fts=comment_fts_vector())
                .filter(search_fts=query)
                .order_by().values_list("ticket_id", flat=True).distinct()[:COMMENT_MATCH_CAP]
            )
            qs = qs.alias(search_fts=ticket_fts_vector())
            match |= Q(search_fts=query)
            if comment_ids:
                match |= Q(pk__in=comment_ids)
        qs = qs.alias(search_summary_upper=Upper("summary"))
        match |= Q(search_summary_upper__trigram_word_similar=term)

    qs = qs.filter(match)
    if not rank:
        return qs

    key = number or ("".join(terms) if len(terms) == 1 else None)
    whens = []
    if key:
        exact = Q(ticket_number__iexact=key)
        if alias_ids:
            exact |= Q(pk__in=alias_ids)
        whens.append(When(exact, then=Value(3)))
        whens.append(When(ticket_number__istartswith=key, then=Value(2)))
        if key.isdigit():
            # Digits only: "42" → ITINC42 (the number part equals 42), not ITINC142.
            whens.append(When(ticket_number__iregex=rf"^[^0-9]*{key}$", then=Value(1)))
    number_rank = (Case(*whens, default=Value(0), output_field=IntegerField())
                   if whens else Value(0, output_field=IntegerField()))
    return qs.annotate(
        search_number_rank=number_rank,
        search_rank=(SearchRank(ticket_rank_vector(), query) if query is not None
                     else Value(0.0, output_field=FloatField())),
        search_similarity=(TrigramWordSimilarity(term, "summary") if fuzzy
                           else Value(0.0, output_field=FloatField())),
    )


class TicketSearchFilter(RankedSearchFilter):
    """DRF backend for ``TicketViewSet`` (queue, link picker, pulse)."""

    relevance_ordering = RELEVANCE_TICKET_ORDER

    def run_search(self, queryset, term, request, view, *, rank):
        from apps.itsm_rbac.services import check_permission

        private = check_permission(request.user, "itsm.tickets.comments_private", "read")
        return search_tickets(queryset, term, include_private_comments=private, rank=rank)
