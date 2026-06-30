"""Tenant-aware JWT *refresh* (kept out of ``apps.tenants.auth``).

``apps.tenants.auth`` is imported while DRF resolves its settings, so it can't
pull in ``rest_framework_simplejwt.views`` without a circular import. This module
is only imported by the URLconf (after app loading), so the heavier imports are
safe here.

``TenantAwareJWTAuthentication`` (in ``auth.py``) already guards the *access*
token on every request. The refresh endpoint is anonymous (the refresh token
travels in the body, not the Authorization header) and the stock serializer only
checks the signature — so an org-A refresh token presented at
``/t/orgB/itsm/auth/refresh/`` would mint a fresh access token still carrying
``tenant=orgA``. Pointless for the holder, but we reject it up front so the org
binding holds for the whole token lifecycle, not just the access leg.
"""

from __future__ import annotations

from django.db import connection
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView


class TenantAwareTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        claim = RefreshToken(attrs["refresh"]).payload.get("tenant")
        if claim != connection.schema_name:
            raise InvalidToken("This token was issued for a different organisation.")
        return super().validate(attrs)


class TenantAwareTokenRefreshView(TokenRefreshView):
    serializer_class = TenantAwareTokenRefreshSerializer
