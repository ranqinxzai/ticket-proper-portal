"""Poll active email channels once (manual / cron / tests).

Multi-tenant: channels live per-org schema, so by default this fans out over
EVERY active org (same as the APScheduler ``email.poll_inbound`` job). Pass
``--schema=<org>`` to poll a single org.

    python manage.py poll_email_once                 # every active org
    python manage.py poll_email_once --schema=acme   # one org
    python manage.py poll_email_once --retry         # also reprocess failed rows
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django_tenants.utils import schema_context


class Command(BaseCommand):
    help = "Poll active email channels once and process inbound mail (per-org). Idempotent."

    def add_arguments(self, parser):
        parser.add_argument("--retry", action="store_true", help="Also reprocess failed inbound rows.")
        parser.add_argument("--schema", default=None,
                            help="Poll only this org's schema (default: every active org).")

    def handle(self, *args, **options):
        from apps.itsm_email.services import poller
        from apps.tenants.runtime import iter_active_tenants

        retry = options.get("retry")
        target = options.get("schema")

        def run_one():
            # Runs inside an org schema (set by the caller below).
            results = poller.poll_active_channels()
            for r in results:
                self.stdout.write(self.style.SUCCESS(
                    f"  {r['channel']}: processed={r['processed']} failed={r['failed']} "
                    f"{('err=' + r['error']) if r['error'] else ''}"
                ))
            if not results:
                self.stdout.write(self.style.WARNING("  No active channels were due."))
            if retry:
                summary = poller.retry_failed()
                self.stdout.write(self.style.SUCCESS(
                    f"  retry: retried={summary['retried']} recovered={summary['recovered']}"
                ))

        if target:
            self.stdout.write(f"[{target}]")
            with schema_context(target):
                run_one()
            return

        any_org = False
        for tenant in iter_active_tenants():
            any_org = True
            self.stdout.write(f"[{tenant.schema_name}]")
            with schema_context(tenant.schema_name):
                run_one()
        if not any_org:
            self.stdout.write(self.style.WARNING("No active orgs found."))
