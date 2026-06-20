"""Drop and recreate the 'public' schema — wipes all tables without needing psql."""
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Drop the public schema and recreate it (destroys all data)."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Skip confirmation.")

    def handle(self, *args, **options):
        if not options["yes"]:
            answer = input("This will DESTROY ALL DATA in the database. Type 'yes' to confirm: ")
            if answer.strip().lower() != "yes":
                self.stdout.write("Aborted.")
                return
        with connection.cursor() as c:
            c.execute("DROP SCHEMA IF EXISTS public CASCADE;")
            c.execute("CREATE SCHEMA public;")
            c.execute("GRANT ALL ON SCHEMA public TO public;")
        self.stdout.write(self.style.SUCCESS("Schema reset complete."))
