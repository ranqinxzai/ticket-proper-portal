"""APScheduler job: periodic SLA breach + escalation sweep."""

from __future__ import annotations

import logging

logger = logging.getLogger("itsm")
_scheduler = None


def _sweep():
    # Multi-tenant: the scheduler runs in the public schema; sweep each org's
    # schema in turn. for_each_tenant isolates + logs per-org failures.
    from apps.tenants.runtime import for_each_tenant
    from .services import sla_engine

    def run():
        result = sla_engine.scan_breaches()
        logger.info("SLA sweep: %s", result)

    for_each_tenant(run)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler
    from django.conf import settings
    from django_apscheduler.jobstores import DjangoJobStore

    minutes = getattr(settings, "SLA_BREACH_SWEEP_INTERVAL_MINUTES", 1)
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_jobstore(DjangoJobStore(), "default")
    sched.add_job(_sweep, "interval", minutes=minutes, id="sla.breach_sweep",
                  replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=60)
    sched.start()
    _scheduler = sched
    logger.info("ITSM SLA scheduler started (every %s min).", minutes)
