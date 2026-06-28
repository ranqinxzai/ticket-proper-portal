from __future__ import annotations

import logging

from django.conf import settings
from django.db import connection
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

    @action(detail=True, methods=["post"], url_path="test-smtp")
    def test_smtp(self, request, pk=None):
        channel = self.get_object()
        return Response(mailbox.test_smtp(channel))

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
    ``state`` is a signed ``{cid, org}`` with a short TTL.

    Registered (per org) as ``/api/v1/t/<org>/itsm/email/oauth/callback/`` so
    ``PathTenantMiddleware`` sets the org schema from the path before this runs —
    that's how we can find the tenant's ``EmailChannel``. We still carry the org
    in ``state`` and set the schema defensively (and verify it matches the path)."""

    permission_classes = [AllowAny]

    def get(self, request):
        base = (getattr(settings, "PUBLIC_BASE_URL", "")
                or getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000")).rstrip("/")
        code = request.query_params.get("code", "")
        state = request.query_params.get("state", "")
        error = request.query_params.get("error", "")
        try:
            channel_id, org = oauth.parse_state(state)
        except Exception as exc:  # noqa: BLE001 — bad/expired/forged state
            logger.warning("oauth callback bad state: %s", exc)
            return redirect(f"{base}/?email_oauth=error")

        # The middleware sets the schema from the /t/<org>/ path; if the provider
        # was given a non-tenant URI, set it from the (signed) state instead.
        if org and connection.schema_name != org:
            self._set_schema(org)
        dest_org = org or connection.schema_name

        if error:
            return redirect(self._dest(base, dest_org, None, "error", error))
        try:
            channel = (EmailChannel.objects.select_related("project__helpdesk")
                       .get(pk=channel_id, is_deleted=False))
            oauth.exchange_code(channel, code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("oauth callback failed (org=%s): %s", dest_org, exc)
            return redirect(self._dest(base, dest_org, None, "error", None))
        hd_key = getattr(getattr(channel.project, "helpdesk", None), "key", "")
        return redirect(self._dest(base, dest_org, hd_key, "success", None))

    @staticmethod
    def _set_schema(org: str) -> None:
        from django_tenants.utils import get_tenant_model
        connection.set_schema_to_public()
        tenant = get_tenant_model().objects.get(schema_name=org, is_active=True)
        connection.set_tenant(tenant)

    @staticmethod
    def _dest(base: str, org: str, hd_key, status: str, detail) -> str:
        if org and hd_key:
            url = f"{base}/t/{org}/agent/w/{hd_key}/settings/email?email_oauth={status}"
        elif org:
            url = f"{base}/t/{org}/agent?email_oauth={status}"
        else:
            url = f"{base}/?email_oauth={status}"
        if detail:
            url += f"&detail={detail}"
        return url
