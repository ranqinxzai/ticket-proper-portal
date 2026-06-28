"""Tests for the business-time engine — the highest-correctness-risk code."""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

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


class FirstResponseStopTests(TestCase):
    """The first-response clock stops on the first public reply OR on resolution
    (a `done` status) — but NOT merely on moving to an in-progress status. Picking
    a ticket up is not a response to the requester. See BUG_LOG (ITINC-606)."""

    def setUp(self):
        from apps.itsm_rbac.registry import seed_rbac
        from apps.itsm_helpdesks.seed import run as seed_helpdesks
        from apps.itsm_workflows.seed import run as seed_workflows
        from apps.itsm_groups.seed import run as seed_groups
        from apps.itsm_projects.seed import run as seed_projects
        from apps.itsm_projects.models import Project
        from apps.itsm_tickets.services import ticket_service
        from .models import BusinessCalendar, BusinessHours, SLAMetric, SLAPolicy, SLATarget

        seed_rbac(); seed_helpdesks(); seed_workflows(); seed_groups(); seed_projects()
        # 24/7 default calendar so `due_at` is comfortably in the future and any
        # stop within the test run lands as "met".
        cal = BusinessCalendar.objects.create(name="24x7", timezone="UTC", is_default=True)
        for d in range(7):
            BusinessHours.objects.create(
                calendar=cal, weekday=d, start_time=time(0, 0), end_time=time(23, 59))

        project = Project.objects.get(helpdesk__key="IT", project_type="incident")
        policy = SLAPolicy.objects.create(
            name="IT Incidents", project=project, calendar=cal,
            is_default=True, is_active=True)
        for kind, name in (("first_response", "Time to First Response"),
                           ("resolution", "Time to Resolution")):
            metric = SLAMetric.objects.create(policy=policy, kind=kind, name=name)
            SLATarget.objects.create(metric=metric, priority="high", target_minutes=480)

        self.user = get_user_model().objects.create_user(username="ag", password="x")
        self.ticket = ticket_service.create_ticket(
            project=project, ticket_type=project.ticket_types.get(key="incident"),
            summary="Test", priority="high", user=self.user,
        )

    def _tracker(self, kind):
        from .models import SLATracker
        return SLATracker.objects.get(ticket=self.ticket, metric__kind=kind)

    def _transition(self, name, **fields):
        from apps.itsm_workflows.models import Transition
        from apps.itsm_workflows.services import engine
        tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
        # Carry a note so transitions configured with a mandatory note (e.g. Resolve) pass.
        engine.transition(self.ticket, tr, self.user, fields=fields or None, comment="note")
        self.ticket.refresh_from_db()

    def test_trackers_start_running(self):
        self.assertEqual(self._tracker("first_response").state, "running")

    def test_in_progress_does_not_stop_first_response(self):
        self._transition("Assign")
        self._transition("Start Progress")
        self.assertEqual(self.ticket.status.category.key, "in_progress")
        self.assertEqual(self._tracker("first_response").state, "running")

    def test_resolve_stops_first_response_as_met(self):
        self._transition("Assign")
        self._transition("Start Progress")
        self._transition("Resolve", resolution="fixed")
        self.assertEqual(self.ticket.status.category.key, "done")
        fr = self._tracker("first_response")
        self.assertEqual(fr.state, "met")
        self.assertFalse(fr.breached)
