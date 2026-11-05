"""Knowledge Base / Solutions.

Agents author `Article`s (draft → published); end users browse the published,
portal-visible ones in the Service Portal. `ArticleTicketLink` records when an
article resolves or is referenced on a ticket (deflection / solution tracking).
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex, OpClass
from django.contrib.postgres.search import SearchVector
from django.db import models
from django.db.models.functions import Left, Upper

from apps.itsm_core.models import BaseModel


class KBCategory(BaseModel):
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="kb_categories",
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Article(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    class Visibility(models.TextChoices):
        PORTAL = "portal", "Portal (end users + agents)"
        INTERNAL = "internal", "Internal (agents only)"

    category = models.ForeignKey(
        KBCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="articles"
    )
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="kb_articles",
    )
    title = models.CharField(max_length=300)
    slug = models.SlugField(max_length=120, unique=True)
    body_html = models.TextField(blank=True)
    body_text = models.TextField(blank=True)
    summary = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PORTAL)
    tags = models.JSONField(default=list, blank=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="authored_articles",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)
    helpful_count = models.PositiveIntegerField(default=0)
    not_helpful_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-published_at", "-created_at"]
        indexes = [
            models.Index(fields=["status", "visibility"]),
            models.Index(fields=["helpdesk", "status"]),
            models.Index(fields=["slug"]),
            # G6 search — expressions mirrored by apps/itsm_knowledge/search.py (a test
            # asserts equality; Postgres only uses an expression index on an exact match).
            GinIndex(SearchVector("title", "summary", Left("body_text", 100_000), config="english"),
                     name="itsm_kb_article_fts"),
            GinIndex(OpClass(Upper("title"), name="gin_trgm_ops"), name="itsm_kb_title_trgm"),
        ]

    def __str__(self):
        return self.title


class ArticleTicketLink(BaseModel):
    class LinkType(models.TextChoices):
        RESOLVED_BY = "resolved_by", "Resolved by"
        REFERENCED = "referenced", "Referenced"
        SUGGESTED = "suggested", "Suggested"

    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="ticket_links")
    ticket = models.ForeignKey("itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="kb_links")
    link_type = models.CharField(max_length=12, choices=LinkType.choices, default=LinkType.REFERENCED)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["article", "ticket", "link_type"], name="uniq_article_ticket_link"),
        ]
        indexes = [models.Index(fields=["ticket"])]

    def __str__(self):
        return f"{self.article_id} {self.link_type} {self.ticket_id}"
