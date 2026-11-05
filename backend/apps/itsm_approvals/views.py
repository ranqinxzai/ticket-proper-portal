from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Prefetch, Q
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_workflows.services.engine import TransitionError

from .models import ApprovalAction, ApprovalRequest, ApprovalStage, ApprovalWorkflow
from .serializers import (
    ApprovalRequestSerializer,
    ApprovalStageSerializer,
    ApprovalWorkflowSerializer,
)
from .services import engine
from .services import send as send_service

_STAGE_RELATED = ("approver_user", "approver_role", "approver_group")


class ApprovalWorkflowViewSet(ItsmModelViewSet):
    queryset = ApprovalWorkflow.objects.filter(is_deleted=False).select_related(
        "helpdesk", "project"
    ).prefetch_related(
        Prefetch("stages", queryset=ApprovalStage.objects.select_related(*_STAGE_RELATED)
                 .prefetch_related("candidate_users"))
    )
    serializer_class = ApprovalWorkflowSerializer
    module_code = "itsm.approvals.admin"
    search_fields = ["name"]
    filterset_fields = ["helpdesk", "project", "is_active"]

    def get_queryset(self):
        # Clamp approval policies to the requester's accessible helpdesks (matched on
        # either the workflow's own helpdesk or its project's helpdesk). Global
        # (null-helpdesk, null-project) policies stay visible to everyone.
        from apps.itsm_helpdesks.services import resolve_helpdesk_scope
        qs = super().get_queryset()
        scope = resolve_helpdesk_scope(
            self.request.user, self.request.query_params.get("helpdesk"), request=self.request
        )
        if scope is not None:
            qs = qs.filter(
                Q(helpdesk_id__in=scope)
                | Q(project__helpdesk_id__in=scope)
                | (Q(helpdesk__isnull=True) & Q(project__isnull=True))
            )
        return qs


class ApprovalStageViewSet(ItsmModelViewSet):
    queryset = ApprovalStage.objects.filter(is_deleted=False).select_related(
        *_STAGE_RELATED).prefetch_related("candidate_users")
    serializer_class = ApprovalStageSerializer
    module_code = "itsm.approvals.admin"
    filterset_fields = ["workflow"]


class ApprovalRequestViewSet(ItsmModelViewSet):
    # ticket__is_deleted: a deleted ticket's requests can't be listed or decided.
    queryset = ApprovalRequest.objects.filter(is_deleted=False, ticket__is_deleted=False).select_related(
        "ticket", "ticket__project", "ticket__project__helpdesk", "ticket__requestor",
        "workflow", "current_stage", "requested_by", "return_status", "waiting_status",
    ).prefetch_related(
        Prefetch("actions", queryset=ApprovalAction.objects.select_related("approver", "stage"))
    )
    serializer_class = ApprovalRequestSerializer
    module_code = "itsm.approvals"
    filterset_fields = ["ticket", "status"]
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        # Acting on / listing one's own approvals is authorized by the service-level
        # approver check (data-driven), not by an agent module grant — so non-agent
        # requestor-managers can approve too. `start` is NOT here: it needs the
        # `itsm.approvals` create grant (A1 — it freezes a ticket's status).
        if self.action in ("approve", "reject", "my_pending"):
            # Plus the `itsm.portal.approvals` (Read) gate for roled users (enforced
            # 2026-10-18; role-less users keep the data-driven behaviour).
            from apps.itsm_rbac.permissions import CanUseApprovalInbox
            return [CanUseApprovalInbox()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action not in ("list", "retrieve", "withdraw"):
            return qs  # approve/reject: the engine's approver check is the boundary
        return self._clamp(qs)

    def _clamp(self, qs):
        """Rule 15 (A2): agents see requests on tickets in their helpdesks (and
        whitelisted projects); everyone else only requests on tickets they raised or
        that they are an approver on. Superusers are unrestricted."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached

        user = self.request.user
        hd = accessible_helpdesk_ids_cached(self.request)
        if hd is None:
            return qs
        pids = accessible_project_ids_cached(self.request)
        agent_q = Q(ticket__project__helpdesk_id__in=hd)
        if pids is not None:
            agent_q &= Q(ticket__project_id__in=list(pids))
        approver_ids = list(
            ApprovalRequest.objects.filter(actions__approver=user).values_list("id", flat=True)
        ) + [r.id for r in engine.pending_for(user)]
        return qs.filter(agent_q | Q(ticket__requestor=user) | Q(id__in=approver_ids)).distinct()

    @action(detail=False, methods=["get"], url_path="my-pending")
    def my_pending(self, request):
        rows = engine.pending_for(request.user).prefetch_related(
            Prefetch("actions", queryset=ApprovalAction.objects.select_related("approver", "stage"))
        )
        return Response(ApprovalRequestSerializer(rows, many=True,
                                                  context=self.get_serializer_context()).data)

    @action(detail=False, methods=["post"])
    def start(self, request):
        """Body: {ticket, workflow}. Starts a multi-level approval on a ticket.

        Needs the `itsm.approvals` create grant AND access to the ticket's helpdesk +
        project (A1). Refused with 400 when a stage has nobody who could decide it."""
        from apps.itsm_helpdesks.services import is_project_accessible
        from apps.itsm_tickets.models import Ticket

        ticket = Ticket.objects.filter(pk=request.data.get("ticket"), is_deleted=False).first()
        workflow = ApprovalWorkflow.objects.filter(
            pk=request.data.get("workflow"), is_deleted=False
        ).first()
        if not ticket or not workflow:
            return Response({"detail": "ticket and workflow are required."}, status=400)
        if not is_project_accessible(request.user, ticket.project_id, request=request):
            return Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            req = engine.start_approval(ticket, workflow, user=request.user)
        except TransitionError as exc:
            return Response({"detail": exc.message, **({"errors": exc.errors} if exc.errors else {})},
                            status=exc.status_code)
        return Response(ApprovalRequestSerializer(req, context=self.get_serializer_context()).data,
                        status=http_status.HTTP_201_CREATED)

    # ── Send for approval (2026-10-24) ─────────────────────────────────────────
    def _accessible_ticket(self, request, ticket_id):
        """The ticket, or (None, 400/404 response). Rule 15: an inaccessible ticket is a
        404, never a hint that it exists."""
        from apps.itsm_helpdesks.services import is_project_accessible
        from apps.itsm_tickets.models import Ticket

        if not ticket_id:
            return None, Response({"detail": "ticket is required."}, status=400)
        try:
            ticket = (Ticket.objects.filter(pk=ticket_id, is_deleted=False)
                      .select_related("status", "status__category", "status__approval_waiting_status",
                                      "status__approval_waiting_status__category", "requestor")
                      .first())
        except (ValueError, DjangoValidationError):
            ticket = None
        if ticket is None or not is_project_accessible(request.user, ticket.project_id, request=request):
            return None, Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        return ticket, None

    @action(detail=False, methods=["get"], url_path="send-options")
    def send_options(self, request):
        """``?ticket=<id>`` → what the Send for approval drawer offers (policies, who
        their stages resolve to, On-fly pools) and whether the ticket can be sent now."""
        ticket, err = self._accessible_ticket(request, request.query_params.get("ticket"))
        if err is not None:
            return err
        return Response(send_service.send_options(ticket, request.user))
    send_options.module_code = "itsm.approvals.send"

    @action(detail=False, methods=["post"])
    def send(self, request):
        """Body: {ticket, workflow, approvers?: {stage_id: [user_id]}, note?}. Starts the
        approval from a status that allows it and moves the ticket to the waiting
        status. 400 on a refusal (with per-stage ``errors.approval``), 409 when one is
        already pending."""
        from .models import ApprovalWorkflow

        ticket, err = self._accessible_ticket(request, request.data.get("ticket"))
        if err is not None:
            return err
        try:
            workflow = ApprovalWorkflow.objects.filter(
                pk=request.data.get("workflow"), is_deleted=False).first()
        except (ValueError, DjangoValidationError):
            workflow = None
        try:
            req = send_service.send_for_approval(
                ticket, workflow, request.user,
                picks=request.data.get("approvers"), note=request.data.get("note") or "",
            )
        except TransitionError as exc:
            return Response({"detail": exc.message, **({"errors": exc.errors} if exc.errors else {})},
                            status=exc.status_code)
        req = self.get_queryset().get(pk=req.pk)
        return Response(ApprovalRequestSerializer(req, context=self.get_serializer_context()).data,
                        status=http_status.HTTP_201_CREATED)
    send.module_code = "itsm.approvals.send"

    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        """Body: {reason?}. Cancels a pending request sent from the ticket and returns
        the ticket to the status it was sent from. The sender may always withdraw;
        others need ``itsm.approvals.send`` delete."""
        from apps.itsm_helpdesks.services import is_project_accessible

        req = self.get_object()
        if not is_project_accessible(request.user, req.ticket.project_id, request=request):
            return Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            send_service.withdraw(req, request.user, request.data.get("reason") or "")
        except TransitionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        updated = self.get_queryset().get(pk=req.pk)
        return Response(ApprovalRequestSerializer(updated, context=self.get_serializer_context()).data)
    withdraw.module_code = "itsm.approvals.send"

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        # The reason is required (U3): it's the only record of why work stopped, and
        # it's shown in the ticket's approval history.
        if not str(request.data.get("comment") or "").strip():
            return Response({"detail": "Give a reason for rejecting this approval.",
                             "errors": {"comment": ["A reason is required."]}}, status=400)
        return self._decide(request, "rejected")

    def _decide(self, request, decision):
        req = self.get_object()
        try:
            updated = engine.decide(req, request.user, decision, request.data.get("comment", ""))
        except TransitionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        updated = self.get_queryset().get(pk=updated.pk)  # fresh actions + state
        return Response(ApprovalRequestSerializer(updated, context=self.get_serializer_context()).data)
