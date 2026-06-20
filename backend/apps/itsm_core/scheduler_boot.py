"""Shared guard for booting APScheduler jobs from an AppConfig.ready().

Only starts when settings.RUN_SCHEDULER is on, we're not running a management
command that shouldn't trigger jobs (migrate/test/…), and — under runserver —
only in the reloader's main process.
"""

from __future__ import annotations

import os
import sys

from django.conf import settings


def should_run_scheduler() -> bool:
    if not getattr(settings, "RUN_SCHEDULER", False):
        return False
    argv = sys.argv
    blocked = getattr(settings, "SCHEDULER_BLOCKED_COMMANDS", frozenset())
    if len(argv) > 1 and argv[1] in blocked:
        return False
    # Under `runserver`, the autoreloader spawns two processes; only run in the
    # child that owns RUN_MAIN (avoids double-scheduling).
    if len(argv) > 1 and argv[1] == "runserver" and os.environ.get("RUN_MAIN") != "true":
        return False
    return True
