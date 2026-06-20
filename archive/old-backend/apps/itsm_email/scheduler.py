"""APScheduler jobs: inbound poll + failed‑row retry. Mirrors the notifications
scheduler. Booted from ``apps.py`` ``ready()`` behind ``should_run_scheduler``."""

from __future__ import annotations

import logging

logger = logging.getLogger("itsm")
_scheduler = None


def _poll():
    from .services import poller
    try:
        poller.poll_active_channels()
    except Exception:  # noqa: BLE001
        logger.exception("email inbound poll failed")


def _retry():
    from .services import poller
    try:
        poller.retry_failed()
    except Exception:  # noqa: BLE001
        logger.exception("email retry failed-inbound failed")


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler
    from django.conf import settings
    from django_apscheduler.jobstores import DjangoJobStore

    poll_seconds = getattr(settings, "EMAIL_POLL_INTERVAL_SECONDS", 60)
    retry_minutes = getattr(settings, "EMAIL_RETRY_INBOUND_MINUTES", 10)
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_jobstore(DjangoJobStore(), "default")
    sched.add_job(_poll, "interval", seconds=poll_seconds, id="email.poll_inbound",
                  replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=30)
    sched.add_job(_retry, "interval", minutes=retry_minutes, id="email.retry_failed_inbound",
                  replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=60)
    sched.start()
    _scheduler = sched
    logger.info("ITSM email scheduler started (poll every %ss).", poll_seconds)
