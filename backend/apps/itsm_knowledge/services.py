"""KB write choke-points (rule 4): article lifecycle + category delete.

Article ``status`` is read-only on the API; it only changes through these functions
(the ``publish`` / ``unpublish`` / ``archive`` / ``restore`` actions), so
``published_at`` stays consistent and "save" never silently keeps or drops an
article from the Service Portal.

No audit rows: ``AuditEvent`` is ticket-scoped, so KB changes are not audited (yet).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import Article, KBCategory


class LifecycleError(ValueError):
    """A lifecycle action that doesn't apply to the article's current status."""


def publish(article: Article) -> Article:
    """Any status → published (portal-visible ones appear in the Service Portal)."""
    article.status = Article.Status.PUBLISHED
    if article.published_at is None:
        article.published_at = timezone.now()
    article.save(update_fields=["status", "published_at", "updated_at"])
    return article


def unpublish(article: Article) -> Article:
    """→ draft: hidden from the Service Portal until published again."""
    article.status = Article.Status.DRAFT
    article.save(update_fields=["status", "updated_at"])
    return article


def archive(article: Article) -> Article:
    """→ archived: hidden from the portal and the default authoring list. Reversible."""
    article.status = Article.Status.ARCHIVED
    article.save(update_fields=["status", "updated_at"])
    return article


def restore(article: Article) -> Article:
    """archived → draft (publish it again to show it in the portal)."""
    if article.status != Article.Status.ARCHIVED:
        raise LifecycleError("Only archived articles can be restored.")
    article.status = Article.Status.DRAFT
    article.save(update_fields=["status", "updated_at"])
    return article


@transaction.atomic
def delete_category(category: KBCategory, *, user=None) -> None:
    """Soft-delete a category: its articles become uncategorised and its
    sub-categories move to the top level (nothing keeps pointing at a deleted row)."""
    now = timezone.now()
    Article.objects.filter(category=category).update(category=None, updated_at=now)
    KBCategory.objects.filter(parent=category).update(parent=None, updated_at=now)
    category.soft_delete(user=user)
