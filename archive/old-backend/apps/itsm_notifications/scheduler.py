"""APScheduler jobs: outbox flush + stuck-row reaper."""

from __future__ import annotations

import logging

logger = logging.getLogger("itsm")
_scheduler = None


def _flush():
    from .services import outbox
    try:
        outbox.flush()
    except Exception:  # noqa: BLE001
        logger.exception("outbox flush failed")


def _reap():
    from .services import outbox
    try:
        outbox.reap()
    except Exception:  # noqa: BLE001
        logger.exception("outbox reap failed")


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler
    from django.conf import settings
    from django_apscheduler.jobstores import DjangoJobStore

    seconds = getattr(settings, "NOTIFICATIONS_OUTBOX_FLUSH_SECONDS", 30)
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_jobstore(DjangoJobStore(), "default")
    sched.add_job(_flush, "interval", seconds=seconds, id="notifications.outbox_flush",
                  replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=30)
    sched.add_job(_reap, "interval", minutes=10, id="notifications.outbox_reaper",
                  replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=60)
    sched.start()
    _scheduler = sched
    logger.info("ITSM notification scheduler started (flush every %ss).", seconds)
