"""Delete an organisation and (by default) drop its schema + all data.

Named ``delete_org`` (NOT ``delete_tenant``) to avoid colliding with the
``delete_tenant`` command django-tenants itself ships.

    python manage.py delete_org acme --yes

Destructive — requires --yes (or an interactive confirmation).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.tenants.models import Client
from apps.tenants.services import deprovision_org


class Command(BaseCommand):
    help = "Delete an organisation; drops its Postgres schema and ALL its data."

    def add_arguments(self, parser):
        parser.add_argument("slug")
        parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")
        parser.add_argument(
            "--keep-schema",
            action="store_true",
            help="Delete the Client row but leave the schema/data in place.",
        )

    def handle(self, *args, **opts):
        slug = opts["slug"]
        try:
            client = Client.objects.get(schema_name=slug)
        except Client.DoesNotExist as exc:
            raise CommandError(f"No organisation with slug '{slug}'.") from exc

        if not opts["yes"]:
            drop = "and DROP its schema + all data " if not opts["keep_schema"] else ""
            confirm = input(f"Delete organisation '{client.name}' {drop}? Type the slug to confirm: ")
            if confirm.strip() != slug:
                raise CommandError("Confirmation did not match; aborted.")

        deprovision_org(slug, drop_schema=not opts["keep_schema"])
        self.stdout.write(self.style.SUCCESS(f"Deleted organisation '{slug}'."))
