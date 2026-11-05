from __future__ import annotations

from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

from .models import ActionType, AutomationRule, TriggerType
from .serializers import AutomationRuleSerializer, AutomationRunSerializer, _is_uuid
from .services.catalog import field_catalog


class ProjectSettingsPermission(HasModulePermission):
    """Rules are project settings: reads need ``itsm.projects:read``, and every write
    (create / edit / delete) needs ``itsm.projects:update``, the same gate as the
    other project-settings tabs."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        action = "read" if request.method in ("GET", "HEAD", "OPTIONS") else "update"
        return check_permission(user, view.module_code, action)


class AutomationRuleViewSet(ItsmModelViewSet):
    queryset = AutomationRule.objects.filter(is_deleted=False).select_related("created_by")
    serializer_class = AutomationRuleSerializer
    permission_classes = [ProjectSettingsPermission]
    module_code = "itsm.projects"
    filterset_fields = ["project", "is_active"]

    def get_queryset(self):
        # Clamp to the caller's accessible helpdesks + projects (rule 15).
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached

        qs = super().get_queryset()
        scope = accessible_helpdesk_ids_cached(self.request)
        if scope is not None:
            qs = qs.filter(project__helpdesk_id__in=scope)
        pscope = accessible_project_ids_cached(self.request)
        if pscope is not None:
            qs = qs.filter(project_id__in=pscope)
        return qs

    def _check_project(self, project):
        from apps.itsm_helpdesks.services import is_project_accessible

        if not is_project_accessible(self.request.user, project.pk, request=self.request):
            raise PermissionDenied("You do not have access to this project.")

    def perform_create(self, serializer):
        self._check_project(serializer.validated_data["project"])
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._check_project(serializer.instance.project)
        serializer.save()

    @action(detail=True, methods=["get"])
    def runs(self, request, pk=None):
        """The rule's most recent 50 runs (newest first)."""
        rule = self.get_object()
        runs = rule.runs.select_related("ticket").order_by("-created_at")[:50]
        return Response(AutomationRunSerializer(runs, many=True).data)

    @action(detail=False, methods=["get"])
    def catalog(self, request):
        """Trigger/action types + the project's watchable and settable fields."""
        from apps.itsm_projects.models import Project

        pid = request.query_params.get("project")
        project = Project.objects.filter(pk=pid, is_deleted=False).first() if _is_uuid(pid) else None
        if project is None:
            return Response({"detail": "Pass ?project=<id>."}, status=http_status.HTTP_400_BAD_REQUEST)
        self._check_project(project)
        return Response({
            "triggers": [{"value": t.value, "label": t.label} for t in TriggerType],
            "actions": [{"value": a.value, "label": a.label} for a in ActionType],
            **field_catalog(project),
        })
