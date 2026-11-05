"""Business-time arithmetic — the trickiest, most-tested part of the SLA engine.

Pure functions (no DB) operating on a `CalendarSpec`: timezone, per-weekday
working windows, and a holiday set. All inputs/outputs are timezone-aware UTC
datetimes. DST is handled by ZoneInfo. Algorithm: walk day-by-day in the
calendar's local timezone, materialize each working window, convert to UTC,
clip, and accumulate.
"""

from __future__ import annotations

import logging
from calendar import isleap
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger("itsm")


class MisconfiguredCalendar(Exception):
    pass


@dataclass
class CalendarSpec:
    timezone: str = "UTC"
    # weekday (0=Mon..6=Sun) -> list of (start_time, end_time) local windows
    windows: dict[int, list[tuple[time, time]]] = field(default_factory=dict)
    holidays: set[date] = field(default_factory=set)
    # Holiday.recurring_annually: (month, day) -> first year it applies. A recurring
    # holiday is skipped on the same month/day every year from the entered year on.
    annual_holidays: dict[tuple[int, int], int] = field(default_factory=dict)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def has_any_window(self) -> bool:
        return any(self.windows.get(d) for d in range(7))

    def is_holiday(self, d: date) -> bool:
        if d in self.holidays:
            return True
        if not self.annual_holidays:
            return False
        first = self.annual_holidays.get((d.month, d.day))
        if first is not None and d.year >= first:
            return True
        # An annual 29 Feb holiday is observed on 28 Feb in non-leap years.
        if d.month == 2 and d.day == 28 and not isleap(d.year):
            first = self.annual_holidays.get((2, 29))
            return first is not None and d.year >= first
        return False


# A whole local day (00:00 → end of day). `time.max` leaves a 1µs gap at midnight,
# which is immaterial for minute-resolution SLA math.
_WHOLE_DAY = [(time(0, 0), time.max)]


def always_open_spec(timezone: str = "UTC", holidays: set[date] | None = None,
                     annual_holidays: dict[tuple[int, int], int] | None = None) -> CalendarSpec:
    """A 24×7 spec — used when there's no calendar at all, or the calendar has no
    working hours (holidays are still skipped)."""
    return CalendarSpec(timezone=timezone or "UTC", windows={d: list(_WHOLE_DAY) for d in range(7)},
                        holidays=set(holidays or ()), annual_holidays=dict(annual_holidays or {}))


def _day_windows_utc(spec: CalendarSpec, local_day: date) -> list[tuple[datetime, datetime]]:
    """UTC intervals for one local calendar day (empty if weekend/holiday)."""
    if spec.is_holiday(local_day):
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

_WARNED_NO_HOURS: set = set()


def spec_from_calendar(calendar) -> CalendarSpec:
    """Build a CalendarSpec from a BusinessCalendar model instance.

    Honours ``Holiday.recurring_annually``. A calendar with NO working hours is
    treated as 24×7 (holidays still skipped) and logged once per calendar — the
    old behaviour (``MisconfiguredCalendar`` → due = now) breached every clock on it
    instantly and crashed the breach sweep for the whole tenant."""
    windows: dict[int, list[tuple[time, time]]] = {}
    for bh in calendar.hours.all():
        windows.setdefault(bh.weekday, []).append((bh.start_time, bh.end_time))
    holidays: set[date] = set()
    annual: dict[tuple[int, int], int] = {}
    for d, recurring in calendar.holidays.values_list("date", "recurring_annually"):
        holidays.add(d)
        if recurring:
            key = (d.month, d.day)
            annual[key] = min(annual.get(key, d.year), d.year)
    tz = calendar.timezone or "UTC"
    spec = CalendarSpec(timezone=tz, windows=windows, holidays=holidays, annual_holidays=annual)
    if not spec.has_any_window():
        if calendar.pk not in _WARNED_NO_HOURS:
            _WARNED_NO_HOURS.add(calendar.pk)
            logger.warning("Business calendar %s (%s) has no working hours; SLA clocks on it "
                           "run 24x7 until hours are added.", calendar.pk, calendar.name)
        return always_open_spec(tz, holidays, annual)
    return spec
