from __future__ import annotations

from django.db.models import Q
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

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


class SavedFilterViewSet(ItsmModelViewSet):
    queryset = SavedFilter.objects.filter(is_deleted=False).select_related("project")
    serializer_class = SavedFilterSerializer
    module_code = "itsm.tickets.queue"
    search_fields = ["name"]

    def get_queryset(self):
        """A user sees their own filters (any project) plus shared ones. When a
        ``?project=`` is given, shared filters are limited to that project or the
        cross-project (null-project) shared ones; without it, only cross-project
        shared filters surface (project-scoped ones belong to their own queue)."""
        qs = super().get_queryset()
        user = self.request.user
        owned = Q(owner=user) if (user and user.is_authenticated) else Q(pk__in=[])
        project = self.request.query_params.get("project")
        if project:
            shared = Q(is_shared=True) & (Q(project_id=project) | Q(project__isnull=True))
        else:
            shared = Q(is_shared=True, project__isnull=True)
        return qs.filter(owned | shared)

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
    the requester so no one reads another agent's default."""

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
