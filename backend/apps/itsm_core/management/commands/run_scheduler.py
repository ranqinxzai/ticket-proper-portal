"""Run the in-process APScheduler as a dedicated, long-lived process.

The web (gunicorn) containers run with RUN_SCHEDULER unset, so their worker
processes never start the scheduler (3 workers would otherwise mean 3 competing
schedulers). Instead a single dedicated container runs THIS command with
RUN_SCHEDULER=1, so exactly one BackgroundScheduler drives the SLA breach sweep,
the notification outbox flush, and the email inbound poll/retry.

    RUN_SCHEDULER=1 python manage.py run_scheduler
"""

from __future__ import annotations

import logging
import signal
import threading

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger("itsm")


class Command(BaseCommand):
    help = "Run the APScheduler (SLA sweep, notification outbox, email poll) as a dedicated process."

    def handle(self, *args, **options):
        if not getattr(settings, "RUN_SCHEDULER", False):
            raise CommandError(
                "RUN_SCHEDULER is not enabled. Set RUN_SCHEDULER=1 for this process only "
                "(the dedicated scheduler container — never the gunicorn web workers)."
            )

        # Each scheduler app's AppConfig.ready() has already started its
        # BackgroundScheduler (should_run_scheduler() is True for this command).
        # Calling the starters again is a no-op — each module guards a singleton —
        # but we do it explicitly so a missing ready() hook can't leave us idle.
        started = []
        for label, mod in (
            ("sla", "apps.itsm_sla.scheduler"),
            ("notifications", "apps.itsm_notifications.scheduler"),
            ("email", "apps.itsm_email.scheduler"),
        ):
            try:
                __import__(mod, fromlist=["start_scheduler"]).start_scheduler()
                started.append(label)
            except Exception:  # noqa: BLE001 — one bad scheduler must not stop the rest
                logger.exception("failed to start %s scheduler", label)

        self.stdout.write(self.style.SUCCESS(
            f"scheduler process up; running: {', '.join(started) or 'none'}. SIGTERM/Ctrl-C to stop."
        ))
        logger.info("dedicated scheduler process started: %s", started)

        # Block forever; the schedulers run in daemon threads that exit with us.
        stop = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_a: stop.set())
        stop.wait()
        self.stdout.write("scheduler process stopping.")
