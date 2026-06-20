from __future__ import annotations

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import CatalogCategory, CatalogItem
from .serializers import CatalogCategorySerializer, CatalogItemSerializer
from .services import raise_from_catalog


class CatalogCategoryViewSet(ItsmModelViewSet):
    queryset = CatalogCategory.objects.filter(is_deleted=False)
    serializer_class = CatalogCategorySerializer
    module_code = "itsm.catalog.admin"
    filterset_fields = ["helpdesk", "parent", "is_portal_visible"]
    search_fields = ["name"]


class CatalogItemAdminViewSet(ItsmModelViewSet):
    queryset = CatalogItem.objects.filter(is_deleted=False).select_related("category", "project")
    serializer_class = CatalogItemSerializer
    module_code = "itsm.catalog.admin"
    filterset_fields = ["category", "project", "is_active", "is_portal_visible"]
    search_fields = ["name", "short_description"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class CatalogBrowseViewSet(viewsets.ReadOnlyModelViewSet):
    """Browse + raise. Read is `itsm.catalog`; raise overrides to the same module
    (requestors have create there). Agents can browse but not raise."""

    queryset = CatalogItem.objects.filter(
        is_deleted=False, is_active=True, is_portal_visible=True
    ).select_related("category", "project", "project__helpdesk")
    serializer_class = CatalogItemSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.catalog"
    filterset_fields = ["category", "project"]
    search_fields = ["name", "short_description", "description_text"]

    @action(detail=False, methods=["get"])
    def categories(self, request):
        cats = CatalogCategory.objects.filter(
            is_deleted=False, is_portal_visible=True
        ).order_by("sort_order", "name")
        return Response(CatalogCategorySerializer(cats, many=True).data)

    @action(detail=True, methods=["post"], url_path="raise")
    def raise_request(self, request, pk=None):
        item = self.get_object()
        ticket = raise_from_catalog(
            item, requestor=request.user,
            field_values=request.data.get("field_values"),
            summary_override=request.data.get("summary"),
            user=request.user, source="portal",
        )
        from apps.itsm_tickets.serializers import TicketDetailSerializer
        return Response(TicketDetailSerializer(ticket).data, status=http_status.HTTP_201_CREATED)
    raise_request.module_code = "itsm.catalog"
