from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet

from .models import EmailTemplate, InAppNotification, NotificationRule, NotificationScheme
from .serializers import (
    EmailTemplateSerializer,
    InAppNotificationSerializer,
    NotificationRuleSerializer,
    NotificationSchemeSerializer,
)


class NotificationSchemeViewSet(ItsmModelViewSet):
    queryset = NotificationScheme.objects.filter(is_deleted=False).prefetch_related("rules")
    serializer_class = NotificationSchemeSerializer
    module_code = "itsm.notifications.schemes"
    filterset_fields = ["project", "is_default"]


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
