from __future__ import annotations

from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Dashboard, SavedFilter, Widget
from .serializers import DashboardSerializer, SavedFilterSerializer, WidgetSerializer


def _owned_or_shared(qs, user):
    if user and user.is_authenticated:
        return qs.filter(Q(owner=user) | Q(is_shared=True))
    return qs.filter(is_shared=True)


class SavedFilterViewSet(ItsmModelViewSet):
    queryset = SavedFilter.objects.filter(is_deleted=False)
    serializer_class = SavedFilterSerializer
    module_code = "itsm.tickets.queue"
    search_fields = ["name"]

    def get_queryset(self):
        return _owned_or_shared(super().get_queryset(), self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user if self.request.user.is_authenticated else None)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        """Run the filter and return matching tickets (count + first page)."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_tickets.serializers import TicketListSerializer
        from apps.itsm_tickets.services import query_builder
        sf = self.get_object()
        qs = query_builder.filtered_tickets(
            sf.query_spec, user=request.user,
            accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request),
        )[:100]
        return Response(TicketListSerializer(qs, many=True).data)


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
        from apps.itsm_reporting.services import widget_data
        widget = self.get_object()
        return Response(widget_data.resolve(
            widget, user=request.user,
            accessible_helpdesk_ids=accessible_helpdesk_ids_cached(request),
        ))
