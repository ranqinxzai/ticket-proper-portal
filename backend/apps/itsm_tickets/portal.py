"""End-user Service Portal API for tickets.

Requestors have no helpdesk membership, so the agent queue is empty for them.
The portal scope is a separate clamp: a requestor sees only their OWN tickets and
only PUBLIC comments — never internal notes, assignee internals, or audit.
"""

from __future__ import annotations

from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.itsm_rbac.permissions import HasModulePermission

from .models import Comment, Ticket
from .services import ticket_service


class PortalTicketSerializer(serializers.ModelSerializer):
    status_name = serializers.CharField(source="status.name", read_only=True)
    status_category = serializers.CharField(source="status.category.key", read_only=True)
    status_color = serializers.CharField(source="status.color", read_only=True)
    helpdesk_name = serializers.CharField(source="project.helpdesk.name", read_only=True)

    class Meta:
        model = Ticket
        fields = ["id", "ticket_number", "summary", "description_html", "status_name",
                  "status_category", "status_color", "priority", "helpdesk_name",
                  "created_at", "updated_at", "resolved_at"]


class PortalCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True, default=None)

    class Meta:
        model = Comment
        fields = ["id", "author_name", "body_html", "created_at"]


class PortalTicketViewSet(viewsets.ReadOnlyModelViewSet):
    """A requestor's own tickets. Read + add a public reply."""

    serializer_class = PortalTicketSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.portal.tickets"
    search_fields = ["ticket_number", "summary"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return (
            Ticket.objects.filter(requestor=self.request.user, is_deleted=False)
            .select_related("project", "project__helpdesk", "status", "status__category")
            .order_by("-created_at")
        )

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        ticket = self.get_object()  # 404s for tickets not owned by the requestor
        if request.method == "POST":
            comment = ticket_service.add_comment(
                ticket=ticket, author=request.user,
                body_html=request.data.get("body_html", ""), visibility="public",
            )
            return Response(PortalCommentSerializer(comment).data, status=http_status.HTTP_201_CREATED)
        qs = ticket.comments.filter(is_deleted=False, visibility="public").select_related("author")
        return Response(PortalCommentSerializer(qs, many=True).data)
