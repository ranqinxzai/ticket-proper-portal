from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

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

    def _is_manager(self):
        """Superuser or project admin (holds ``itsm.projects:update``). Mirrors
        ``HelpdeskViewSet._is_manager()`` — a manager administers EVERY project and
        is never clamped to their own helpdesk memberships (a non-superuser Admin
        with no helpdesk would otherwise see zero projects)."""
        user = self.request.user
        return getattr(user, "is_superuser", False) or check_permission(
            user, self.module_code, "update"
        )

    def get_queryset(self):
        # The advisory ?helpdesk= param narrows the list (so the queue/create
        # dropdowns only show the selected helpdesk's projects). It is a *view
        # scope*, never an authz boundary — the per-user whitelist below is the real
        # gate — so we resolve it directly (raw id/key), NOT via resolve_helpdesk_scope
        # (which would re-impose membership scope on a non-superuser manager and
        # re-introduce the "manager sees nothing" bug).
        from apps.itsm_helpdesks.services import _resolve_helpdesk_id
        from .services import accessible_project_ids_cached
        qs = super().get_queryset()
        hd_id = _resolve_helpdesk_id(self.request.query_params.get("helpdesk"))
        if hd_id is not None:
            qs = qs.filter(helpdesk_id=hd_id)
        # Managers (superusers / project admins) administer ALL projects — no
        # membership clamp, mirroring HelpdeskViewSet.
        if self._is_manager():
            return qs
        # Non-managers: the strict per-user whitelist is the single source of truth.
        # accessible_project_ids already returns only ids whose helpdesk is in the
        # user's accessible set (memberships + leads), so a separate helpdesk clamp
        # is redundant here and was silently dropping assigned/led projects whenever
        # the membership scope was empty. ``None`` ⇒ unrestricted.
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

    # ── standard-project catalog (import Incident / Request / Problem) ────────
    def _resolve_accessible_helpdesk(self, raw):
        """Resolve an ``id | key`` helpdesk reference and enforce the same access
        rule as ``perform_create``: a non-superuser may only touch helpdesks they
        can access. Unknown and inaccessible both raise **404** — a foreign
        helpdesk must not be distinguishable from a nonexistent one (mirrors the
        never-widen scoping philosophy; a 403 would be a key-existence oracle)."""
        from rest_framework.exceptions import NotFound

        from apps.itsm_helpdesks.models import Helpdesk
        from apps.itsm_helpdesks.services import (
            _resolve_helpdesk_id,
            accessible_helpdesk_ids_cached,
        )

        hd_id = _resolve_helpdesk_id(raw)
        helpdesk = (
            Helpdesk.objects.filter(pk=hd_id, is_deleted=False).first()
            if hd_id is not None else None
        )
        accessible = accessible_helpdesk_ids_cached(self.request)
        if helpdesk is None or (accessible is not None and helpdesk.id not in accessible):
            raise NotFound("Unknown helpdesk.")
        return helpdesk

    @action(detail=False, methods=["get"])
    def standard_templates(self, request):
        """The standard-project catalog (Incident / Request / Problem) annotated
        with `?helpdesk=<id|key>`'s install state — drives the import dialog.
        Non-managers get the `installed` flag but not the id/key of projects
        outside their per-project whitelist (same boundary as GET /projects/)."""
        from .services import accessible_project_ids_cached
        from .standard_projects import template_status

        helpdesk = self._resolve_accessible_helpdesk(request.query_params.get("helpdesk"))
        rows = template_status(helpdesk)
        if not self._is_manager():
            allowed = accessible_project_ids_cached(self.request)
            if allowed is not None:
                allowed = {str(pid) for pid in allowed}
                for row in rows:
                    if row["installed_project_id"] not in allowed:
                        row["installed_project_id"] = None
                        row["installed_project_key"] = None
        return Response(rows)

    @action(detail=False, methods=["post"])
    def import_standard(self, request):
        """Import a standard project into a helpdesk. Body: ``{helpdesk, template}``.
        POST ⇒ the `create` bit on ``itsm.projects`` (same tier as project
        creation). Friendly rejections (already installed, key taken, inactive
        helpdesk) come back as 400s from the service."""
        from .standard_projects import import_standard_project

        helpdesk = self._resolve_accessible_helpdesk(request.data.get("helpdesk"))
        user = request.user if request.user.is_authenticated else None
        try:
            project = import_standard_project(
                helpdesk, request.data.get("template"), user=user
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(ProjectSerializer(project).data, status=201)

    def perform_create(self, serializer):
        # A non-superuser may only create projects inside helpdesks they belong to.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        helpdesk = serializer.validated_data.get("helpdesk")
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and (helpdesk is None or helpdesk.id not in accessible):
            raise PermissionDenied("You do not have access to this helpdesk.")
        user = self.request.user if self.request.user.is_authenticated else None
        project = serializer.save(created_by=user)
        # New projects need at least one ticket type, or the create form is blocked
        # ("This project has no ticket type configured"). Seeded Incident/Request
        # projects get starter types; custom projects get a single default here.
        try:
            from .seed import ensure_default_ticket_type
            ensure_default_ticket_type(project)
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger("itsm").exception(
                "ensure_default_ticket_type failed for project %s", project.pk
            )
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
        # …and their own CSAT survey config (Survey tab) — a clone of the default,
        # shipped disabled. Never let a provisioning hiccup block creation.
        try:
            from apps.itsm_surveys.seed import ensure_survey_config
            ensure_survey_config(project)
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger("itsm").exception(
                "ensure_survey_config failed for project %s", project.pk
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
