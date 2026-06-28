"""Path-based tenant resolution.

Replaces django-tenants' hostname-based ``TenantMainMiddleware``. We serve every
org from the same domain and put the org in the URL path:

    /api/v1/t/<slug>/itsm/tickets/   →  schema <slug>, path rewritten to
                                         /api/v1/itsm/tickets/  (URLconf unchanged)

Anything WITHOUT a ``/api/v1/t/<slug>/`` prefix (the provisioning console API,
Django admin, healthz, OpenAPI schema, static/media) runs in the ``public``
schema. This middleware must come first so the schema is set before any other
middleware or view touches the database.
"""

from __future__ import annotations

import re

from django.db import connection
from django.http import JsonResponse
from django_tenants.utils import get_public_schema_name, get_tenant_model

# /api/v1/t/<slug>[/...]   — slug matches the Client.schema_name charset.
_TENANT_PREFIX = re.compile(r"^/api/v1/t/(?P<slug>[a-z][a-z0-9_-]{1,62})(?P<rest>/.*)?$")


class PathTenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.public_schema = get_public_schema_name()

    def __call__(self, request):
        match = _TENANT_PREFIX.match(request.path_info)
        if match:
            slug = match.group("slug")
            TenantModel = get_tenant_model()
            # Connections are pooled and reused across requests, so the schema may
            # be left on some other org. Always resolve the registry from `public`
            # before switching (mirrors django-tenants' TenantMainMiddleware).
            connection.set_schema_to_public()
            try:
                tenant = TenantModel.objects.get(schema_name=slug, is_active=True)
            except TenantModel.DoesNotExist:
                return JsonResponse(
                    {"detail": "Unknown or inactive organisation."}, status=404
                )
            connection.set_tenant(tenant)
            request.tenant = tenant
            # Strip the /t/<slug> segment so the existing URLconf resolves as-is.
            rest = match.group("rest") or "/"
            new_path = "/api/v1" + rest
            request.path = new_path
            request.path_info = new_path
        else:
            # Public surface (console API, /admin, healthz, schema/docs, static).
            connection.set_schema_to_public()
            request.tenant = None

        return self.get_response(request)
