from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import ApprovalRequest, ApprovalStage, ApprovalWorkflow
from .serializers import (
    ApprovalRequestSerializer,
    ApprovalStageSerializer,
    ApprovalWorkflowSerializer,
)
from .services import engine


class ApprovalWorkflowViewSet(ItsmModelViewSet):
    queryset = ApprovalWorkflow.objects.filter(is_deleted=False).prefetch_related("stages")
    serializer_class = ApprovalWorkflowSerializer
    module_code = "itsm.approvals.admin"
    search_fields = ["name"]
    filterset_fields = ["helpdesk", "is_active"]


class ApprovalStageViewSet(ItsmModelViewSet):
    queryset = ApprovalStage.objects.filter(is_deleted=False)
    serializer_class = ApprovalStageSerializer
    module_code = "itsm.approvals.admin"
    filterset_fields = ["workflow"]


class ApprovalRequestViewSet(ItsmModelViewSet):
    queryset = ApprovalRequest.objects.filter(is_deleted=False).select_related(
        "ticket", "workflow", "current_stage"
    ).prefetch_related("actions")
    serializer_class = ApprovalRequestSerializer
    module_code = "itsm.approvals"
    filterset_fields = ["ticket", "status"]
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Acting on / listing one's own approvals is authorized by the service-level
        # approver check (data-driven), not by an agent module grant — so non-agent
        # requestor-managers can approve too.
        if self.action in ("approve", "reject", "my_pending", "start"):
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=["get"], url_path="my-pending")
    def my_pending(self, request):
        rows = engine.pending_for(request.user)
        return Response(ApprovalRequestSerializer(rows, many=True).data)

    @action(detail=False, methods=["post"])
    def start(self, request):
        """Body: {ticket, workflow}. Starts a multi-level approval on a ticket."""
        from apps.itsm_tickets.models import Ticket
        ticket = Ticket.objects.filter(pk=request.data.get("ticket"), is_deleted=False).first()
        workflow = ApprovalWorkflow.objects.filter(
            pk=request.data.get("workflow"), is_deleted=False
        ).first()
        if not ticket or not workflow:
            return Response({"detail": "ticket and workflow are required."}, status=400)
        req = engine.start_approval(ticket, workflow, user=request.user)
        return Response(ApprovalRequestSerializer(req).data, status=http_status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, "rejected")

    def _decide(self, request, decision):
        req = self.get_object()
        try:
            updated = engine.decide(req, request.user, decision, request.data.get("comment", ""))
        except Exception as exc:  # TransitionError carries status_code/message
            code = getattr(exc, "status_code", 400)
            return Response({"detail": getattr(exc, "message", str(exc))}, status=code)
        return Response(ApprovalRequestSerializer(updated).data)
