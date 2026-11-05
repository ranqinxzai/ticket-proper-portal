"""Asset Management v1 — basic IT assets per helpdesk.

* Assets, categories (category → sub-category) and the detail-field library are
  **per helpdesk**. Statuses and the Vendor / Location / Department masters are
  **org-wide** (no helpdesk FK) so they're set up once.
* Detail fields are a small engine of their own (a cousin of the user-attribute
  engine in ``itsm_rbac``): ``AssetField`` definitions are linked to categories by
  ``AssetCategoryField``; values are one typed ``AssetFieldValue`` row per
  (asset, field). The ticket field engine is deliberately not reused.
* Uniqueness counts live (not soft-deleted) rows only and ignores case.
* ``AssetEvent`` is the append-only history, written only by
  ``services.asset_service`` (explicit, no signals — coding rule 5).
* ``AssetDocument`` files (invoices, warranty cards, manuals) are private: they live
  under ``media/itsm_private/`` (nginx refuses that path) and are served only by the
  authenticated ``assets/{id}/documents/{doc}/download/`` action.
"""

from __future__ import annotations

import os
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.itsm_core.models import BaseModel, TimeStampedModel, UUIDModel

_LIVE = Q(is_deleted=False)


class StateType(models.TextChoices):
    """The fixed meaning behind every configurable status."""

    AVAILABLE = "available", "Available"
    IN_USE = "in_use", "In use"
    MAINTENANCE = "maintenance", "Under maintenance"
    RETIRED = "retired", "Retired"
    MISSING = "missing", "Missing"


# Statuses whose assets count as active: they appear in the active totals and are
# moved to the Expired status once their Expiry Date has passed.
ACTIVE_STATE_TYPES = (StateType.AVAILABLE, StateType.IN_USE, StateType.MAINTENANCE)


class AssetStatus(BaseModel):
    """A configurable lifecycle status (org-wide), mapped to a fixed state type."""

    name = models.CharField(max_length=60)
    key = models.SlugField(max_length=60)
    state_type = models.CharField(max_length=20, choices=StateType.choices)
    color = models.CharField(max_length=16, default="#64748b")
    description = models.CharField(max_length=255, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=100)
    # The status a new asset (or an import row with a blank Status) gets.
    is_default = models.BooleanField(default=False)
    # The status the expiry sweep moves assets to. Must be a Retired type.
    auto_expire_target = models.BooleanField(default=False)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), condition=_LIVE, name="uniq_asset_status_name"),
            models.UniqueConstraint(fields=["key"], condition=_LIVE, name="uniq_asset_status_key"),
            models.UniqueConstraint(
                fields=["is_default"], condition=_LIVE & Q(is_default=True),
                name="uniq_asset_status_default",
            ),
            models.UniqueConstraint(
                fields=["auto_expire_target"], condition=_LIVE & Q(auto_expire_target=True),
                name="uniq_asset_status_expire_target",
            ),
        ]

    def __str__(self):
        return self.name


class Vendor(BaseModel):
    """Supplier master (org-wide)."""

    name = models.CharField(max_length=150)
    contact_person = models.CharField(max_length=150, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    website = models.CharField(max_length=200, blank=True, default="")
    address = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), condition=_LIVE, name="uniq_asset_vendor_name"),
        ]

    def __str__(self):
        return self.name


class Location(BaseModel):
    """Where an asset is (org-wide). Flat list in v1."""

    name = models.CharField(max_length=150)
    code = models.CharField(max_length=30, blank=True, default="")
    address = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), condition=_LIVE, name="uniq_asset_location_name"),
        ]

    def __str__(self):
        return self.name


class Department(BaseModel):
    """Who an asset is allotted to, as an org unit (org-wide)."""

    name = models.CharField(max_length=150)
    code = models.CharField(max_length=30, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), condition=_LIVE, name="uniq_asset_department_name"),
        ]

    def __str__(self):
        return self.name


class AssetCategory(BaseModel):
    """Category (``parent`` null) or sub-category (``parent`` set) — two levels max."""

    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", on_delete=models.PROTECT, related_name="asset_categories"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            # NULLS NOT DISTINCT so two top-level categories can't share a name.
            models.UniqueConstraint(
                "helpdesk", "parent", Lower("name"), condition=_LIVE,
                nulls_distinct=False, name="uniq_asset_category_name",
            ),
        ]

    def __str__(self):
        return self.name


class FieldType(models.TextChoices):
    """Detail-field types — the same set as custom user attributes."""

    TEXT = "text", "Text"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    CHECKBOX = "checkbox", "Checkbox"
    DROPDOWN = "dropdown", "Dropdown"
    MULTISELECT = "multiselect", "Multi-select"


OPTION_FIELD_TYPES = {FieldType.DROPDOWN, FieldType.MULTISELECT}


class AssetField(BaseModel):
    """A detail field in a helpdesk's library (e.g. Service Tag, OS, RAM)."""

    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", on_delete=models.PROTECT, related_name="asset_fields"
    )
    key = models.SlugField(max_length=80)
    name = models.CharField(max_length=120)
    field_type = models.CharField(max_length=20, choices=FieldType.choices)
    help_text = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["helpdesk", "key"], condition=_LIVE, name="uniq_asset_field_key"
            ),
            models.UniqueConstraint(
                "helpdesk", Lower("name"), condition=_LIVE, name="uniq_asset_field_name"
            ),
        ]

    def __str__(self):
        return self.name


class AssetFieldOption(BaseModel):
    """A choice of a dropdown / multi-select detail field."""

    field = models.ForeignKey(AssetField, on_delete=models.CASCADE, related_name="options")
    value = models.CharField(max_length=100)
    label = models.CharField(max_length=150)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "label"]
        constraints = [
            models.UniqueConstraint(
                "field", Lower("value"), condition=_LIVE, name="uniq_asset_field_option_value"
            ),
        ]

    def __str__(self):
        return self.label


class AssetCategoryField(UUIDModel, TimeStampedModel):
    """Which detail fields apply to a category node. Hard-deleted when unlinked.

    A sub-category inherits its parent's links; when both levels link the same
    field, the sub-category's link (required flag, order) wins.
    """

    category = models.ForeignKey(
        AssetCategory, on_delete=models.CASCADE, related_name="field_links"
    )
    field = models.ForeignKey(AssetField, on_delete=models.CASCADE, related_name="category_links")
    is_required = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=100)

    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(fields=["category", "field"], name="uniq_asset_category_field"),
        ]

    def __str__(self):
        return f"{self.category_id}:{self.field_id}"


class AssetImport(UUIDModel, TimeStampedModel):
    """One Excel import run. Only FAILED rows are kept (``AssetImportRow``).

    The uploaded file itself is not stored: ``/media`` is publicly served.
    """

    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", on_delete=models.PROTECT, related_name="asset_imports"
    )
    file_name = models.CharField(max_length=255)
    total_rows = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    # Rows created straight into the Expired status (blank Status, expiry passed).
    expired_count = models.PositiveIntegerField(default=0)
    # {"vendors": [names], "locations": [...], "departments": [...]} created by the run.
    created_masters = models.JSONField(default=dict, blank=True)
    # The header row as uploaded — the failed-rows workbook reuses it.
    headers = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.file_name} ({self.created_at:%Y-%m-%d %H:%M})"


class AssetImportRow(UUIDModel):
    """A row that failed to import: its raw values and why."""

    import_run = models.ForeignKey(AssetImport, on_delete=models.CASCADE, related_name="rows")
    row_number = models.PositiveIntegerField()
    data = models.JSONField(default=dict)  # {uploaded header: cell value as text}
    errors = models.JSONField(default=list)  # [{"column": "...", "message": "..."}]

    class Meta:
        ordering = ["row_number"]

    def __str__(self):
        return f"{self.import_run_id}#{self.row_number}"


class Asset(BaseModel):
    """A tracked asset. The five form sections map to the field groups below."""

    helpdesk = models.ForeignKey(
        "itsm_helpdesks.Helpdesk", on_delete=models.PROTECT, related_name="assets"
    )
    # General
    name = models.CharField(max_length=200)
    asset_tag = models.CharField(max_length=64)
    vendor = models.ForeignKey(
        Vendor, null=True, blank=True, on_delete=models.PROTECT, related_name="assets"
    )
    category = models.ForeignKey(AssetCategory, on_delete=models.PROTECT, related_name="assets")
    sub_category = models.ForeignKey(
        AssetCategory, null=True, blank=True, on_delete=models.PROTECT, related_name="sub_assets"
    )
    status = models.ForeignKey(AssetStatus, on_delete=models.PROTECT, related_name="assets")
    # Location
    location = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.PROTECT, related_name="assets"
    )
    # Allotment
    assigned_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="itsm_assets",
    )
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.PROTECT, related_name="assets"
    )
    allotment_notes = models.TextField(blank=True, default="")
    allotted_at = models.DateTimeField(null=True, blank=True)  # set when the allotment changes
    # Purchase
    purchase_date = models.DateField(null=True, blank=True)
    purchase_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    warranty_expiry_date = models.DateField(null=True, blank=True)

    source_import = models.ForeignKey(
        AssetImport, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(Lower("asset_tag"), condition=_LIVE, name="uniq_asset_tag"),
        ]
        indexes = [
            models.Index(fields=["helpdesk", "status"], name="asset_hd_status_idx"),
            models.Index(fields=["helpdesk", "category"], name="asset_hd_category_idx"),
            models.Index(fields=["helpdesk", "location"], name="asset_hd_location_idx"),
            models.Index(fields=["helpdesk", "department"], name="asset_hd_department_idx"),
            models.Index(fields=["helpdesk", "assigned_user"], name="asset_hd_user_idx"),
            models.Index(fields=["expiry_date"], name="asset_expiry_idx"),
            models.Index(fields=["warranty_expiry_date"], name="asset_warranty_idx"),
        ]

    def __str__(self):
        return f"{self.asset_tag} · {self.name}"


class AssetFieldValue(UUIDModel, TimeStampedModel):
    """One typed detail value per (asset, field). Hard-deleted when cleared."""

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="field_values")
    field = models.ForeignKey(AssetField, on_delete=models.PROTECT, related_name="values")
    value_text = models.TextField(blank=True, default="")
    value_number = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    value_date = models.DateField(null=True, blank=True)
    value_bool = models.BooleanField(null=True, blank=True)
    value_json = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "field"], name="uniq_asset_field_value"),
        ]
        indexes = [models.Index(fields=["field"], name="asset_value_field_idx")]

    def __str__(self):
        return f"{self.asset_id}:{self.field_id}"


class AssetEvent(UUIDModel):
    """Append-only asset history. ``actor`` null = System (the expiry sweep)."""

    class Action(models.TextChoices):
        CREATED = "created", "Created"
        IMPORTED = "imported", "Imported"
        UPDATED = "updated", "Updated"
        AUTO_EXPIRED = "auto_expired", "Marked Expired"
        DELETED = "deleted", "Deleted"
        TICKET_LINKED = "ticket_linked", "Linked to a ticket"
        TICKET_UNLINKED = "ticket_unlinked", "Unlinked from a ticket"
        DOCUMENT_ADDED = "document_added", "Document added"
        DOCUMENT_REMOVED = "document_removed", "Document removed"

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=30, choices=Action.choices)
    # [{"field": key, "label": "Status", "old": "In Stock", "new": "In Use"}], display values.
    changes = models.JSONField(default=list, blank=True)
    note = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["asset", "-created_at"], name="asset_event_asset_idx")]

    def __str__(self):
        return f"{self.asset_id}:{self.action}"


def asset_document_path(instance, filename):
    """``itsm_private/asset_documents/<asset>/<random><ext>``. The stored name is
    random, so the original name (kept on the row) never reaches the disk path, and
    nginx refuses everything under ``/media/itsm_private/``."""
    ext = os.path.splitext(filename)[1].lower()[:10]
    return f"itsm_private/asset_documents/{instance.asset_id}/{uuid.uuid4().hex}{ext}"


class AssetDocument(BaseModel):
    """A file kept against an asset: its invoice, warranty card, manual or other
    paperwork. Written only by ``services.documents``. Removing one soft-deletes the
    row and keeps the file, like ticket attachments."""

    class DocType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        WARRANTY = "warranty", "Warranty card"
        MANUAL = "manual", "Manual"
        OTHER = "other", "Other"

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=20, choices=DocType.choices, default=DocType.OTHER)
    file = models.FileField(upload_to=asset_document_path, max_length=255)
    original_name = models.CharField(max_length=255, blank=True, default="")
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True, default="")
    note = models.CharField(max_length=255, blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["asset", "is_deleted"], name="asset_doc_asset_idx")]

    def __str__(self):
        return f"{self.asset_id}:{self.get_doc_type_display()}:{self.original_name}"


class AssetTagSequence(models.Model):
    """Per-helpdesk counter for auto tags ``<HD>-AST-00001`` (an internal counter,
    not an entity — the rule-1 exception, like ``TicketSequence``)."""

    helpdesk = models.OneToOneField(
        "itsm_helpdesks.Helpdesk", on_delete=models.CASCADE, primary_key=True,
        related_name="asset_tag_sequence",
    )
    last_number = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.helpdesk_id}:{self.last_number}"
