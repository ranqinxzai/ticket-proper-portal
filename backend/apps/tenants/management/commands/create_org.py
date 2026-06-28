"""Create a new organisation from the command line (operator fallback).

Named ``create_org`` (NOT ``create_tenant``) to avoid colliding with the
``create_tenant`` command django-tenants itself ships.

    python manage.py create_org acme \
        --name "Acme Corp" --admin-username admin --admin-password 'secret' \
        --admin-email admin@acme.example

The same logic backs the super-admin web console (apps.tenants.services.provision_org).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.tenants.services import provision_org


class Command(BaseCommand):
    help = "Create a new organisation (Postgres schema + seed + first admin)."

    def add_arguments(self, parser):
        parser.add_argument("slug", help="URL slug / schema name, e.g. 'acme'")
        parser.add_argument("--name", required=True, help="Display name, e.g. 'Acme Corp'")
        parser.add_argument("--admin-username", required=True)
        parser.add_argument("--admin-password", required=True)
        parser.add_argument("--admin-email", default="")
        parser.add_argument("--admin-full-name", default="")

    def handle(self, *args, **opts):
        try:
            client = provision_org(
                name=opts["name"],
                slug=opts["slug"],
                admin_username=opts["admin_username"],
                admin_password=opts["admin_password"],
                admin_email=opts["admin_email"],
                admin_full_name=opts["admin_full_name"],
            )
        except Exception as exc:  # surface as a clean command error
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"Created organisation '{client.name}' (schema={client.schema_name}). "
                f"Login at /t/{client.schema_name}/login"
            )
        )
