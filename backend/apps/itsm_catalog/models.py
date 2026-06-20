"""Request Catalog — portal-facing entry points for Service Requests.

A `CatalogItem` ("Order a Laptop", "New Employee Onboarding") raises a Service
Request ticket into a specific project, optionally collects a structured request
form (a reused field-engine `FieldLayout`), and optionally requires multi-level
approval. `CatalogRequest` records provenance (which item produced which ticket)
so tickets stay independent of this app (dependency points catalog → tickets).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class CatalogCategory(BaseModel):
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=32, blank=True)
    color = models.CharField(max_length=16, default="#6366f1")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="catalog_categories",
    )
    is_portal_visible = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        indexes = [models.Index(fields=["helpdesk", "sort_order"])]

    def __str__(self):
        return self.name


class CatalogItem(BaseModel):
    category = models.ForeignKey(CatalogCategory, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    short_description = models.CharField(max_length=500, blank=True)
    description_html = models.TextField(blank=True)
    description_text = models.TextField(blank=True)
    icon = models.CharField(max_length=32, blank=True)

    project = models.ForeignKey("itsm_projects.Project", on_delete=models.PROTECT, related_name="catalog_items")
    ticket_type = models.ForeignKey(
        "itsm_projects.TicketType", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    request_layout = models.ForeignKey(
        "itsm_core.FieldLayout", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    requires_approval = models.BooleanField(default=False)
    approval_workflow = models.ForeignKey(
        "itsm_approvals.ApprovalWorkflow", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="catalog_items",
    )

    default_group = models.ForeignKey(
        "itsm_groups.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    default_priority = models.CharField(max_length=10, default="medium")
    default_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    summary_template = models.CharField(max_length=500, blank=True)
    field_defaults = models.JSONField(default=dict, blank=True)

    is_portal_visible = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["sort_order", "name"]
        indexes = [
            models.Index(fields=["category", "sort_order"]),
            models.Index(fields=["project", "is_active"]),
            models.Index(fields=["is_portal_visible"]),
        ]

    def __str__(self):
        return self.name


class CatalogRequest(BaseModel):
    """Provenance: a ticket raised from a catalog item."""

    item = models.ForeignKey(CatalogItem, on_delete=models.CASCADE, related_name="requests")
    ticket = models.OneToOneField(
        "itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="catalog_request"
    )
    requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        indexes = [models.Index(fields=["item"])]

    def __str__(self):
        return f"{self.item_id} → {self.ticket_id}"
