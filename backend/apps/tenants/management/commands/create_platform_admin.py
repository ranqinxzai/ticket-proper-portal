"""Bootstrap a platform super-admin in the PUBLIC schema.

Platform admins run the provisioning console (create/manage orgs). They live in
the shared ``public`` schema's user table — they are NOT members of any org and
cannot see any org's data.

    python manage.py create_platform_admin --username root \
        --password 'secret' --email ops@example.com
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django_tenants.utils import get_public_schema_name, schema_context


class Command(BaseCommand):
    help = "Create a platform super-admin (public schema) for the provisioning console."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--password", required=True)
        parser.add_argument("--email", default="")

    def handle(self, *args, **opts):
        with schema_context(get_public_schema_name()):
            User = get_user_model()
            if User.objects.filter(username=opts["username"]).exists():
                raise CommandError(f"A platform admin '{opts['username']}' already exists.")
            admin = User.objects.create_superuser(
                username=opts["username"],
                email=opts["email"] or "",
                password=opts["password"],
            )
            admin.full_name = opts["username"]
            admin.save(update_fields=["full_name"])
        self.stdout.write(
            self.style.SUCCESS(f"Created platform admin '{opts['username']}' in the public schema.")
        )
