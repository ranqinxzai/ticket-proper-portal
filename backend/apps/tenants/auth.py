"""Tenant-aware JWT authentication.

`PathTenantMiddleware` selects the Postgres schema from the URL path *before*
DRF authenticates. SimpleJWT then looks up ``user_id`` in that schema — but
integer PKs collide across schemas, so an org-A token replayed at ``/t/orgB/``
could otherwise resolve to a *different* real user in org B.

We close that hole by binding the org into the token at login (``tenant`` claim,
set in ``ItsmTokenObtainPairSerializer.get_token``) and rejecting any request
whose active schema differs from the claim.
"""

from __future__ import annotations

from django.db import connection
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken

# NOTE: this module is imported during DRF settings init (it's referenced by
# REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]). Keep its imports lightweight —
# importing `rest_framework_simplejwt.views`/`rest_framework.generics` here triggers
# a circular import (rest_framework.views ↔ schemas ↔ this module). The tenant-aware
# *refresh view* therefore lives in `apps.tenants.jwt`, which is only loaded via the
# URLconf (after app loading), not at settings time.


class TenantAwareJWTAuthentication(JWTAuthentication):
    def get_validated_token(self, raw_token):
        token = super().get_validated_token(raw_token)
        claim = token.payload.get("tenant")
        if claim != connection.schema_name:
            raise InvalidToken("This token was issued for a different organisation.")
        return token
