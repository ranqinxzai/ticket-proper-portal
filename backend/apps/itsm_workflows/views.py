from __future__ import annotations

from django.db import transaction
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import (
    AutoAssignmentRule,
    ReopenRule,
    Status,
    StatusCategory,
    Transition,
    TransitionScreen,
    Workflow,
)
from .services import starter
from .serializers import (
    AutoAssignmentRuleSerializer,
    ReopenRuleSerializer,
    StatusCategorySerializer,
    StatusSerializer,
    TransitionScreenSerializer,
    TransitionSerializer,
    WorkflowGraphSerializer,
    WorkflowSerializer,
)
from .validators import validate_workflow_graph


class StatusCategoryViewSet(ItsmModelViewSet):
    queryset = StatusCategory.objects.all()
    serializer_class = StatusCategorySerializer
    module_code = "itsm.workflows"
    pagination_class = None


class WorkflowViewSet(ItsmModelViewSet):
    queryset = Workflow.objects.filter(is_deleted=False)
    serializer_class = WorkflowSerializer
    module_code = "itsm.workflows"
    search_fields = ["name"]
    filterset_fields = ["base_type", "is_active"]

    @action(detail=True, methods=["get"])
    def graph(self, request, pk=None):
        wf = self.get_object()
        return Response(WorkflowGraphSerializer(wf).data)

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        """Validate the workflow graph (reachability, single initial, etc.)."""
        wf = self.get_object()
        result = validate_workflow_graph(wf)
        return Response(result)

    @action(detail=False, methods=["post"])
    def create_starter(self, request):
        """Create a new, immediately-valid starter workflow (To Do → In Progress → Done).

        Gives the config UI a way to create a workflow from scratch (the empty-state has no
        source id, so this is a list action). POST → the `create` CRUD action, so it's gated by
        the existing `itsm.workflows` create permission. The caller links it to the project
        (`Project.default_workflow`) separately. Returns the new workflow (201)."""
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"name": ["A workflow name is required."]}, status=400)
        base_type = request.data.get("base_type") or "custom"
        try:
            wf = starter.create_starter_workflow(name, base_type=base_type)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(WorkflowSerializer(wf).data, status=201)


class StatusViewSet(ItsmModelViewSet):
    queryset = Status.objects.filter(is_deleted=False).select_related("category")
    serializer_class = StatusSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow"]


class TransitionViewSet(ItsmModelViewSet):
    queryset = Transition.objects.filter(is_deleted=False).select_related(
        "from_status", "to_status"
    ).prefetch_related("conditions", "screen__fields")
    serializer_class = TransitionSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow", "from_status"]


class AutoAssignmentRuleViewSet(ItsmModelViewSet):
    queryset = AutoAssignmentRule.objects.filter(is_deleted=False)
    serializer_class = AutoAssignmentRuleSerializer
    module_code = "itsm.workflows.transitions"


class ReopenRuleViewSet(ItsmModelViewSet):
    queryset = ReopenRule.objects.filter(is_deleted=False)
    serializer_class = ReopenRuleSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow"]


class TransitionScreenViewSet(ItsmModelViewSet):
    queryset = TransitionScreen.objects.filter(is_deleted=False)
    serializer_class = TransitionScreenSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow"]
