"""Business-time arithmetic — the trickiest, most-tested part of the SLA engine.

Pure functions (no DB) operating on a `CalendarSpec`: timezone, per-weekday
working windows, and a holiday set. All inputs/outputs are timezone-aware UTC
datetimes. DST is handled by ZoneInfo. Algorithm: walk day-by-day in the
calendar's local timezone, materialize each working window, convert to UTC,
clip, and accumulate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


class MisconfiguredCalendar(Exception):
    pass


@dataclass
class CalendarSpec:
    timezone: str = "UTC"
    # weekday (0=Mon..6=Sun) -> list of (start_time, end_time) local windows
    windows: dict[int, list[tuple[time, time]]] = field(default_factory=dict)
    holidays: set[date] = field(default_factory=set)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def has_any_window(self) -> bool:
        return any(self.windows.get(d) for d in range(7))


def _day_windows_utc(spec: CalendarSpec, local_day: date) -> list[tuple[datetime, datetime]]:
    """UTC intervals for one local calendar day (empty if weekend/holiday)."""
    if local_day in spec.holidays:
        return []
    out = []
    for start_t, end_t in spec.windows.get(local_day.weekday(), []):
        if end_t <= start_t:
            continue
        local_start = datetime.combine(local_day, start_t, tzinfo=spec.tz)
        local_end = datetime.combine(local_day, end_t, tzinfo=spec.tz)
        out.append((local_start.astimezone(ZoneInfo("UTC")), local_end.astimezone(ZoneInfo("UTC"))))
    return out


def _iter_working_intervals(spec: CalendarSpec, start_utc: datetime, max_days: int = 750):
    """Yield UTC working intervals at/after start_utc, lazily, day by day."""
    if not spec.has_any_window():
        raise MisconfiguredCalendar("Calendar has no working hours.")
    local_cursor = start_utc.astimezone(spec.tz).date()
    for _ in range(max_days):
        for w_start, w_end in _day_windows_utc(spec, local_cursor):
            if w_end <= start_utc:
                continue
            yield (max(w_start, start_utc), w_end)
        local_cursor += timedelta(days=1)


def add_business_minutes(spec: CalendarSpec, start_utc: datetime, budget_minutes: float) -> datetime:
    """Start instant + a business-minute budget → the due instant (UTC)."""
    remaining = timedelta(minutes=budget_minutes)
    if remaining <= timedelta(0):
        # due immediately at next working moment
        for w_start, _ in _iter_working_intervals(spec, start_utc):
            return w_start
        raise MisconfiguredCalendar("No working window found.")
    for w_start, w_end in _iter_working_intervals(spec, start_utc):
        avail = w_end - w_start
        if remaining <= avail:
            return w_start + remaining
        remaining -= avail
    raise MisconfiguredCalendar("Budget exceeds 2-year working horizon.")


def business_minutes_between(spec: CalendarSpec, a_utc: datetime, b_utc: datetime) -> float:
    """Elapsed business minutes between two instants (0 if a >= b)."""
    if a_utc >= b_utc:
        return 0.0
    total = timedelta(0)
    for w_start, w_end in _iter_working_intervals(spec, a_utc):
        if w_start >= b_utc:
            break
        total += min(w_end, b_utc) - max(w_start, a_utc)
    return total.total_seconds() / 60.0


# ── DB → spec adapter ───────────────────────────────────────────────────────

def spec_from_calendar(calendar) -> CalendarSpec:
    """Build a CalendarSpec from a BusinessCalendar model instance."""
    windows: dict[int, list[tuple[time, time]]] = {}
    for bh in calendar.hours.all():
        windows.setdefault(bh.weekday, []).append((bh.start_time, bh.end_time))
    holidays = set(calendar.holidays.values_list("date", flat=True))
    return CalendarSpec(timezone=calendar.timezone or "UTC", windows=windows, holidays=holidays)
