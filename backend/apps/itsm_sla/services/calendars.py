"""Business-calendar helpers (config side; the runtime math is in business_time)."""

from __future__ import annotations

from datetime import time

# Mon–Fri 09:00–17:00, local to the calendar's own timezone. New calendars start
# with this week so SLA clocks on them never run without working hours.
DEFAULT_WEEK = [(weekday, time(9, 0), time(17, 0)) for weekday in range(0, 5)]


def ensure_default_hours(calendar):
    """Give ``calendar`` the default Mon–Fri 09:00–17:00 week if it has no live
    working hours. Idempotent; returns the number of windows created."""
    from ..models import BusinessHours

    if calendar.hours.exists():
        return 0
    BusinessHours.objects.bulk_create([
        BusinessHours(calendar=calendar, weekday=wd, start_time=start, end_time=end)
        for wd, start, end in DEFAULT_WEEK
    ])
    return len(DEFAULT_WEEK)
