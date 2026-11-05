"""B7 (recurring holidays), B9 (calendars with no working hours / default week),
C1 (hours-less calendar crashed the sweep) and C2 (re-adding a deleted holiday or
SLA target 500'd) — 2026-10-18."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from .business_time import CalendarSpec, add_business_minutes, always_open_spec
from .tests_priority_recalc import SlaTicketMixin

UTC = ZoneInfo("UTC")


def _mon_fri(annual=None, holidays=None):
    return CalendarSpec(timezone="UTC", windows={d: [(time(9, 0), time(17, 0))] for d in range(5)},
                        holidays=holidays or set(), annual_holidays=annual or {})


class RecurringHolidaySpecTests(SimpleTestCase):
    def test_annual_holiday_skipped_next_year(self):
        spec = _mon_fri(annual={(10, 20): 2026})
        tue = datetime(2027, 10, 19, 16, 30, tzinfo=UTC)  # Tue; Wed 20 Oct is the holiday
        self.assertEqual(add_business_minutes(spec, tue, 60), datetime(2027, 10, 21, 9, 30, tzinfo=UTC))

    def test_annual_holiday_not_applied_before_its_year(self):
        spec = _mon_fri(annual={(10, 20): 2026})
        self.assertFalse(spec.is_holiday(date(2025, 10, 20)))
        self.assertTrue(spec.is_holiday(date(2026, 10, 20)))
        self.assertTrue(spec.is_holiday(date(2031, 10, 20)))

    def test_feb_29_falls_on_feb_28_in_non_leap_years(self):
        spec = _mon_fri(annual={(2, 29): 2028})
        self.assertTrue(spec.is_holiday(date(2029, 2, 28)))    # non-leap → 28 Feb
        self.assertTrue(spec.is_holiday(date(2032, 2, 29)))    # leap → 29 Feb itself
        self.assertFalse(spec.is_holiday(date(2032, 2, 28)))   # leap year: 28 Feb is a workday
        self.assertFalse(spec.is_holiday(date(2027, 2, 28)))   # before the holiday's year

    def test_one_off_holiday_only_that_date(self):
        spec = _mon_fri(holidays={date(2026, 10, 20)})
        self.assertTrue(spec.is_holiday(date(2026, 10, 20)))
        self.assertFalse(spec.is_holiday(date(2027, 10, 20)))

    def test_always_open_spec_is_24x7(self):
        spec = always_open_spec()
        sat = datetime(2026, 10, 17, 22, 0, tzinfo=UTC)
        due = add_business_minutes(spec, sat, 240)
        self.assertLess(abs((due - (sat + timedelta(minutes=240))).total_seconds()), 1)


class CalendarDbTests(TestCase):
    def _cal(self, hours=True, **kw):
        from .models import BusinessCalendar, BusinessHours
        cal = BusinessCalendar.objects.create(name=kw.get("name", "Cal"), timezone="UTC")
        if hours:
            for d in range(5):
                BusinessHours.objects.create(calendar=cal, weekday=d,
                                             start_time=time(9, 0), end_time=time(17, 0))
        return cal

    def test_spec_from_calendar_honours_recurring_and_ignores_deleted(self):
        from .business_time import spec_from_calendar
        from .models import Holiday
        cal = self._cal()
        Holiday.objects.create(calendar=cal, date=date(2026, 12, 25), name="Xmas", recurring_annually=True)
        Holiday.objects.create(calendar=cal, date=date(2026, 10, 20), name="One-off")
        gone = Holiday.objects.create(calendar=cal, date=date(2026, 11, 2), recurring_annually=True)
        gone.soft_delete()
        spec = spec_from_calendar(cal)
        self.assertTrue(spec.is_holiday(date(2027, 12, 25)))
        self.assertFalse(spec.is_holiday(date(2027, 10, 20)))
        self.assertFalse(spec.is_holiday(date(2026, 11, 2)))
        self.assertFalse(spec.is_holiday(date(2027, 11, 2)))

    def test_hours_less_calendar_is_24x7(self):
        from .business_time import spec_from_calendar
        spec = spec_from_calendar(self._cal(hours=False))
        self.assertTrue(spec.has_any_window())
        self.assertEqual(len(spec.windows), 7)

    def test_due_beyond_horizon_falls_back_to_wall_clock(self):
        from .services.sla_engine import _due
        start = datetime(2026, 10, 19, 9, 0, tzinfo=UTC)
        self.assertEqual(_due(_mon_fri(), start, 400000), start + timedelta(minutes=400000))

    def test_api_create_calendar_gets_default_week(self):
        from rest_framework.test import APIClient

        from .models import BusinessHours
        admin = get_user_model().objects.create_superuser(username="root", password="x")
        client = APIClient()
        client.force_authenticate(admin)
        resp = client.post("/api/v1/itsm/business-calendars/",
                           {"name": "US", "timezone": "America/New_York"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        rows = BusinessHours.objects.filter(calendar_id=resp.data["id"]).order_by("weekday")
        self.assertEqual([r.weekday for r in rows], [0, 1, 2, 3, 4])
        self.assertTrue(all(r.start_time == time(9, 0) and r.end_time == time(17, 0) for r in rows))

    def test_seed_still_idempotent(self):
        from .models import BusinessHours
        from .seed import run
        run(); run()
        self.assertEqual(BusinessHours.objects.filter(calendar__name="Standard Business Hours (IST)").count(), 5)

    def test_readd_deleted_holiday_and_target_revives_row(self):
        from rest_framework.test import APIClient

        from .models import SLAMetric, SLAPolicy
        admin = get_user_model().objects.create_superuser(username="root", password="x")
        client = APIClient()
        client.force_authenticate(admin)
        cal = self._cal()
        body = {"calendar": str(cal.id), "date": "2026-12-25", "name": "Xmas"}
        first = client.post("/api/v1/itsm/holidays/", body, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(client.delete(f"/api/v1/itsm/holidays/{first.data['id']}/").status_code, 204)
        again = client.post("/api/v1/itsm/holidays/", {**body, "recurring_annually": True}, format="json")
        self.assertEqual(again.status_code, 201, again.content)
        self.assertEqual(again.data["id"], first.data["id"])
        self.assertTrue(again.data["recurring_annually"])

        metric = SLAMetric.objects.create(policy=SLAPolicy.objects.create(name="P"),
                                          kind="resolution", name="Res")
        tbody = {"metric": str(metric.id), "priority": "p4", "target_minutes": 100}
        t1 = client.post("/api/v1/itsm/sla-targets/", tbody, format="json")
        self.assertEqual(t1.status_code, 201, t1.content)
        self.assertEqual(client.delete(f"/api/v1/itsm/sla-targets/{t1.data['id']}/").status_code, 204)
        t2 = client.post("/api/v1/itsm/sla-targets/", {**tbody, "target_minutes": 200}, format="json")
        self.assertEqual(t2.status_code, 201, t2.content)
        self.assertEqual(t2.data["target_minutes"], 200)


class HoursLessCalendarEngineTests(SlaTicketMixin, TestCase):
    """C1/B9: a project on a calendar with no hours used to get due = now (instant
    breach) and crashed the breach sweep + SLA endpoint (MisconfiguredCalendar)."""

    def setUp(self):
        from .models import BusinessCalendar
        self._seed()
        cal = BusinessCalendar.objects.create(name="Empty", timezone="Asia/Kolkata", is_default=True)
        self.project.calendar = cal
        self.project.save(update_fields=["calendar"])

    def test_clock_runs_24x7_and_sweep_survives(self):
        from .services import sla_engine
        before = timezone.now()
        t = self._create("p2")
        res = self._tr(t, "resolution")
        self.assertGreater(res.due_at, before + timedelta(minutes=470))
        self.assertLess(res.due_at, timezone.now() + timedelta(minutes=481))
        sla_engine.scan_breaches()  # must not raise
        payload = sla_engine.countdown_payload(res)
        self.assertFalse(payload["breached"])
        self.assertEqual(payload["rag"], "green")
