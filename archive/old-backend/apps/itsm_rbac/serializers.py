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
        role = get_user_role(user)
        if user.is_superuser:
            return {"code": "supervisor", "name": "Administrator (superuser)"}
        return {"code": role.code, "name": role.name} if role else None

    def get_permissions(self, user):
        return build_permission_map(user)

    def get_helpdesks(self, user):
        """The helpdesks this user may access (drives the Home selector + switcher)."""
        from apps.itsm_helpdesks.services import build_helpdesk_membership
        return build_helpdesk_membership(user)


class ItsmTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds the user payload (+ permission map) to the login response."""

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = ItsmUserSerializer(self.user).data
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["is_superuser"] = user.is_superuser
        return token
