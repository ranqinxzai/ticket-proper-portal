"""Helpers for running code across every org schema.

The background scheduler (SLA sweep, notification flush, email poll) runs in the
``public`` schema and has no inherent org context. These helpers let a job run its
existing, unchanged logic once inside each active org's schema.
"""

from __future__ import annotations

import logging

from django_tenants.utils import get_public_schema_name, get_tenant_model, schema_context

logger = logging.getLogger(__name__)


def iter_active_tenants():
    """Active org Clients, excluding the shared public schema."""
    public = get_public_schema_name()
    return (
        get_tenant_model()
        .objects.exclude(schema_name=public)
        .filter(is_active=True)
        .order_by("schema_name")
    )


def for_each_tenant(fn, *args, **kwargs):
    """Run ``fn(*args, **kwargs)`` once inside each active org's schema.

    One org raising never aborts the sweep for the others — the error is logged
    and the loop continues (a job per org is independent).
    """
    for tenant in iter_active_tenants():
        try:
            with schema_context(tenant.schema_name):
                fn(*args, **kwargs)
        except Exception:  # pragma: no cover - defensive, logged per-tenant
            logger.exception("tenant job failed for schema '%s'", tenant.schema_name)
