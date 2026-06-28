"""The organisation (tenant) registry — lives in the SHARED `public` schema.

Each `Client` row is one organisation and owns a dedicated Postgres schema whose
name doubles as the URL slug (``/t/<schema_name>/…``). All business data for an
org lives inside that schema, giving hard two-way isolation between orgs.

We route by URL path (see ``apps.tenants.middleware.PathTenantMiddleware``), not
by hostname, so the `Domain` model is kept only to satisfy django-tenants'
``TENANT_DOMAIN_MODEL`` contract — we don't create rows for it.
"""

from __future__ import annotations

from django.db import models
from django_tenants.models import DomainMixin, TenantMixin


class Client(TenantMixin):
    """One organisation. ``schema_name`` (from TenantMixin) is the URL slug."""

    name = models.CharField(max_length=120)
    # Soft on/off switch: an inactive org's /t/<slug>/ requests 404 without
    # destroying its schema/data (see PathTenantMiddleware + delete_tenant).
    is_active = models.BooleanField(default=True)
    created_on = models.DateField(auto_now_add=True)

    # django-tenants: create the Postgres schema (and run tenant migrations)
    # automatically when a Client is saved for the first time.
    auto_create_schema = True
    # Never drop a schema on a plain delete() — deletion must be explicit and
    # confirmed (delete_tenant uses delete(force_drop=True)).
    auto_drop_schema = False

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.schema_name})"


class Domain(DomainMixin):
    """Required by django-tenants; unused under path-based routing."""

    pass
