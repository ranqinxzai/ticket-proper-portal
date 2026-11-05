"""Asset tags: org-wide unique (ignoring case), auto ``<HD>-AST-00001`` when blank.

Every path that writes a tag (create, edit, import) takes the same transaction-
scoped advisory lock first, then re-checks. The unique index on ``lower(asset_tag)``
is the last guard. The per-helpdesk counter is locked with ``select_for_update``
(coding rule 9).
"""

from __future__ import annotations

from django.db import connection
from django.db.models.functions import Lower

from ..models import Asset, AssetTagSequence

TAG_MAX = 64


def lock_tags():
    """Serialize tag writes within this org (schema) until the transaction ends."""
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':itsm_asset_tag'))")


def normalize(tag) -> str:
    return " ".join(str(tag or "").split())


def tag_taken(tag: str, *, exclude_id=None) -> bool:
    qs = Asset.objects.filter(asset_tag__iexact=tag)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


def live_tags_lower() -> set[str]:
    return set(Asset.objects.annotate(t=Lower("asset_tag")).values_list("t", flat=True))


def prefix_for(helpdesk) -> str:
    return f"{helpdesk.key}-AST-"


def allocate(helpdesk, count: int, taken_lower: set[str] | None = None) -> list[str]:
    """Hand out ``count`` new tags, skipping numbers already used by typed-in tags.

    Call inside a transaction, after ``lock_tags()``.
    """
    if count <= 0:
        return []
    seq, _ = AssetTagSequence.objects.select_for_update().get_or_create(helpdesk=helpdesk)
    prefix = prefix_for(helpdesk)
    taken = set(taken_lower or set())
    taken |= set(
        Asset.objects.filter(asset_tag__istartswith=prefix)
        .annotate(t=Lower("asset_tag")).values_list("t", flat=True)
    )
    out: list[str] = []
    n = seq.last_number
    while len(out) < count:
        n += 1
        tag = f"{prefix}{n:05d}"
        if tag.lower() in taken:
            continue
        taken.add(tag.lower())
        out.append(tag)
    seq.last_number = n
    seq.save(update_fields=["last_number"])
    return out
