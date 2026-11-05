"""Unauthenticated password-reset endpoints (U14). Mounted under ``itsm/`` via
``accounts/itsm_urls.py`` so the tenant path ``/api/v1/t/<org>/itsm/auth/…`` works."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.itsm_core.services import audit  # admin & security audit log

from . import password_reset

GENERIC_REQUEST_REPLY = (
    "If an account matches what you entered, we've emailed it a link to reset the "
    "password. The link works for 60 minutes."
)
_NO_ORG = {"detail": "Unknown organisation."}


class _PublicView(APIView):
    permission_classes = [AllowAny]
    # No auth at all: a stale or other-org bearer token must not 401 the reset.
    authentication_classes: list = []


@extend_schema(exclude=True)
class PasswordResetRequestView(_PublicView):
    """POST {login} → always the same 200 (never reveals whether it matched)."""

    def post(self, request):
        if password_reset.current_org() is None:
            return Response(_NO_ORG, status=404)
        login = (request.data.get("login") or request.data.get("username")
                 or request.data.get("email") or "")
        sent = password_reset.request_reset(str(login))
        audit.log_admin_event(request, "password_reset_requested", actor=False,
                              actor_label=str(login)[:150], extra={"emails_sent": sent})
        return Response({"detail": GENERIC_REQUEST_REPLY})


@extend_schema(exclude=True)
class PasswordResetValidateView(_PublicView):
    """POST {uid, token} → {valid} so the page can say "expired" before you type."""

    def post(self, request):
        if password_reset.current_org() is None:
            return Response(_NO_ORG, status=404)
        user = password_reset.user_for(request.data.get("uid"), request.data.get("token"))
        return Response({"valid": user is not None})


@extend_schema(exclude=True)
class PasswordResetConfirmView(_PublicView):
    """POST {uid, token, new_password} → 200, or 400 with the reason."""

    def post(self, request):
        if password_reset.current_org() is None:
            return Response(_NO_ORG, status=404)
        target = password_reset.user_for(request.data.get("uid"), request.data.get("token"))
        error = password_reset.confirm(
            request.data.get("uid"), request.data.get("token"), request.data.get("new_password"),
        )
        audit.log_admin_event(request, "password_reset_failed" if error else "password_reset", obj=target,
                              actor=target or False, extra={"via": "email_link", "error": error or ""})
        if error:
            return Response(error, status=400)
        return Response({"detail": "Your password has been changed. You can sign in now."})
