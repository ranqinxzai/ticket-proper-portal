"""One-time: convert the pre-multitenancy single-tenant DB into the first org.

Strategy = **schema rename** (safest; no row copying, sequences/constraints/data
preserved intact):

    1. rename the existing `public` schema  ->  <slug>   (all old data, as-is)
    2. create a fresh empty `public`
    3. migrate_schemas --shared              (build shared infra in new public)
    4. register the org in tenants_client    (auto_create_schema=False — it exists)
    5. migrate_schemas --schema=<slug>        (apply any pending tenant migrations)

Run this ONCE, against a DB that is still in its old single-tenant shape (i.e.
`migrate_schemas` has NOT yet run on it). Rehearse on a clone first. A full
pg_dump must exist before running against live data.

    python manage.py migrate_legacy_to_tenant --slug demo --name "Demo Organisation" --yes
"""

from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.tenants.models import Client
from apps.tenants.services import validate_slug


def _exists_schema(cur, schema: str) -> bool:
    cur.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", [schema])
    return cur.fetchone() is not None


def _exists_table(cur, schema: str, table: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
        [schema, table],
    )
    return cur.fetchone() is not None


class Command(BaseCommand):
    help = "Move the legacy single-tenant data (in `public`) into a new org schema."

    def add_arguments(self, parser):
        parser.add_argument("--slug", default="demo", help="Schema/slug for the first org.")
        parser.add_argument("--name", default="Demo Organisation")
        parser.add_argument(
            "--probe-table",
            default="itsm_tickets_ticket",
            help="A tenant table whose presence in `public` proves legacy data exists.",
        )
        parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")

    def handle(self, *args, **opts):
        slug = opts["slug"]
        validate_slug(slug)

        with connection.cursor() as cur:
            # ── Preconditions: this must be a legacy single-tenant DB ──────────
            if not _exists_table(cur, "public", opts["probe_table"]):
                raise CommandError(
                    f"public.{opts['probe_table']} not found — this does not look like a "
                    "legacy single-tenant DB. Aborting (nothing changed)."
                )
            if _exists_table(cur, "public", "tenants_client"):
                raise CommandError(
                    "public.tenants_client already exists — shared infra was already built on "
                    "this DB. The schema-rename path is unsafe here; restore from backup and run "
                    "this BEFORE any migrate_schemas. Aborting."
                )
            if _exists_schema(cur, slug):
                raise CommandError(f"Schema '{slug}' already exists. Aborting.")

            if not opts["yes"]:
                confirm = input(
                    f"Rename schema 'public' -> '{slug}' and rebuild a fresh public schema? "
                    f"Type '{slug}' to confirm: "
                )
                if confirm.strip() != slug:
                    raise CommandError("Confirmation did not match; aborted (nothing changed).")

            # ── 1+2: rename public -> slug, then create a fresh public ─────────
            self.stdout.write(f"  • renaming schema public -> {slug}")
            cur.execute(f'ALTER SCHEMA public RENAME TO "{slug}"')
            cur.execute("CREATE SCHEMA public")
            cur.execute("SET search_path TO public")

        # ── 3: build shared infra in the new public schema ────────────────────
        self.stdout.write("  • migrate_schemas --shared (building public)")
        call_command("migrate_schemas", "--shared", interactive=False, verbosity=1)

        # ── 4: register the org (schema already exists → don't auto-create) ────
        self.stdout.write(f"  • registering org '{slug}' in tenants_client")
        client = Client(schema_name=slug, name=opts["name"], is_active=True)
        client.auto_create_schema = False  # the schema is the renamed legacy one
        client.save()

        # ── 5: top-up any pending TENANT-app migrations on the org schema ──────
        # Use --tenant (TENANT_APPS only), NOT -s/--schema (which applies the
        # full app set and would create a stray shared `tenants_client` here).
        self.stdout.write("  • migrate_schemas --tenant (top-up)")
        call_command("migrate_schemas", tenant=True, interactive=False, verbosity=1)

        self.stdout.write(
            self.style.SUCCESS(
                f"Legacy data is now org '{client.name}' (schema={slug}). "
                f"Login at /t/{slug}/login with the existing credentials. "
                "Create a platform admin with create_platform_admin to use the console."
            )
        )
