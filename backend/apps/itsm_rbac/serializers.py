from __future__ import annotations

import uuid

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import (
    Module,
    RoleAssignment,
    RoleModulePermission,
    SystemRole,
    TenantSSOConfig,
    UserAttributeDefinition,
    UserAttributeOption,
)
from .registry import MODULES
from .services import get_user_role
from . import user_attr_service


class ModuleSerializer(serializers.ModelSerializer):
    parent_code = serializers.CharField(source="parent.code", read_only=True)

    class Meta:
        model = Module
        fields = ["id", "code", "name", "description", "parent_code", "sort_order", "is_active"]


class RoleModulePermissionSerializer(serializers.ModelSerializer):
    module_code = serializers.CharField(source="module.code", read_only=True)

    class Meta:
        model = RoleModulePermission
        fields = ["id", "role", "module", "module_code",
                  "can_read", "can_create", "can_update", "can_delete"]


class SystemRoleSerializer(serializers.ModelSerializer):
    permissions = RoleModulePermissionSerializer(many=True, read_only=True)

    class Meta:
        model = SystemRole
        fields = ["id", "code", "name", "description", "is_system", "is_active", "permissions"]
        read_only_fields = ["is_system"]


class RoleAssignmentSerializer(serializers.ModelSerializer):
    role_code = serializers.CharField(source="role.code", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = RoleAssignment
        fields = ["id", "user", "username", "role", "role_code", "role_name"]


def build_permission_map(user) -> dict[str, dict]:
    """{module_code: {read, create, update, delete}} for UI gating."""
    if getattr(user, "is_superuser", False):
        return {code: {"read": True, "create": True, "update": True, "delete": True}
                for code, *_ in MODULES}
    role = get_user_role(user)
    if role is None:
        return {}
    rows = RoleModulePermission.objects.filter(role=role).select_related("module")
    return {
        r.module.code: {
            "read": r.can_read, "create": r.can_create,
            "update": r.can_update, "delete": r.can_delete,
        }
        for r in rows
    }


class ItsmUserSerializer(serializers.Serializer):
    id = serializers.CharField()
    username = serializers.CharField()
    full_name = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    is_superuser = serializers.BooleanField()
    role = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    helpdesks = serializers.SerializerMethodField()

    def get_role(self, user):
        if getattr(user, "is_superuser", False):
            return {"code": "supervisor", "name": "Administrator (superuser)"}
        role = get_user_role(user)
        return {"code": role.code, "name": role.name} if role else None

    def get_permissions(self, user):
        return build_permission_map(user)

    def get_helpdesks(self, user):
        """The helpdesks this user may access (drives the agent Home selector)."""
        from apps.itsm_helpdesks.services import build_helpdesk_membership
        return build_helpdesk_membership(user)


class MemberSerializer(serializers.Serializer):
    """Admin roster row: a user + their ITSM role + per-helpdesk membership.

    Unlike ``ItsmUserSerializer`` (the self payload) this drops the heavy
    permission map and instead surfaces ``role_in_helpdesk`` per helpdesk so the
    user-management table can show member-vs-lead.
    """

    id = serializers.CharField()
    username = serializers.CharField()
    full_name = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    is_active = serializers.BooleanField()
    is_superuser = serializers.BooleanField()
    role = serializers.SerializerMethodField()
    helpdesks = serializers.SerializerMethodField()
    projects = serializers.SerializerMethodField()
    attributes = serializers.SerializerMethodField()

    def get_role(self, user):
        if getattr(user, "is_superuser", False):
            return {"code": "supervisor", "name": "Administrator (superuser)"}
        role = get_user_role(user)
        return {"code": role.code, "name": role.name} if role else None

    def get_attributes(self, user):
        # {attribute_key: value} from the prefetched value cache (no N+1).
        return user_attr_service.values_from_prefetched(user)

    def get_helpdesks(self, user):
        # Uses the prefetched ``itsm_helpdesk_memberships`` cache; filtered in
        # Python to avoid an extra query per row.
        return [
            {
                "id": str(m.helpdesk_id),
                "key": m.helpdesk.key,
                "name": m.helpdesk.name,
                "role_in_helpdesk": m.role_in_helpdesk,
            }
            for m in user.itsm_helpdesk_memberships.all()
            if m.is_active and not m.is_deleted
        ]

    def get_projects(self, user):
        # Active per-user project grants (drives the User-Management project picker).
        # Uses the prefetched ``itsm_project_memberships`` cache.
        return [
            {
                "id": str(m.project_id),
                "key": m.project.key,
                "name": m.project.name,
                "helpdesk": str(m.project.helpdesk_id),
                "helpdesk_key": m.project.helpdesk.key,
            }
            for m in user.itsm_project_memberships.all()
            if m.is_active and not m.is_deleted
        ]


class UserAttributeOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserAttributeOption
        fields = ["id", "attribute", "value", "label", "color", "sort_order", "is_active"]


class UserAttributeDefinitionSerializer(serializers.ModelSerializer):
    options = UserAttributeOptionSerializer(many=True, read_only=True)

    class Meta:
        model = UserAttributeDefinition
        fields = [
            "id", "key", "name", "description", "attr_type",
            "is_required", "show_in_table", "sort_order", "is_active",
            "config", "options",
        ]

    def validate_key(self, value):
        v = (value or "").strip().lower().replace(" ", "-")
        if not v:
            raise serializers.ValidationError("A key is required.")
        return v


def _is_break_glass_admin(user) -> bool:
    """Admins/superusers may keep using a password even when flagged Microsoft.

    This break-glass path prevents a misconfigured Entra app from locking an org
    out of its own admin console. Tied to the genuinely privileged tiers only.
    """
    if getattr(user, "is_superuser", False):
        return True
    role = get_user_role(user)
    return bool(role and role.code in {"admin", "supervisor"})


class TenantSSOConfigSerializer(serializers.ModelSerializer):
    """Per-tenant SSO settings. The client secret is write-only (never read back);
    reads expose ``has_microsoft_client_secret`` plus the exact Redirect URI to
    register in Entra — mirroring the mailbox (EmailChannel) credential pattern."""

    microsoft_client_secret = serializers.CharField(
        write_only=True, required=False, allow_blank=True, source="microsoft_client_secret_enc",
        style={"input_type": "password"},
    )
    has_microsoft_client_secret = serializers.SerializerMethodField()
    microsoft_configured = serializers.BooleanField(read_only=True)
    microsoft_enabled = serializers.BooleanField(read_only=True)
    redirect_uri = serializers.SerializerMethodField()

    class Meta:
        model = TenantSSOConfig
        fields = [
            "id", "enabled",
            "microsoft_client_id", "microsoft_tenant_id",
            "microsoft_client_secret", "has_microsoft_client_secret",
            "auto_provision", "allowed_email_domains",
            "microsoft_configured", "microsoft_enabled", "redirect_uri",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]

    def get_has_microsoft_client_secret(self, obj) -> bool:
        return bool(obj.microsoft_client_secret_enc)

    def get_redirect_uri(self, obj) -> str:
        from .sso import redirect_uri
        return redirect_uri()

    def validate_microsoft_tenant_id(self, value):
        """Require a single-tenant Directory (tenant) ID — a GUID.

        Security-critical: sign-in safety rests on pinning the token's ``tid`` to
        THIS directory (so only your org's accounts can ever sign in). A
        multi-tenant value like ``common`` would let any Microsoft account in the
        world obtain a token for the app, so we refuse to store it.
        """
        v = (value or "").strip()
        if not v:
            return v
        if v.lower() in {"common", "organizations", "consumers"}:
            raise serializers.ValidationError(
                "Use your Directory (tenant) ID (a GUID) — not a shared endpoint like "
                "“common”. A single-tenant directory is required so only your "
                "organisation's accounts can sign in."
            )
        try:
            uuid.UUID(v)
        except (ValueError, TypeError):
            raise serializers.ValidationError(
                "Directory (tenant) ID must be a GUID (from your Entra app's Overview page)."
            )
        return v


class ItsmTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds the user payload (+ permission map + helpdesks) to the login response.

    Also enforces the per-user sign-in method: a Microsoft-SSO user cannot use
    password login (except a break-glass admin), with a clear, actionable error.
    """

    def validate(self, attrs):
        self._reject_sso_only_user(attrs)
        data = super().validate(attrs)
        data["user"] = ItsmUserSerializer(self.user).data
        return data

    def _reject_sso_only_user(self, attrs):
        """Block password login for Microsoft-method users before the generic
        auth check, so they get 'use Sign in with Microsoft' instead of a vague
        'invalid credentials'. Looked up case-insensitively (username or email)."""
        from apps.accounts.backends import CaseInsensitiveModelBackend
        from apps.accounts.models import AuthMethod, User

        login = attrs.get(self.username_field)
        if not login:
            return
        candidate = CaseInsensitiveModelBackend._find_user(User, login)
        if (
            candidate is not None
            and candidate.auth_method == AuthMethod.MICROSOFT
            and not _is_break_glass_admin(candidate)
        ):
            raise AuthenticationFailed(
                "This account signs in with Microsoft. Use the “Sign in with Microsoft” button.",
                "sso_required",
            )

    @classmethod
    def get_token(cls, user):
        from django.db import connection

        token = super().get_token(user)
        token["username"] = user.username
        token["is_superuser"] = user.is_superuser
        # Multi-tenancy: bind the token to the org it was issued for. The login
        # ran under that org's schema (set by PathTenantMiddleware), so this is
        # the authoritative org for the token. TenantAwareJWTAuthentication
        # rejects any later request whose path-org differs from this claim —
        # without it, an org-A token could be replayed at /t/orgB/ (integer
        # user PKs collide across schemas).
        token["tenant"] = connection.schema_name
        return token
