"""APScheduler job: mark assets Expired once their Expiry Date has passed.

Deliberately uses APScheduler's default in-memory job store, NOT ``DjangoJobStore``:
each ITSM scheduler that adds a DjangoJobStore reads the same shared job table, so
every one of them runs every due job (seen in prod as 3 concurrent SLA sweeps). The
job is re-added on every boot anyway, so nothing needs persisting. ``sweep_expired``
is idempotent and safe to run concurrently.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("itsm")
_scheduler = None


def _sweep():
    from apps.tenants.runtime import for_each_tenant

    from .services.asset_service import sweep_expired

    def run():
        changed = sweep_expired()
        if changed:
            logger.info("Asset expiry sweep: %s asset(s) marked Expired", changed)

    for_each_tenant(run)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler

    sched = BackgroundScheduler(timezone="UTC")
    # Hourly at :05. A cron trigger (unlike an interval) doesn't restart its clock on
    # every deploy.
    sched.add_job(_sweep, "cron", minute=5, id="assets.expiry_sweep", replace_existing=True,
                  max_instances=1, coalesce=True, misfire_grace_time=600)
    sched.start()
    _scheduler = sched
    logger.info("ITSM asset scheduler started (expiry sweep hourly at :05).")
