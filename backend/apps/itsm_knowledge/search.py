"""Knowledge-base article search (G6): full text + pg_trgm, ranked.

Same model as ticket search (``apps.itsm_tickets.services.search``): a substring arm
(title / summary / body / tags — the old DRF ``search_fields`` behaviour), plus for
queries of 3+ characters a stemmed prefix full-text arm and a typo-tolerant title arm
(``UPPER(title) %> term``). Ranking (default sort only): exact title, title prefix,
full-text rank (title A > summary B > body C), trigram similarity.

The search is AND-ed onto the viewset's queryset, so the portal browse surface still
only ever returns published, portal-visible articles.
"""

from __future__ import annotations

from django.contrib.postgres.search import SearchRank, SearchVector, TrigramWordSimilarity
from django.db.models import Case, FloatField, IntegerField, Q, Value, When
from django.db.models.functions import Left, Upper

from apps.itsm_tickets.services.search import (
    FTS_CONFIG,
    FTS_TEXT_CAP,
    MIN_FUZZY_LEN,
    RankedSearchFilter,
    normalize_term,
    prefix_tsquery,
    substring_q,
)

RELEVANCE_ARTICLE_ORDER = ("-search_title_rank", "-search_rank", "-search_similarity")


def article_fts_vector():
    """Identical to the ``itsm_kb_article_fts`` index expression."""
    return SearchVector("title", "summary", Left("body_text", FTS_TEXT_CAP), config=FTS_CONFIG)


def article_rank_vector():
    return (SearchVector("title", weight="A", config=FTS_CONFIG)
            + SearchVector("summary", weight="B", config=FTS_CONFIG)
            + SearchVector(Left("body_text", FTS_TEXT_CAP), weight="C", config=FTS_CONFIG))


def search_articles(qs, raw_term, *, include_tags=True, rank=False):
    term = normalize_term(raw_term)
    if not term:
        return qs
    fields = ["title", "summary", "body_text"] + (["tags"] if include_tags else [])
    match = substring_q(term.split(), fields)
    fuzzy = len(term) >= MIN_FUZZY_LEN
    query = prefix_tsquery(term) if fuzzy else None
    if query is not None:
        qs = qs.alias(search_fts=article_fts_vector())
        match |= Q(search_fts=query)
    if fuzzy:
        qs = qs.alias(search_title_upper=Upper("title"))
        match |= Q(search_title_upper__trigram_word_similar=term)
    qs = qs.filter(match)
    if not rank:
        return qs
    return qs.annotate(
        search_title_rank=Case(
            When(title__iexact=term, then=Value(2)),
            When(title__istartswith=term, then=Value(1)),
            default=Value(0), output_field=IntegerField(),
        ),
        search_rank=(SearchRank(article_rank_vector(), query) if query is not None
                     else Value(0.0, output_field=FloatField())),
        search_similarity=(TrigramWordSimilarity(term, "title") if fuzzy
                           else Value(0.0, output_field=FloatField())),
    )


class ArticleSearchFilter(RankedSearchFilter):
    """DRF backend for the KB authoring list and the portal browse surface."""

    relevance_ordering = RELEVANCE_ARTICLE_ORDER

    def run_search(self, queryset, term, request, view, *, rank):
        return search_articles(queryset, term, rank=rank)
