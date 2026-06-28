"""Helpdesks — the department/workspace layer above Projects.

A `Helpdesk` (IT, HR, Facility, …) is a workspace that owns its own default
Incident + Request projects (so IT's Incident is a different project than HR's).
Agents are explicit members of one or more Helpdesks (`HelpdeskMembership`), and
that membership is the row-level scope every ticket-facing query is clamped to.

`key` is a short uppercase code that becomes the per-helpdesk ticket-number prefix
(e.g. helpdesk `IT` → projects `ITINC`/`ITREQ` → tickets `ITINC-1`). It must stay
short enough that `<key>INC` fits `Project.KEY_VALIDATOR` (2–10 chars), hence ≤ 5.

Retirement note: `BaseModel.soft_delete()` does NOT cascade, so retire a Helpdesk
via `status='archived'` (excluded from `accessible_helpdesk_ids`), not soft delete.
"""

from __future__ import annotations

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from apps.itsm_core.models import BaseModel

KEY_VALIDATOR = RegexValidator(
    r"^[A-Z][A-Z0-9]{1,4}$", "Key must be 2–5 uppercase letters/digits (it prefixes ticket numbers)."
)


class HelpdeskStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"
    ARCHIVED = "archived", "Archived"


class Helpdesk(BaseModel):
    name = models.CharField(max_length=150, unique=True)
    key = models.CharField(max_length=5, unique=True, validators=[KEY_VALIDATOR])
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=32, blank=True)
    color = models.CharField(max_length=16, default="#6366f1")
    status = models.CharField(
        max_length=12, choices=HelpdeskStatus.choices, default=HelpdeskStatus.ACTIVE
    )
    # Admin-defined display order for the agent Home cards (global, ascending;
    # `name` is the tiebreaker). New helpdesks append (max+1) — see views.perform_create.
    order = models.IntegerField(default=0, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_itsm_helpdesks",
    )

    class Meta:
        ordering = ["order", "name"]
        indexes = [models.Index(fields=["key"]), models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.key} · {self.name}"


class HelpdeskMembership(BaseModel):
    class RoleInHelpdesk(models.TextChoices):
        MEMBER = "member", "Member"
        LEAD = "lead", "Lead"

    helpdesk = models.ForeignKey(Helpdesk, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_helpdesk_memberships"
    )
    role_in_helpdesk = models.CharField(
        max_length=10, choices=RoleInHelpdesk.choices, default=RoleInHelpdesk.MEMBER
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["helpdesk", "user"], name="uniq_helpdesk_user"),
        ]
        indexes = [models.Index(fields=["helpdesk", "is_active"])]

    def __str__(self):
        return f"{self.user_id}@{self.helpdesk.key}"
