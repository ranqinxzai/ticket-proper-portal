from __future__ import annotations

import logging

from django.conf import settings
from django.db import connection
from django.db.models import Prefetch
from django.shortcuts import redirect
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import (
    AuthMethod,
    EmailChannel,
    EmailChannelProject,
    EmailRoutingRule,
    EmailRule,
    HelpdeskEmailTransport,
    InboundEmail,
    TransportMode,
)
from .serializers import (
    EmailChannelSerializer,
    EmailRoutingRuleSerializer,
    EmailRuleSerializer,
    HelpdeskEmailTransportSerializer,
    InboundEmailDetailSerializer,
    InboundEmailListSerializer,
)
from .services import mailbox, oauth, poller, verify

logger = logging.getLogger("itsm")

# Prefetch the (live) routing rules + their target project, and the (live) allowed-project
# whitelist links, so serializing a channel list stays a bounded number of queries
# (nested `routing_rules` + `allowed_projects`).
_ROUTING_PREFETCH = Prefetch(
    "routing_rules",
    queryset=EmailRoutingRule.objects.filter(is_deleted=False).select_related("target_project"),
)
_ALLOWED_PREFETCH = Prefetch(
    "allowed_project_links",
    queryset=EmailChannelProject.objects.filter(is_deleted=False),
)


class EmailChannelViewSet(ItsmModelViewSet):
    queryset = (EmailChannel.objects.filter(is_deleted=False)
                .select_related("project")
                .prefetch_related(_ROUTING_PREFETCH, _ALLOWED_PREFETCH))
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
        # Probe + record the auto-detected send capability (outbound_send_verified).
        channel = self.get_object()
        return Response(verify.reverify("channel", channel))

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


class EmailRoutingRuleViewSet(ItsmModelViewSet):
    """Keyword → project routing rules for a shared mailbox (Supervisor config; the same
    module as the mailbox itself, so RBAC is inherited)."""

    queryset = (EmailRoutingRule.objects.filter(is_deleted=False)
                .select_related("target_project", "channel"))
    serializer_class = EmailRoutingRuleSerializer
    module_code = "itsm.email.channels"
    filterset_fields = ["channel", "target_project", "is_active"]
    search_fields = ["name"]


class HelpdeskEmailTransportViewSet(ItsmModelViewSet):
    """Per-helpdesk OUTBOUND notification transport (system default vs custom SMTP/M365).
    Gated by the same module as the helpdesk itself. Send capability is probed by the
    ``test-smtp`` action + a scheduled sweep; OAuth consent via ``oauth/start``."""

    queryset = HelpdeskEmailTransport.objects.filter(is_deleted=False).select_related("helpdesk")
    serializer_class = HelpdeskEmailTransportSerializer
    module_code = "itsm.admin.helpdesks"
    filterset_fields = ["helpdesk", "mode"]

    @action(detail=False, methods=["get"], url_path="for-helpdesk")
    def for_helpdesk(self, request):
        """Fetch (provisioning on first open) the transport row for ``?helpdesk=<id>``.
        A helpdesk with no row defaults to system mode — this makes that row concrete
        so the settings screen has a stable id to PATCH."""
        from apps.itsm_helpdesks.models import Helpdesk

        hid = request.query_params.get("helpdesk")
        if not hid:
            return Response({"detail": "A `helpdesk` query parameter is required."}, status=400)
        if not Helpdesk.objects.filter(pk=hid, is_deleted=False).exists():
            return Response({"detail": "Unknown helpdesk."}, status=404)
        obj, _ = HelpdeskEmailTransport.objects.get_or_create(
            helpdesk_id=hid, defaults={"mode": TransportMode.SYSTEM},
        )
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"], url_path="test-smtp")
    def test_smtp(self, request, pk=None):
        """Probe the custom transport's send capability (auth only — no mail sent) and
        persist the auto-detected result (send_verified). Bounded timeout so a dead host
        can't hang the request."""
        transport = self.get_object()
        return Response(verify.reverify("transport", transport))

    @action(detail=True, methods=["post"], url_path="oauth/start")
    def oauth_start(self, request, pk=None):
        transport = self.get_object()
        # Request least privilege for Microsoft 365: SMTP submission only, no IMAP read.
        if transport.auth_method == AuthMethod.OAUTH_MICROSOFT and not transport.oauth_scope_override:
            transport.oauth_scope_override = oauth.MICROSOFT_SEND_ONLY_SCOPE
            transport.save(update_fields=["oauth_scope_override", "updated_at"])
        try:
            return Response(
                {"authorize_url": oauth.authorize_url(transport, kind="helpdesk_transport")}
            )
        except oauth.OAuthError as exc:
            return Response({"detail": str(exc)}, status=400)


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
            obj_id, org, kind = oauth.parse_state(state)
        except Exception as exc:  # noqa: BLE001 — bad/expired/forged state
            logger.warning("oauth callback bad state: %s", exc)
            return redirect(f"{base}/?email_oauth=error")

        # The middleware sets the schema from the /t/<org>/ path; if the provider
        # was given a non-tenant URI, set it from the (signed) state instead.
        if org and connection.schema_name != org:
            self._set_schema(org)
        dest_org = org or connection.schema_name
        # Where the post-consent bounce lands: the mailbox screen for an inbound
        # channel, the Email Notification screen for a helpdesk send transport.
        dest_path = "email-notification" if kind == "helpdesk_transport" else "email"

        if error:
            return redirect(self._dest(base, dest_org, None, dest_path, "error", error))
        try:
            if kind == "helpdesk_transport":
                obj = (HelpdeskEmailTransport.objects.select_related("helpdesk")
                       .get(pk=obj_id, is_deleted=False))
                oauth.exchange_code(obj, code)
                hd_key = getattr(obj.helpdesk, "key", "")
            else:
                obj = (EmailChannel.objects.select_related("project__helpdesk")
                       .get(pk=obj_id, is_deleted=False))
                oauth.exchange_code(obj, code)
                hd_key = getattr(getattr(obj.project, "helpdesk", None), "key", "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("oauth callback failed (org=%s, kind=%s): %s", dest_org, kind, exc)
            return redirect(self._dest(base, dest_org, None, dest_path, "error", None))
        return redirect(self._dest(base, dest_org, hd_key, dest_path, "success", None))

    @staticmethod
    def _set_schema(org: str) -> None:
        from django_tenants.utils import get_tenant_model
        connection.set_schema_to_public()
        tenant = get_tenant_model().objects.get(schema_name=org, is_active=True)
        connection.set_tenant(tenant)

    @staticmethod
    def _dest(base: str, org: str, hd_key, dest_path: str, status: str, detail) -> str:
        if org and hd_key:
            url = f"{base}/t/{org}/agent/w/{hd_key}/settings/{dest_path}?email_oauth={status}"
        elif org:
            url = f"{base}/t/{org}/agent?email_oauth={status}"
        else:
            url = f"{base}/?email_oauth={status}"
        if detail:
            url += f"&detail={detail}"
        return url
