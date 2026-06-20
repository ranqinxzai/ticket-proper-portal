"""Poll all active email channels once (manual / cron / tests).

    python manage.py poll_email_once
    python manage.py poll_email_once --retry   # also reprocess failed rows
"""

from __future__ import annotations

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Poll active email channels once and process inbound mail. Idempotent."

    def add_arguments(self, parser):
        parser.add_argument("--retry", action="store_true", help="Also reprocess failed inbound rows.")

    def handle(self, *args, **options):
        from apps.itsm_email.services import poller

        results = poller.poll_active_channels()
        for r in results:
            self.stdout.write(self.style.SUCCESS(
                f"  {r['channel']}: processed={r['processed']} failed={r['failed']} "
                f"{('err=' + r['error']) if r['error'] else ''}"
            ))
        if not results:
            self.stdout.write(self.style.WARNING("  No active channels were due."))
        if options.get("retry"):
            summary = poller.retry_failed()
            self.stdout.write(self.style.SUCCESS(
                f"  retry: retried={summary['retried']} recovered={summary['recovered']}"
            ))
