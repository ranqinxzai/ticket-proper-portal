from __future__ import annotations

import logging

from django.conf import settings
from django.shortcuts import redirect
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import EmailChannel, EmailRule, InboundEmail
from .serializers import (
    EmailChannelSerializer,
    EmailRuleSerializer,
    InboundEmailDetailSerializer,
    InboundEmailListSerializer,
)
from .services import mailbox, oauth, poller

logger = logging.getLogger("itsm")


class EmailChannelViewSet(ItsmModelViewSet):
    queryset = EmailChannel.objects.filter(is_deleted=False).select_related("project")
    serializer_class = EmailChannelSerializer
    module_code = "itsm.email.channels"
    filterset_fields = ["project", "is_active", "protocol", "auth_method"]
    search_fields = ["name", "address", "username"]

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        channel = self.get_object()
        return Response(mailbox.test_connection(channel))

    @action(detail=True, methods=["post"], url_path="poll-now")
    def poll_now(self, request, pk=None):
        channel = self.get_object()
        return Response(poller.poll_channel(channel))

    @action(detail=True, methods=["post"], url_path="oauth/start")
    def oauth_start(self, request, pk=None):
        channel = self.get_object()
        try:
            return Response({"authorize_url": oauth.authorize_url(channel)})
        except oauth.OAuthError as exc:
            return Response({"detail": str(exc)}, status=400)


class EmailRuleViewSet(ItsmModelViewSet):
    queryset = EmailRule.objects.filter(is_deleted=False)
    serializer_class = EmailRuleSerializer
    module_code = "itsm.email.channels"
    filterset_fields = ["channel", "rule_type", "is_active"]
    search_fields = ["pattern", "note"]


class InboundEmailViewSet(viewsets.ReadOnlyModelViewSet):
    """The email log: every received message, its outcome, and a retry action."""

    queryset = InboundEmail.objects.filter(is_deleted=False).select_related("ticket", "channel")
    permission_classes = [HasModulePermission]
    module_code = "itsm.email.logs"
    filterset_fields = ["channel", "status", "from_addr"]
    search_fields = ["subject", "from_addr", "message_id"]

    def get_serializer_class(self):
        return InboundEmailDetailSerializer if self.action == "retrieve" else InboundEmailListSerializer

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        """Re‑process a failed inbound message (POST → create → supervisor only)."""
        from .services import poller as _poller

        row = self.get_object()
        parsed = _poller._reconstruct(row)
        result = _poller.inbound.process_inbound(row.channel, parsed)
        return Response(InboundEmailDetailSerializer(result).data)


@extend_schema(exclude=True)
class OAuthCallbackView(APIView):
    """Provider redirect target. Unauthenticated (the provider calls it), but the
    ``state`` is a signed channel id with a short TTL."""

    permission_classes = [AllowAny]

    def get(self, request):
        frontend = getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000")
        code = request.query_params.get("code", "")
        state = request.query_params.get("state", "")
        error = request.query_params.get("error", "")
        if error:
            return redirect(f"{frontend}/admin/email?oauth=error&detail={error}")
        try:
            channel_id = oauth.parse_state(state)
            channel = EmailChannel.objects.get(pk=channel_id, is_deleted=False)
            oauth.exchange_code(channel, code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("oauth callback failed: %s", exc)
            return redirect(f"{frontend}/admin/email?oauth=error")
        return redirect(f"{frontend}/admin/email?oauth=success")
