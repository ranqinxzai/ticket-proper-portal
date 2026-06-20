"""Tests for the business-time engine — the highest-correctness-risk code."""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from .business_time import (
    CalendarSpec,
    MisconfiguredCalendar,
    add_business_minutes,
    business_minutes_between,
)

UTC = ZoneInfo("UTC")


def _mon_fri_9_5(tz="UTC", holidays=None):
    return CalendarSpec(timezone=tz,
                        windows={d: [(time(9, 0), time(17, 0))] for d in range(5)},
                        holidays=holidays or set())


class BusinessTimeTests(SimpleTestCase):
    def test_within_single_window(self):
        spec = _mon_fri_9_5()
        start = datetime(2026, 6, 17, 9, 0, tzinfo=UTC)  # Wed 09:00
        self.assertEqual(add_business_minutes(spec, start, 120), datetime(2026, 6, 17, 11, 0, tzinfo=UTC))

    def test_rolls_over_weekend(self):
        spec = _mon_fri_9_5()
        fri = datetime(2026, 6, 19, 16, 30, tzinfo=UTC)  # Fri 16:30
        # 30 min Fri + 30 min Mon -> Mon 09:30
        self.assertEqual(add_business_minutes(spec, fri, 60), datetime(2026, 6, 22, 9, 30, tzinfo=UTC))

    def test_holiday_is_skipped(self):
        spec = _mon_fri_9_5(holidays={date(2026, 6, 22)})  # Mon holiday
        fri = datetime(2026, 6, 19, 16, 30, tzinfo=UTC)
        self.assertEqual(add_business_minutes(spec, fri, 60), datetime(2026, 6, 23, 9, 30, tzinfo=UTC))

    def test_start_in_gap_jumps_to_open(self):
        spec = _mon_fri_9_5()
        sat = datetime(2026, 6, 20, 12, 0, tzinfo=UTC)  # Saturday
        # budget consumed from Monday 09:00
        self.assertEqual(add_business_minutes(spec, sat, 60), datetime(2026, 6, 22, 10, 0, tzinfo=UTC))

    def test_budget_spanning_multiple_days(self):
        spec = _mon_fri_9_5()
        mon = datetime(2026, 6, 22, 9, 0, tzinfo=UTC)
        # 8h/day; 20h budget -> Mon(8) Tue(8) Wed(4) -> Wed 13:00
        self.assertEqual(add_business_minutes(spec, mon, 20 * 60), datetime(2026, 6, 24, 13, 0, tzinfo=UTC))

    def test_elapsed_excludes_nonworking(self):
        spec = _mon_fri_9_5()
        fri = datetime(2026, 6, 19, 16, 30, tzinfo=UTC)
        mon = datetime(2026, 6, 22, 9, 30, tzinfo=UTC)
        self.assertEqual(business_minutes_between(spec, fri, mon), 60.0)

    def test_dst_spring_forward(self):
        # US Eastern: 2026-03-08 02:00 -> 03:00 (lose an hour). 9-5 calendar.
        spec = CalendarSpec(timezone="America/New_York",
                            windows={d: [(time(9, 0), time(17, 0))] for d in range(5)})
        # A full working day is still 8 business hours regardless of DST.
        start = datetime(2026, 3, 6, 13, 0, tzinfo=ZoneInfo("America/New_York"))  # Fri 13:00 ET
        due = add_business_minutes(spec, start, 8 * 60)  # 4h Fri + 4h Mon -> Mon 13:00 ET
        self.assertEqual(due.astimezone(ZoneInfo("America/New_York")).hour, 13)

    def test_misconfigured_calendar_raises(self):
        spec = CalendarSpec(timezone="UTC", windows={})
        with self.assertRaises(MisconfiguredCalendar):
            add_business_minutes(spec, datetime(2026, 6, 17, 9, 0, tzinfo=UTC), 60)
