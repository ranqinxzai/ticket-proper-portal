"""Module-based RBAC for the ITSM product.

A `Module` is a dot-notation permission node (e.g. ``itsm.tickets.bulk``) with an
optional parent — permissions inherit down the tree. A `SystemRole` (Agent,
Supervisor, …) holds a `RoleModulePermission` row per module granting CRUD bits.
A user's ITSM role is bound via a `RoleAssignment` (one role per user for v1).
Superusers bypass all checks.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class Module(BaseModel):
    code = models.CharField(max_length=100, unique=True)  # e.g. itsm.tickets.bulk
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "code"]
        indexes = [models.Index(fields=["code"])]

    def __str__(self):
        return self.code


class SystemRole(BaseModel):
    code = models.SlugField(max_length=50, unique=True)  # agent, supervisor
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=False)  # seeded roles cannot be deleted
    is_active = models.BooleanField(default=True)
    # Reserved hook for future multi-tenancy (one org for v1).
    org = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class RoleModulePermission(BaseModel):
    role = models.ForeignKey(SystemRole, on_delete=models.CASCADE, related_name="permissions")
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="role_permissions")
    can_read = models.BooleanField(default=False)
    can_create = models.BooleanField(default=False)
    can_update = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["role", "module"], name="uniq_role_module"),
        ]
        indexes = [models.Index(fields=["role", "module"])]

    def __str__(self):
        return f"{self.role.code}:{self.module.code}"


class RoleAssignment(BaseModel):
    """Binds an `accounts.User` to one ITSM SystemRole."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="itsm_role_assignment"
    )
    role = models.ForeignKey(SystemRole, on_delete=models.PROTECT, related_name="assignments")

    class Meta:
        indexes = [models.Index(fields=["user"])]

    def __str__(self):
        return f"{self.user_id} → {self.role.code}"
