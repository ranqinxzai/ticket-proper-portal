from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Project, ProjectMembership, TicketType
from .serializers import (
    ProjectMembershipSerializer,
    ProjectSerializer,
    ProjectWriteSerializer,
    TicketTypeSerializer,
)


class ProjectViewSet(ItsmModelViewSet):
    queryset = Project.objects.filter(is_deleted=False).select_related(
        "helpdesk", "default_group", "default_workflow"
    ).prefetch_related("ticket_types")
    module_code = "itsm.projects"
    search_fields = ["name", "key", "description"]
    filterset_fields = ["project_type", "status"]
    lookup_field = "pk"

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return ProjectWriteSerializer
        return ProjectSerializer

    def get_queryset(self):
        # Scope projects to the requester's accessible helpdesks, honouring the
        # advisory ?helpdesk= clamp (so the queue/create dropdowns only list the
        # selected helpdesk's projects). Superusers are unrestricted.
        from apps.itsm_helpdesks.services import resolve_helpdesk_scope
        from .services import accessible_project_ids_cached
        qs = super().get_queryset()
        scope = resolve_helpdesk_scope(
            self.request.user, self.request.query_params.get("helpdesk"), request=self.request
        )
        if scope is not None:
            qs = qs.filter(helpdesk_id__in=scope)
        # Finer per-user clamp (strict whitelist): only projects the user may access.
        pids = accessible_project_ids_cached(self.request)
        if pids is not None:
            qs = qs.filter(pk__in=pids)
        return qs

    # ── per-user project assignment (from User Management) ───────────────────
    # Gated by `itsm.admin.helpdesks` (the membership-admin module), NOT
    # `itsm.projects` (project config) — assigning people is a roster function.
    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        from django.contrib.auth import get_user_model

        from apps.itsm_rbac.services import is_requestor

        # Fetch unscoped: membership admin (gated by itsm.admin.helpdesks) is not
        # limited by the admin's own agent-facing project/helpdesk scope.
        project = Project.objects.filter(pk=pk, is_deleted=False).first()
        if project is None:
            return Response({"detail": "Unknown project."}, status=404)
        target = get_user_model().objects.filter(pk=request.data.get("user")).first()
        if target is None:
            return Response({"detail": "Unknown user."}, status=400)
        if is_requestor(target):
            return Response(
                {"detail": "Requestors cannot be assigned to a project."}, status=400
            )
        membership, _ = ProjectMembership.objects.update_or_create(
            project=project, user=target,
            defaults={"is_active": True, "is_deleted": False},
        )
        return Response(ProjectMembershipSerializer(membership).data, status=201)
    add_member.module_code = "itsm.admin.helpdesks"

    @action(detail=True, methods=["post"])
    def remove_member(self, request, pk=None):
        project = Project.objects.filter(pk=pk, is_deleted=False).first()
        if project is None:
            return Response({"detail": "Unknown project."}, status=404)
        ProjectMembership.objects.filter(
            project=project, user_id=request.data["user"]
        ).update(is_active=False)
        return Response(status=204)
    remove_member.module_code = "itsm.admin.helpdesks"

    def perform_create(self, serializer):
        # A non-superuser may only create projects inside helpdesks they belong to.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        helpdesk = serializer.validated_data.get("helpdesk")
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and (helpdesk is None or helpdesk.id not in accessible):
            raise PermissionDenied("You do not have access to this helpdesk.")
        user = self.request.user if self.request.user.is_authenticated else None
        project = serializer.save(created_by=user)
        # New projects get the standard field set + default layout (Fields/Layout tabs).
        from apps.itsm_core.seed import ensure_project_layout
        ensure_project_layout(project)
        # …and their own notification scheme (Notifications tab) — a clone of the
        # default rules + templates. Never let a provisioning hiccup block creation.
        try:
            from apps.itsm_notifications.seed import ensure_notification_scheme
            ensure_notification_scheme(project)
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger("itsm").exception(
                "ensure_notification_scheme failed for project %s", project.pk
            )


class TicketTypeViewSet(ItsmModelViewSet):
    queryset = TicketType.objects.filter(is_deleted=False)
    serializer_class = TicketTypeSerializer
    module_code = "itsm.projects.config"
    filterset_fields = ["project", "base_category", "is_active"]


class ProjectMembershipViewSet(ItsmModelViewSet):
    """Per-user project access grants — listed/filtered for the User-Management UI
    (``?user=`` seeds the assignment checkboxes). Membership admin, so gated by
    ``itsm.admin.helpdesks`` (same as helpdesk membership), not project config."""

    queryset = ProjectMembership.objects.filter(is_deleted=False).select_related(
        "user", "project", "project__helpdesk"
    )
    serializer_class = ProjectMembershipSerializer
    module_code = "itsm.admin.helpdesks"
    filterset_fields = ["project", "user", "is_active"]
