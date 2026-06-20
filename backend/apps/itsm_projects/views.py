from __future__ import annotations

from rest_framework.exceptions import PermissionDenied

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import Project, TicketType
from .serializers import ProjectSerializer, ProjectWriteSerializer, TicketTypeSerializer


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
        qs = super().get_queryset()
        scope = resolve_helpdesk_scope(
            self.request.user, self.request.query_params.get("helpdesk"), request=self.request
        )
        if scope is not None:
            qs = qs.filter(helpdesk_id__in=scope)
        return qs

    def perform_create(self, serializer):
        # A non-superuser may only create projects inside helpdesks they belong to.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        helpdesk = serializer.validated_data.get("helpdesk")
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and (helpdesk is None or helpdesk.id not in accessible):
            raise PermissionDenied("You do not have access to this helpdesk.")
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)


class TicketTypeViewSet(ItsmModelViewSet):
    queryset = TicketType.objects.filter(is_deleted=False)
    serializer_class = TicketTypeSerializer
    module_code = "itsm.projects.config"
    filterset_fields = ["project", "base_category", "is_active"]
