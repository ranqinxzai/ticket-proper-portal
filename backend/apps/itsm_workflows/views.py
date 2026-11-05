from __future__ import annotations

import uuid

from django.db import models, transaction
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
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
from .services import cloner, engine, starter
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


class Refused(APIException):
    """400 with a plain-string ``detail`` (the client toasts it verbatim)."""

    status_code = 400
    default_detail = "This change isn't allowed."


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

    @action(detail=True, methods=["get"])
    def usage(self, request, pk=None):
        """Which projects use this workflow as their Default workflow (U6) — the editor's
        "Shared by N projects" banner. Scoped like the project list: project admins
        (``itsm.projects:update``) see every project; others see only projects they can
        access, and the rest are only counted (``hidden_count``)."""
        from apps.itsm_projects.models import Project
        from apps.itsm_projects.services import accessible_project_ids_cached

        wf = self.get_object()
        rows = list(Project.objects.filter(default_workflow=wf, is_deleted=False)
                    .select_related("helpdesk").order_by("key"))
        pids = accessible_project_ids_cached(request)
        visible = rows if pids is None else [p for p in rows if p.id in set(pids)]
        return Response({
            "project_count": len(rows),
            "projects": [{"id": str(p.id), "key": p.key, "name": p.name,
                          "helpdesk_key": getattr(p.helpdesk, "key", None)} for p in visible],
            "hidden_count": len(rows) - len(visible),
            "is_default": wf.is_default,
            "base_type": wf.base_type,
        })

    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None):
        """Copy this workflow; with ``project`` also link the copy as that project's
        Default workflow ("Make a copy for this project", U6). POST ⇒ ``itsm.workflows``
        create; linking additionally needs ``itsm.projects:update`` (project admins
        administer every project, mirroring ProjectViewSet). Open tickets keep their
        snapshotted workflow (rule 10). Body ``{project?, name?}`` → 201 workflow +
        ``automation: {repointed, unmatched}``."""
        from apps.itsm_projects.models import Project
        from apps.itsm_rbac.services import check_permission

        source = self.get_object()
        project = None
        project_id = request.data.get("project")
        if project_id:
            try:
                uuid.UUID(str(project_id))
            except (ValueError, TypeError, AttributeError):
                return Response({"project": ["Not a valid project id."]}, status=400)
            if not check_permission(request.user, "itsm.projects", "update"):
                return Response({"detail": "You need permission to edit project settings "
                                           "to link a workflow to a project."}, status=403)
            project = Project.objects.filter(pk=project_id, is_deleted=False).first()
            if project is None:
                return Response({"detail": "Project not found."}, status=404)
            if project.default_workflow_id != source.id:
                return Response({"detail": "This project doesn't use this workflow."}, status=400)
        try:
            wf, report = cloner.clone_workflow(source, name=request.data.get("name"), project=project)
        except ValueError as exc:
            return Response({"name": [str(exc)]}, status=400)
        data = dict(WorkflowSerializer(wf).data)
        data["automation"] = report
        return Response(data, status=201)


class StatusViewSet(ItsmModelViewSet):
    queryset = Status.objects.filter(is_deleted=False).select_related("category")
    serializer_class = StatusSerializer
    module_code = "itsm.workflows.transitions"
    filterset_fields = ["workflow"]

    @transaction.atomic
    def perform_destroy(self, instance):
        """Delete a status (U1/C5). Refused while live tickets sit in it (they'd be
        stranded with no way out) or when new tickets start in it. Otherwise the status
        AND its incoming/outgoing transitions are soft-deleted — soft delete doesn't
        trigger the FK CASCADE, and a live transition into a deleted status would still
        move tickets there."""
        from apps.itsm_tickets.models import Ticket

        n = Ticket.objects.filter(status=instance).count()
        if n:
            raise Refused(
                f"{n} ticket{'s are' if n != 1 else ' is'} in “{instance.name}”. "
                "Move them to another status first.")
        start = engine.start_status_for(instance.workflow)
        if start is not None and start.id == instance.id:
            raise Refused(f"New tickets start in “{instance.name}”, so it can't be deleted.")
        waiting_for = list(Status.objects.filter(approval_waiting_status=instance)
                           .exclude(pk=instance.pk).values_list("name", flat=True)[:3])
        if waiting_for:
            raise Refused(
                f"Tickets sent for approval from {', '.join(f'“{n}”' for n in waiting_for)} wait in "
                f"“{instance.name}”. Change that in their status settings first.")
        user = self.request.user if self.request.user.is_authenticated else None
        for tr in Transition.objects.filter(workflow_id=instance.workflow_id).filter(
                models.Q(from_status=instance) | models.Q(to_status=instance)):
            tr.soft_delete(user=user)
        instance.soft_delete(user=user)


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
