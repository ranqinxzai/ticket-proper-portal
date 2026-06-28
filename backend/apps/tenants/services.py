"""Organisation provisioning — the single routine that creates a new org.

Used by both the super-admin console API and the ``create_tenant`` CLI command.
Creating an org = create the Client (which auto-creates its Postgres schema and
runs tenant migrations) + seed the standard ITSM data + create the org's first
admin (a superuser *within that schema* — i.e. the org owner, confined to its
own schema).
"""

from __future__ import annotations

import re

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection, transaction
from django_tenants.utils import get_public_schema_name, schema_context

from .models import Client

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{1,30}$")

# Slugs that would collide with reserved URL segments or the shared schema.
RESERVED_SLUGS = {
    "public", "t", "api", "admin", "console", "static", "media", "healthz",
    "schema", "docs", "auth", "www",
}


def validate_slug(slug: str) -> str:
    if not _SLUG_RE.match(slug or ""):
        raise ValidationError(
            "Slug must be lowercase, start with a letter, 2–31 chars, using a–z, 0–9, '-' or '_'."
        )
    if slug in RESERVED_SLUGS:
        raise ValidationError(f"'{slug}' is reserved and cannot be used as an organisation slug.")
    return slug


def org_exists(slug: str) -> bool:
    return Client.objects.filter(schema_name=slug).exists()


def provision_org(
    *,
    name: str,
    slug: str,
    admin_username: str,
    admin_password: str,
    admin_email: str = "",
    admin_full_name: str = "",
) -> Client:
    """Create an org schema, seed it, and create its first admin user.

    Runs from the public schema. On any failure after the schema is created the
    half-built schema is dropped so a retry starts clean. Returns the Client.
    """
    validate_slug(slug)
    if org_exists(slug):
        raise ValidationError(f"An organisation with slug '{slug}' already exists.")
    if not admin_username or not admin_password:
        raise ValidationError("An admin username and password are required.")

    # Saving with auto_create_schema=True creates the schema and migrates it.
    client = Client(schema_name=slug, name=name, is_active=True)
    client.save()

    try:
        with schema_context(slug):
            # Standard ITSM data (helpdesks, roles, workflows, SLAs, …). Idempotent.
            call_command("seed_itsm")
            # The org owner: a superuser inside THIS schema only.
            User = get_user_model()
            admin = User.objects.create_superuser(
                username=admin_username,
                email=admin_email or "",
                password=admin_password,
            )
            admin.full_name = admin_full_name or admin_username
            admin.role = "admin"
            admin.save(update_fields=["full_name", "role"])
    except Exception:
        # Roll back the half-created schema so the slug is free to retry.
        client.delete(force_drop=True)
        raise

    return client


def rename_org(old_slug: str, new_slug: str) -> Client:
    """Change an org's slug by RENAMING its Postgres schema.

    This changes the org's URL (`/t/<old>/` → `/t/<new>/`): existing links and
    logged-in sessions for the old slug stop working (their JWT `tenant` claim no
    longer matches), so users re-login at the new URL. Validated + atomic.
    """
    validate_slug(new_slug)
    if new_slug == old_slug:
        return Client.objects.get(schema_name=old_slug)
    if org_exists(new_slug):
        raise ValidationError(f"An organisation with slug '{new_slug}' already exists.")
    client = Client.objects.get(schema_name=old_slug)
    with transaction.atomic():
        with connection.cursor() as cur:
            # old/new slugs are validated to ^[a-z][a-z0-9_-]{1,30}$ — safe to inline.
            cur.execute(f'ALTER SCHEMA "{old_slug}" RENAME TO "{new_slug}"')
        client.schema_name = new_slug
        client.save(update_fields=["schema_name"])
    return client


def deprovision_org(slug: str, *, drop_schema: bool = True) -> None:
    """Delete an org. With drop_schema=True the schema and ALL its data are removed."""
    if slug == get_public_schema_name():
        raise ValidationError("Refusing to delete the public schema.")
    client = Client.objects.get(schema_name=slug)
    client.delete(force_drop=drop_schema)
