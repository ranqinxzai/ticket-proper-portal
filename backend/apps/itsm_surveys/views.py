from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import SCALES, ScaleType, SurveyConfig, SurveyTrigger
from .serializers import SurveyConfigSerializer


class SurveyConfigViewSet(ItsmModelViewSet):
    """Per-project CSAT survey configuration (Survey settings tab). Supervisor-only
    (``itsm.surveys.config``). Projects are provisioned a config on create + backfill;
    the ``for-project`` action self-heals older projects on first open."""

    queryset = SurveyConfig.objects.filter(is_deleted=False).select_related("project")
    serializer_class = SurveyConfigSerializer
    module_code = "itsm.surveys.config"
    filterset_fields = ["project", "is_default", "enabled"]

    @action(detail=False, methods=["get"])
    def metadata(self, request):
        """Static catalog of scale types + triggers so the settings UI renders
        without hardcoding (each scale reports its valid rating values)."""
        return Response({
            "scale_types": [
                {"value": s.value, "label": s.label, "values": SCALES[s.value]["values"]}
                for s in ScaleType
            ],
            "triggers": [{"value": t.value, "label": t.label} for t in SurveyTrigger],
        })

    @action(detail=False, methods=["get"], url_path="for-project")
    def for_project(self, request):
        """Return a project's survey config, provisioning the per-project clone on
        first access (projects created before this feature)."""
        from apps.itsm_projects.models import Project

        from .seed import ensure_survey_config

        project_id = request.query_params.get("project")
        if not project_id:
            return Response({"detail": "A 'project' query parameter is required."}, status=400)
        project = Project.objects.filter(pk=project_id, is_deleted=False).first()
        if project is None:
            return Response({"detail": "Project not found."}, status=404)
        config = ensure_survey_config(project)
        return Response(self.get_serializer(config).data)
