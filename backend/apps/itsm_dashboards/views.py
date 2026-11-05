from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

from .models import Dashboard, QueueColumnPreference, QueueViewPreference, SavedFilter, Widget
from .serializers import (
    DashboardSerializer,
    QueueColumnPreferenceSerializer,
    QueueViewPreferenceSerializer,
    SavedFilterSerializer,
    WidgetSerializer,
)


def _owned_or_shared(qs, user):
    if user and user.is_authenticated:
        return qs.filter(Q(owner=user) | Q(is_shared=True))
    return qs.filter(is_shared=True)


class _OwnViewOrDelete(BasePermission):
    """DELETE on a saved view: the OWNER may always delete their own view (personal
    data — the seeded Agent has no Delete bit on ``itsm.tickets.queue``, so agents
    could never remove a view they saved); anyone else's view still needs that Delete
    bit. Queue Read is the floor either way."""

    message = "You can only delete your own views."

    def has_permission(self, request, view):
        return check_permission(request.user, view.module_code, "read")

    def has_object_permission(self, request, view, obj):
        user = request.user
        if obj.owner_id is not None and obj.owner_id == user.pk:
            return True
        return check_permission(user, view.module_code, "delete")


class SavedFilterViewSet(ItsmModelViewSet):
    queryset = SavedFilter.objects.filter(is_deleted=False).select_related("project", "owner")
    serializer_class = SavedFilterSerializer
    module_code = "itsm.tickets.queue"
    search_fields = ["name"]

    def get_permissions(self):
        if self.action == "destroy":
            return [_OwnViewOrDelete()]
        return super().get_permissions()

    def _visible_shared(self):
        """Shared views the caller may see anywhere (rule 15 clamp; ``None`` = all)."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached

        acc = accessible_helpdesk_ids_cached(self.request)
        pacc = accessible_project_ids_cached(self.request)
        q = Q(is_shared=True)
        if acc is not None:
            q &= (Q(project__isnull=True, helpdesk_id__in=acc)
                  | Q(project__isnull=False, project__helpdesk_id__in=acc))
        if pacc is not None:
            q &= Q(project__isnull=True) | Q(project_id__in=pacc)
        return q

    def get_queryset(self):
        """A view belongs to the queue it was saved from (S5, 2026-10-18).

        * ``?project=X`` (a project queue): my views saved in X, X's shared views, and
          views shared from X's helpdesk's All Tickets. Nothing if X isn't accessible.
        * ``?helpdesk=H`` (All Tickets): my views saved in H's All Tickets, H's shared
          All-Tickets views, plus my own legacy unscoped views (project & helpdesk
          null). Nothing if H isn't accessible (never widens, never 403s).
        * no scope / detail actions: my views (any scope) + shared views I can see.
        """
        from apps.itsm_helpdesks.services import (
            _resolve_helpdesk_id,
            accessible_helpdesk_ids_cached,
            is_project_accessible,
        )
        from apps.itsm_projects.models import Project

        qs = super().get_queryset()
        user = self.request.user
        if not (user and user.is_authenticated):
            return qs.none()
        mine = Q(owner=user)
        if self.action != "list":
            return qs.filter(mine | self._visible_shared())

        params = self.request.query_params
        project_id = params.get("project")
        helpdesk_param = params.get("helpdesk")
        if project_id:
            try:
                project = Project.objects.filter(pk=project_id, is_deleted=False).first()
            except (ValueError, DjangoValidationError):
                project = None
            if project is None or not is_project_accessible(
                    user, project.pk, request=self.request):
                return qs.none()
            return qs.filter(
                (mine & Q(project=project))
                | Q(is_shared=True, project=project)
                | Q(is_shared=True, project__isnull=True, helpdesk_id=project.helpdesk_id)
            )
        if helpdesk_param:
            hd_id = _resolve_helpdesk_id(helpdesk_param)
            acc = accessible_helpdesk_ids_cached(self.request)
            if hd_id is None or (acc is not None and hd_id not in acc):
                return qs.none()
            return qs.filter(
                (mine & Q(project__isnull=True, helpdesk_id=hd_id))
                | Q(is_shared=True, project__isnull=True, helpdesk_id=hd_id)
                | (mine & Q(project__isnull=True, helpdesk__isnull=True))
            )
        return qs.filter(mine | self._visible_shared())

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user if self.request.user.is_authenticated else None)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        """Run the filter and return matching tickets (count + first page)."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached
        from apps.itsm_tickets.serializers import TicketListSerializer
        from apps.itsm_tickets.services import query_builder
        sf = self.get_object()
        qs = query_builder.filtered_tickets(
            sf.query_spec, user=request.user,
            accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request),
            accessible_project_ids=accessible_project_ids_cached(request),
        )[:100]
        return Response(TicketListSerializer(qs, many=True).data)


class QueueColumnPreferenceViewSet(ItsmModelViewSet):
    """The caller's own ticket-queue column layout, per project. ``POST`` upserts
    (so the frontend can always POST without tracking the row id); listing is
    clamped to the requester so no one reads another agent's layout."""

    queryset = QueueColumnPreference.objects.filter(is_deleted=False).select_related("project")
    serializer_class = QueueColumnPreferenceSerializer
    module_code = "itsm.tickets.queue"
    filterset_fields = ["project"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        return qs.filter(owner=user) if (user and user.is_authenticated) else qs.none()

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj, _ = QueueColumnPreference.objects.update_or_create(
            owner=request.user, project=ser.validated_data["project"],
            defaults={"columns": ser.validated_data.get("columns", [])},
        )
        return Response(self.get_serializer(obj).data, status=http_status.HTTP_201_CREATED)


class QueueViewPreferenceViewSet(ItsmModelViewSet):
    """The caller's own default queue view, per project. ``POST`` upserts (so the
    frontend can always POST without tracking the row id); listing is clamped to
    the requester so no one reads another agent's default. ``POST`` with a blank
    ``view_key`` CLEARS the default (the queue then falls back to the project
    default) — the ★ toggle-off uses it; no Delete bit needed."""

    queryset = QueueViewPreference.objects.filter(is_deleted=False).select_related("project")
    serializer_class = QueueViewPreferenceSerializer
    module_code = "itsm.tickets.queue"
    filterset_fields = ["project"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        return qs.filter(owner=user) if (user and user.is_authenticated) else qs.none()

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj, _ = QueueViewPreference.objects.update_or_create(
            owner=request.user, project=ser.validated_data["project"],
            defaults={"view_key": ser.validated_data.get("view_key", "")},
        )
        return Response(self.get_serializer(obj).data, status=http_status.HTTP_201_CREATED)


class DashboardViewSet(ItsmModelViewSet):
    queryset = Dashboard.objects.filter(is_deleted=False).prefetch_related("widgets")
    serializer_class = DashboardSerializer
    module_code = "itsm.dashboards"
    search_fields = ["name"]

    def get_queryset(self):
        return _owned_or_shared(super().get_queryset(), self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user if self.request.user.is_authenticated else None)


class WidgetViewSet(ItsmModelViewSet):
    queryset = Widget.objects.filter(is_deleted=False)
    serializer_class = WidgetSerializer
    module_code = "itsm.dashboards"
    filterset_fields = ["dashboard", "widget_type"]

    def get_queryset(self):
        # Only widgets on dashboards the caller owns or that are shared (same rule as
        # DashboardViewSet) — otherwise `widgets/<id>/data/` ran anyone's widget.
        qs = super().get_queryset().filter(dashboard__is_deleted=False)
        user = self.request.user
        if user and user.is_authenticated:
            return qs.filter(Q(dashboard__owner=user) | Q(dashboard__is_shared=True))
        return qs.filter(dashboard__is_shared=True)

    def perform_create(self, serializer):
        self._check_dashboard(serializer.validated_data.get("dashboard"))
        serializer.save()

    def perform_update(self, serializer):
        if "dashboard" in serializer.validated_data:
            self._check_dashboard(serializer.validated_data["dashboard"])
        serializer.save()

    def _check_dashboard(self, dashboard):
        user = self.request.user
        if dashboard is None or getattr(user, "is_superuser", False):
            return
        if dashboard.owner_id != user.pk and not dashboard.is_shared:
            raise PermissionDenied("You can't add widgets to this dashboard.")

    @action(detail=True, methods=["get"])
    def data(self, request, pk=None):
        """Resolve a widget's data payload (delegates to the reporting service)."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached
        from apps.itsm_reporting.services import widget_data
        widget = self.get_object()
        return Response(widget_data.resolve(
            widget, user=request.user,
            accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request),
            accessible_project_ids=accessible_project_ids_cached(request),
        ))
