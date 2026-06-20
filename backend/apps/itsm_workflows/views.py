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


class StatusViewSet(ItsmModelViewSet):
    queryset = Status.objects.filter(is_deleted=False).select_related("category")
    serializer_class = StatusSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow"]


class TransitionViewSet(ItsmModelViewSet):
    queryset = Transition.objects.filter(is_deleted=False).select_related(
        "from_status", "to_status"
    ).prefetch_related("conditions")
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
