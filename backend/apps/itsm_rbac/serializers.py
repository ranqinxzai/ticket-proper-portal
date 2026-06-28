from __future__ import annotations

from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Module, RoleAssignment, RoleModulePermission, SystemRole
from .registry import MODULES
from .services import get_user_role


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

    def get_role(self, user):
        if getattr(user, "is_superuser", False):
            return {"code": "supervisor", "name": "Administrator (superuser)"}
        role = get_user_role(user)
        return {"code": role.code, "name": role.name} if role else None

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


class ItsmTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds the user payload (+ permission map + helpdesks) to the login response."""

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = ItsmUserSerializer(self.user).data
        return data

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
