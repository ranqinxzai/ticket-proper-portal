from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import (
    EVENT_CHOICES,
    EmailTemplate,
    InAppNotification,
    NotificationChannel,
    NotificationRule,
    NotificationScheme,
)
from .serializers import (
    EmailTemplateSerializer,
    InAppNotificationSerializer,
    NotificationRuleSerializer,
    NotificationSchemeSerializer,
)
from .services.recipients import NAMED_SELECTORS

# Channels not yet deliverable (groundwork only) — surfaced to the UI as disabled.
_COMING_SOON_CHANNELS = {NotificationChannel.WHATSAPP.value}


class NotificationSchemeViewSet(ItsmModelViewSet):
    queryset = NotificationScheme.objects.filter(is_deleted=False).prefetch_related("rules")
    serializer_class = NotificationSchemeSerializer
    module_code = "itsm.notifications.schemes"
    filterset_fields = ["project", "is_default"]

    @action(detail=False, methods=["get"])
    def metadata(self, request):
        """Static catalog (events / recipient selectors / channels) so the settings
        matrix renders without hardcoding. WhatsApp is reported not-yet-available."""
        return Response({
            "events": [{"value": v, "label": label} for v, label in EVENT_CHOICES],
            "recipients": [{"value": v, "label": label} for v, label in NAMED_SELECTORS],
            "channels": [
                {"value": c.value, "label": c.label,
                 "available": c.value not in _COMING_SOON_CHANNELS,
                 "coming_soon": c.value in _COMING_SOON_CHANNELS}
                for c in NotificationChannel
            ],
        })

    @action(detail=False, methods=["get"], url_path="for-project")
    def for_project(self, request):
        """Return a project's notification scheme, provisioning the per-project clone
        on first access (defense-in-depth for projects created before this feature)."""
        from apps.itsm_projects.models import Project

        from .seed import ensure_notification_scheme

        project_id = request.query_params.get("project")
        if not project_id:
            return Response({"detail": "A 'project' query parameter is required."}, status=400)
        project = Project.objects.filter(pk=project_id, is_deleted=False).first()
        if project is None:
            return Response({"detail": "Project not found."}, status=404)
        scheme = ensure_notification_scheme(project)
        return Response(self.get_serializer(scheme).data)


class NotificationRuleViewSet(ItsmModelViewSet):
    queryset = NotificationRule.objects.filter(is_deleted=False)
    serializer_class = NotificationRuleSerializer
    module_code = "itsm.notifications.schemes"
    filterset_fields = ["scheme", "event_type", "is_active"]


class EmailTemplateViewSet(ItsmModelViewSet):
    queryset = EmailTemplate.objects.filter(is_deleted=False)
    serializer_class = EmailTemplateSerializer
    module_code = "itsm.notifications.templates"
    search_fields = ["name", "subject_template"]


class InAppNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """The current user's notification inbox."""

    serializer_class = InAppNotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = InAppNotification.objects.filter(recipient=self.request.user, is_deleted=False)
        if self.request.query_params.get("unread") in ("1", "true"):
            qs = qs.filter(is_read=False)
        return qs

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        n = InAppNotification.objects.filter(recipient=request.user, is_read=False, is_deleted=False).count()
        return Response({"unread": n})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        InAppNotification.objects.filter(pk=pk, recipient=request.user).update(
            is_read=True, read_at=timezone.now()
        )
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        InAppNotification.objects.filter(recipient=request.user, is_read=False).update(
            is_read=True, read_at=timezone.now()
        )
        return Response({"ok": True})
