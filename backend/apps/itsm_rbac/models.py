"""Module-based RBAC for the ITSM product.

A `Module` is a dot-notation permission node (e.g. ``itsm.tickets.bulk``) with an
optional parent — permissions inherit down the tree. A `SystemRole` (Agent,
Supervisor, Requestor, …) holds a `RoleModulePermission` row per module granting
CRUD bits. A user's ITSM role is bound via a `RoleAssignment` (one role per user
for v1). Superusers bypass all checks.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel
from apps.itsm_email.crypto import EncryptedField


class TenantSSOConfig(BaseModel):
    """Per-tenant Single Sign-On settings (one row per org schema).

    Mirrors the per-tenant OAuth-app pattern already used by ``EmailChannel``:
    each organisation registers its OWN app in Microsoft Entra (Azure AD) and
    pastes the Client ID / Directory (tenant) ID / Client secret here. The secret
    is Fernet-encrypted at rest via :class:`EncryptedField` — never returned by
    the API. Lives inside the tenant schema (``itsm_rbac`` is a TENANT_APP), so
    one org can never read another's credentials.

    A singleton: there is at most one live row per schema (see :meth:`current`).
    """

    PROVIDER_MICROSOFT = "microsoft"

    # Master switch. When False, the "Sign in with Microsoft" button is hidden
    # and the SSO endpoints refuse to start a flow (even if creds are present).
    enabled = models.BooleanField(default=False)

    # ── Microsoft Entra (Azure AD) app registration — supplied by the tenant ──
    microsoft_client_id = models.CharField(max_length=255, blank=True, default="")
    microsoft_client_secret_enc = EncryptedField(blank=True, default="")
    # The Directory (tenant) ID — a GUID for a single-tenant app. Pinning this is
    # what makes auto-provisioning safe: only accounts from THIS directory can
    # ever obtain a token, so a stranger's Microsoft account can't sign in.
    microsoft_tenant_id = models.CharField(max_length=128, blank=True, default="")

    # When True, a first-time Microsoft sign-in with no matching local user
    # auto-creates a portal Requestor from the verified Microsoft profile. When
    # False, unknown users are rejected (admins must pre-create the account).
    auto_provision = models.BooleanField(default=True)
    # Optional CSV allow-list of email domains permitted to auto-provision
    # (e.g. "acme.com, acme.co.uk"). Blank = any address in the directory.
    allowed_email_domains = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        verbose_name = "Tenant SSO configuration"

    def __str__(self) -> str:
        return f"SSO({'on' if self.enabled else 'off'})"

    @classmethod
    def current(cls):
        """The org's live SSO config for the active schema, or ``None``."""
        return cls.objects.order_by("created_at").first()

    @property
    def microsoft_configured(self) -> bool:
        """True once the three required Microsoft fields are all present."""
        return bool(
            self.microsoft_client_id
            and self.microsoft_client_secret_enc
            and self.microsoft_tenant_id
        )

    @property
    def microsoft_enabled(self) -> bool:
        """True only when SSO is switched on AND fully configured."""
        return bool(self.enabled and self.microsoft_configured)

    def domain_allowed(self, email: str) -> bool:
        """Whether ``email``'s domain may auto-provision (empty list ⇒ allow all)."""
        allow = [d.strip().lower() for d in (self.allowed_email_domains or "").split(",") if d.strip()]
        if not allow:
            return True
        domain = (email or "").rsplit("@", 1)[-1].strip().lower()
        return bool(domain) and domain in allow


class SsoLoginTicket(models.Model):
    """A one-time login handoff between the SSO callback and the SPA token exchange.

    The callback creates a row; the exchange endpoint atomically deletes it and
    only mints a JWT if the delete actually removed a row. Because the DELETE is a
    single atomic SQL statement, single-use holds even across multiple gunicorn
    workers — unlike a per-process LocMem cache. Rows are short-lived (pruned on
    create) and the signed code that references the ``jti`` also carries its own TTL.
    """

    jti = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def __str__(self) -> str:
        return f"SsoLoginTicket({self.jti})"


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
    code = models.SlugField(max_length=50, unique=True)  # agent, supervisor, requestor
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


# ── Custom user attributes (org-defined directory fields) ────────────────────


class UserAttributeType(models.TextChoices):
    """The shapes an org admin can give a custom user attribute.

    A deliberately small subset of the ticket field engine
    (``itsm_core.FieldType``): the value types that make sense on a person
    record. ``DROPDOWN`` is single-choice, ``MULTISELECT`` is multi-choice; both
    draw their choices from :class:`UserAttributeOption` rows.
    """

    TEXT = "text", "Text"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    CHECKBOX = "checkbox", "Checkbox"
    DROPDOWN = "dropdown", "Dropdown"
    MULTISELECT = "multiselect", "Multi-select"


# Attribute types backed by a list of UserAttributeOption rows.
USER_ATTR_OPTION_TYPES = {UserAttributeType.DROPDOWN, UserAttributeType.MULTISELECT}
# Attribute types whose value lives in value_json (an ordered list).
USER_ATTR_MULTI_TYPES = {UserAttributeType.MULTISELECT}


class UserAttributeDefinition(BaseModel):
    """An org-defined custom attribute carried by every user (a directory field).

    The org admin defines these in Tenant Settings → Users; each becomes an input
    on the create/edit-user form and an optional column + filter on the roster.
    Lives in the tenant schema (``itsm_rbac`` is a TENANT_APP) so attributes are
    per-org. The typed CellValue lives in :class:`UserAttributeValue`.
    """

    key = models.SlugField(max_length=80)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    attr_type = models.CharField(max_length=20, choices=UserAttributeType.choices)
    is_required = models.BooleanField(default=False)   # required when creating a user
    show_in_table = models.BooleanField(default=True)  # default-visible roster column
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    config = models.JSONField(default=dict, blank=True)  # reserved (hint, etc.)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            # `key` is unique among LIVE definitions only — a soft-deleted key may
            # be re-created later (consistent with the soft-delete model used here).
            models.UniqueConstraint(
                fields=["key"],
                condition=models.Q(is_deleted=False),
                name="uniq_user_attr_key",
            ),
        ]

    def __str__(self):
        return f"{self.key} ({self.attr_type})"


class UserAttributeOption(BaseModel):
    """A choice for a ``dropdown``/``multiselect`` user attribute."""

    attribute = models.ForeignKey(
        UserAttributeDefinition, on_delete=models.CASCADE, related_name="options"
    )
    value = models.CharField(max_length=100)
    label = models.CharField(max_length=150)
    color = models.CharField(max_length=16, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["attribute", "value"], name="uniq_user_attr_option_value"
            ),
        ]

    def __str__(self):
        return f"{self.attribute_id}:{self.value}"


class UserAttributeValue(BaseModel):
    """One typed row per (user, attribute) — the CellValue for user attributes."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="itsm_attribute_values",
    )
    attribute = models.ForeignKey(
        UserAttributeDefinition, on_delete=models.CASCADE, related_name="values"
    )
    value_text = models.TextField(blank=True, default="")
    value_number = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    value_date = models.DateTimeField(null=True, blank=True)
    value_bool = models.BooleanField(null=True, blank=True)
    value_json = models.JSONField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "attribute"], name="uniq_user_attribute"),
        ]
        indexes = [models.Index(fields=["attribute"]), models.Index(fields=["user"])]

    def __str__(self):
        return f"{self.user_id}:{self.attribute_id}"
