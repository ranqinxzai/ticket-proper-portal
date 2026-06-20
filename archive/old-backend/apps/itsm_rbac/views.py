from __future__ import annotations

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Module, RoleAssignment, RoleModulePermission, SystemRole
from .permissions import HasModulePermission, ItsmModelViewSet
from .serializers import (
    ItsmTokenObtainPairSerializer,
    ItsmUserSerializer,
    ModuleSerializer,
    RoleAssignmentSerializer,
    RoleModulePermissionSerializer,
    SystemRoleSerializer,
)
from .services import invalidate_permission_cache


class ItsmLoginView(TokenObtainPairView):
    """POST {username, password} → {access, refresh, user}."""

    serializer_class = ItsmTokenObtainPairSerializer


class MeView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(ItsmUserSerializer(request.user).data)


class ModuleViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only catalogue of permission modules (drives the admin role editor)."""

    queryset = Module.objects.filter(is_active=True)
    serializer_class = ModuleSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.admin.roles"
    pagination_class = None


class SystemRoleViewSet(ItsmModelViewSet):
    queryset = SystemRole.objects.filter(is_deleted=False).prefetch_related(
        "permissions__module"
    )
    serializer_class = SystemRoleSerializer
    module_code = "itsm.admin.roles"
    search_fields = ["name", "code"]

    def perform_create(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    @action(detail=True, methods=["put"])
    def permissions(self, request, pk=None):
        """Bulk-set a role's module grants. Body: [{module, can_read, ...}]."""
        role = self.get_object()
        for row in request.data:
            RoleModulePermission.objects.update_or_create(
                role=role,
                module_id=row["module"],
                defaults={
                    "can_read": row.get("can_read", False),
                    "can_create": row.get("can_create", False),
                    "can_update": row.get("can_update", False),
                    "can_delete": row.get("can_delete", False),
                },
            )
        invalidate_permission_cache()
        return Response(SystemRoleSerializer(role).data)


class RoleModulePermissionViewSet(ItsmModelViewSet):
    queryset = RoleModulePermission.objects.filter(is_deleted=False).select_related("module", "role")
    serializer_class = RoleModulePermissionSerializer
    module_code = "itsm.admin.roles"
    filterset_fields = ["role", "module"]

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()


class RoleAssignmentViewSet(ItsmModelViewSet):
    queryset = RoleAssignment.objects.filter(is_deleted=False).select_related("role", "user")
    serializer_class = RoleAssignmentSerializer
    module_code = "itsm.admin.roles"
    filterset_fields = ["role", "user"]

    def perform_create(self, serializer):
        serializer.save()
        invalidate_permission_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_permission_cache()
