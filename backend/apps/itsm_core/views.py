from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import FieldDefinition, FieldLayout, FieldLayoutItem, FieldOption
from .serializers import (
    FieldDefinitionSerializer,
    FieldLayoutItemSerializer,
    FieldLayoutSerializer,
    FieldOptionSerializer,
)
from .services import fields as field_service


class FieldDefinitionViewSet(ItsmModelViewSet):
    queryset = FieldDefinition.objects.filter(is_deleted=False).prefetch_related("options")
    serializer_class = FieldDefinitionSerializer
    module_code = "itsm.fields"
    # `project` is handled in get_queryset so it also returns GLOBAL (project=null)
    # system fields — an exact filterset match would hide the standard catalog.
    filterset_fields = ["field_type"]
    search_fields = ["name", "key"]

    def get_queryset(self):
        from django.db.models import Q
        qs = super().get_queryset()
        project = self.request.query_params.get("project")
        if project:
            qs = qs.filter(Q(project=project) | Q(project__isnull=True))
        return qs


class FieldOptionViewSet(ItsmModelViewSet):
    queryset = FieldOption.objects.filter(is_deleted=False)
    serializer_class = FieldOptionSerializer
    module_code = "itsm.fields"
    filterset_fields = ["field"]


class FieldLayoutViewSet(ItsmModelViewSet):
    queryset = FieldLayout.objects.filter(is_deleted=False).prefetch_related("items__field")
    serializer_class = FieldLayoutSerializer
    module_code = "itsm.fields.layouts"
    filterset_fields = ["project", "ticket_type"]

    @action(detail=False, methods=["get"])
    def resolve(self, request):
        """GET ?project=&ticket_type= → the layout that applies (specific or default)."""
        from apps.itsm_projects.models import Project, TicketType

        project = Project.objects.filter(pk=request.query_params.get("project")).first()
        if project is None:
            return Response({"detail": "project required"}, status=400)
        tt_id = request.query_params.get("ticket_type")
        ticket_type = TicketType.objects.filter(pk=tt_id).first() if tt_id else None
        layout = field_service.get_layout(project, ticket_type)
        if layout is None:
            return Response({"id": None, "items": []})
        return Response(FieldLayoutSerializer(layout).data)


class FieldLayoutItemViewSet(ItsmModelViewSet):
    queryset = FieldLayoutItem.objects.filter(is_deleted=False).select_related("field")
    serializer_class = FieldLayoutItemSerializer
    module_code = "itsm.fields.layouts"
    filterset_fields = ["layout"]
