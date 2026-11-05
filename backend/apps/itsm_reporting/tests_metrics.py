"""Reporting metric correctness (2026-10-18 bug-fix batch, WS5).

- M1 SLA breach list "Overdue by" = real lateness in business minutes (was breach-
  detection lag: ``breached_at − due_at``).
- M2 SLA compliance per ticket + per metric; assignment SLAs and cancelled clocks
  excluded; running-past-due counts as breached; group filter honoured.
- M3 resolution time in business hours on each ticket's SLA calendar, over tickets
  RESOLVED in the range (unassigned included).
- M4 agent performance lists agents with only open work; Open = live backlog; names.
"""

from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.itsm_projects.models import Project
from apps.itsm_sla.models import (BusinessCalendar, BusinessHours, SLAMetric, SLAPolicy,
                                  SLATracker)
from apps.itsm_tickets.models import Ticket
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Status

from .services import export, reports
from .tests import REPORTS_BASE, _inc_project, _seed_min

User = get_user_model()
UTC = dt_timezone.utc


def _utc(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=UTC)


def _calendar(name, start, end, *, default=False, weekdays=range(5)):
    """A UTC calendar with one working window per listed weekday (Mon=0)."""
    cal = BusinessCalendar.objects.create(name=name, timezone="UTC", is_default=default)
    for d in weekdays:
        BusinessHours.objects.create(calendar=cal, weekday=d, start_time=start, end_time=end)
    return cal


def _ticket(project, *, created, resolved=None, priority="p2", assignee=None, done=False):
    t = ticket_service.create_ticket(
        project=project, ticket_type=project.ticket_types.first(),
        summary="t", priority="p2")
    upd = {"created_at": created, "priority": priority, "assignee": assignee}
    if resolved:
        upd["resolved_at"] = resolved
    if done or resolved:
        upd["status"] = Status.objects.filter(
            workflow=project.default_workflow, category__key="done").first()
    Ticket.objects.filter(pk=t.pk).update(**upd)
    return Ticket.objects.get(pk=t.pk)


# 2026-06-15 is a Monday.
class SlaBreachOverdueTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _inc_project()
        self.policy = SLAPolicy.objects.create(name="P")
        self.metric = SLAMetric.objects.create(policy=self.policy, kind="resolution",
                                               name="Resolution")

    def _breach(self, ticket, **kw):
        return SLATracker.objects.create(ticket=ticket, metric=self.metric, target_minutes=60,
                                         breached=True, **kw)

    def _row(self, ticket, **f):
        return next(r for r in reports.sla_breach_list(**f)
                    if r["ticket_number"] == ticket.ticket_number)

    def test_finished_late_is_business_minutes_to_stop(self):
        cal = _calendar("9-17", time(9), time(17))
        t = _ticket(self.inc, created=_utc(2026, 6, 15, 9))
        self._breach(t, calendar=cal, state="breached", started_at=_utc(2026, 6, 15, 9),
                     due_at=_utc(2026, 6, 15, 11), breached_at=_utc(2026, 6, 15, 11, 1),
                     stopped_at=_utc(2026, 6, 16, 10))
        row = self._row(t, project=self.inc.id)
        # Mon 11:00–17:00 (360) + Tue 09:00–10:00 (60). The old value was 1 (detection lag).
        self.assertEqual(row["minutes_overdue"], 420)
        self.assertEqual(row["finished_at"], _utc(2026, 6, 16, 10).isoformat())

    def test_still_running_counts_to_now(self):
        now = timezone.now()
        t = _ticket(self.inc, created=now - timedelta(hours=5))
        self._breach(t, state="running", started_at=now - timedelta(hours=5),
                     due_at=now - timedelta(hours=3),
                     breached_at=now - timedelta(hours=3) + timedelta(minutes=1))
        row = self._row(t, project=self.inc.id)
        self.assertGreaterEqual(row["minutes_overdue"], 180)  # no calendar ⇒ wall-clock
        self.assertLessEqual(row["minutes_overdue"], 181)
        self.assertIsNone(row["finished_at"])

    def test_paused_counts_to_pause(self):
        now = timezone.now()
        t = _ticket(self.inc, created=now - timedelta(hours=6))
        self._breach(t, state="paused", started_at=now - timedelta(hours=6),
                     due_at=now - timedelta(hours=5), paused_at=now - timedelta(hours=2),
                     breached_at=now - timedelta(hours=5))
        self.assertEqual(self._row(t, project=self.inc.id)["minutes_overdue"], 180)

    def test_helpdesk_clamp(self):
        hr = Project.objects.get(helpdesk__key="HR", project_type="incident")
        now = timezone.now()
        t = _ticket(hr, created=now)
        self._breach(t, state="breached", started_at=now - timedelta(hours=2),
                     due_at=now - timedelta(hours=1), stopped_at=now, breached_at=now)
        nums = {r["ticket_number"] for r in
                reports.sla_breach_list(helpdesk_ids=[self.inc.helpdesk_id])}
        self.assertNotIn(t.ticket_number, nums)

    def test_export_header_renamed(self):
        header = export.build_csv("sla-breach-list", []).decode("utf-8-sig").splitlines()[0]
        self.assertIn("Overdue by (business min)", header)
        self.assertIn("Finished", header)
        self.assertNotIn("Mins overdue", header)


class SlaComplianceTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _inc_project()
        pol = SLAPolicy.objects.create(name="P")
        self.fr = SLAMetric.objects.create(policy=pol, kind="first_response", name="FR")
        self.res = SLAMetric.objects.create(policy=pol, kind="resolution", name="Res")
        self.asg = SLAMetric.objects.create(policy=pol, kind="assignment", name="Asg")
        self.now = timezone.now()
        mk = lambda: _ticket(self.inc, created=self.now)  # noqa: E731
        self.t1, self.t2, self.t3, self.t4, self.t5, self.t6 = (mk() for _ in range(6))
        self._tr(self.t1, self.fr, "met"); self._tr(self.t1, self.res, "met")
        self._tr(self.t2, self.fr, "met"); self._tr(self.t2, self.res, "breached", True, -30)
        # Running past due, not yet flagged by the scanner → breached.
        self._tr(self.t3, self.fr, "running", False, -10); self._tr(self.t3, self.res, "running")
        # Assignment breach must be ignored.
        self._tr(self.t4, self.res, "met"); self._tr(self.t4, self.asg, "breached", True, -30)
        # Cancelled FR clock excluded; resolution still running → undecided.
        self._tr(self.t5, self.fr, "stopped", True, -30); self._tr(self.t5, self.res, "running")
        self._tr(self.t6, self.fr, "running"); self._tr(self.t6, self.res, "running")

    def _tr(self, ticket, metric, state, breached=False, due=60):
        return SLATracker.objects.create(
            ticket=ticket, metric=metric, target_minutes=60, state=state, breached=breached,
            started_at=self.now - timedelta(hours=2), due_at=self.now + timedelta(minutes=due))

    def _metric(self, data, kind):
        return next(m for m in data["by_metric"] if m["metric"] == kind)

    def test_per_metric_and_per_ticket(self):
        data = reports.sla_compliance(project=self.inc.id)
        fr, res = self._metric(data, "first_response"), self._metric(data, "resolution")
        self.assertEqual((fr["met"], fr["breached"], fr["compliance_pct"]), (2, 1, 66.7))
        self.assertEqual((res["met"], res["breached"], res["compliance_pct"]), (2, 1, 66.7))
        # Per ticket: t1 + t4 met, t2 + t3 breached, t5/t6 undecided.
        self.assertEqual((data["total"], data["met"], data["breached"]), (4, 2, 2))
        self.assertEqual(data["compliance_pct"], 50.0)

    def test_helpdesk_clamp(self):
        hr = Project.objects.get(helpdesk__key="HR", project_type="incident")
        self._tr(_ticket(hr, created=self.now), self.fr, "breached", True, -30)
        data = reports.sla_compliance(helpdesk_ids=[self.inc.helpdesk_id])
        self.assertEqual(self._metric(data, "first_response")["breached"], 1)

    def test_created_date_range(self):
        old = _ticket(self.inc, created=_utc(2025, 1, 1, 12))
        self._tr(old, self.res, "breached", True, -30)
        self.assertEqual(self._metric(reports.sla_compliance(project=self.inc.id),
                                      "resolution")["breached"], 2)
        today = self.now.date().isoformat()
        self.assertEqual(self._metric(reports.sla_compliance(project=self.inc.id,
                                                             date_from=today),
                                      "resolution")["breached"], 1)

    def test_group_filter(self):
        from apps.itsm_groups.models import Group
        g = Group.objects.first()
        Ticket.objects.filter(pk=self.t2.pk).update(assigned_group=g)
        Ticket.objects.exclude(pk=self.t2.pk).update(assigned_group=None)
        data = reports.sla_compliance(group=g.id)
        self.assertEqual((data["total"], data["met"], data["breached"]), (1, 0, 1))

    def test_no_data_is_none(self):
        data = reports.sla_compliance(date_from="2030-01-01")
        self.assertIsNone(data["compliance_pct"])
        self.assertEqual(len(data["by_metric"]), 2)

    def test_export_section_rows(self):
        _title, headers, rows = export._section("sla-compliance",
                                                reports.sla_compliance(project=self.inc.id))
        self.assertEqual(headers, ["SLA", "Measured", "Met", "Breached", "Compliance %"])
        self.assertEqual([r[0] for r in rows], ["Overall (per ticket)", "First response",
                                                "Resolution"])
        self.assertEqual(rows[0][4], "50.0%")


class ResolutionBusinessHoursTests(TestCase):
    RANGE = {"date_from": "2026-06-01", "date_to": "2026-06-30"}

    def setUp(self):
        _seed_min()
        self.inc = _inc_project()

    def _by_prio(self, **f):
        return {r["priority"]: r for r in reports.resolution_time_by_priority(**f)}

    def test_calendar_precedence_and_resolved_range(self):
        cal_proj = _calendar("proj 9-17", time(9), time(17))
        cal_pol = _calendar("policy 10-12", time(10), time(12))
        _calendar("default 8-9", time(8), time(9), default=True)
        Project.objects.filter(pk=self.inc.pk).update(calendar=cal_proj)
        hr = Project.objects.get(helpdesk__key="HR", project_type="incident")
        SLAPolicy.objects.create(name="HR", project=hr, calendar=cal_pol, is_active=True)
        req = Project.objects.get(helpdesk__key="IT", project_type="service_request")

        # Project calendar: Mon 16:00 → Tue 10:00 = 1h + 1h (wall-clock 18h). Unassigned.
        _ticket(self.inc, created=_utc(2026, 6, 15, 16), resolved=_utc(2026, 6, 16, 10))
        # Project policy's calendar: Mon 10:00 → 14:00 = 10–12 = 2h.
        _ticket(hr, created=_utc(2026, 6, 15, 10), resolved=_utc(2026, 6, 15, 14), priority="p3")
        # Default calendar: Mon 08:30 → Tue 08:30 = 30m + 30m = 1h.
        _ticket(req, created=_utc(2026, 6, 15, 8, 30), resolved=_utc(2026, 6, 16, 8, 30),
                priority="p4")
        # Created before the range, resolved in it → counted.
        _ticket(self.inc, created=_utc(2026, 5, 29, 9), resolved=_utc(2026, 6, 1, 10),
                priority="p1")
        # Created in the range, resolved after it → not counted.
        _ticket(self.inc, created=_utc(2026, 6, 29, 9), resolved=_utc(2026, 7, 2, 9),
                priority="p1")

        rows = self._by_prio(**self.RANGE)
        self.assertEqual((rows["p2"]["resolved_count"], rows["p2"]["avg_hours"]), (1, 2.0))
        self.assertEqual(rows["p3"]["avg_hours"], 2.0)
        self.assertEqual(rows["p4"]["avg_hours"], 1.0)
        # Fri 29 May 09:00–17:00 (8h) + Mon 1 Jun 09:00–10:00 (1h) = 9h.
        self.assertEqual((rows["p1"]["resolved_count"], rows["p1"]["avg_hours"]), (1, 9.0))

    def test_no_calendar_is_wall_clock(self):
        _ticket(self.inc, created=_utc(2026, 6, 15, 10), resolved=_utc(2026, 6, 15, 14))
        self.assertEqual(self._by_prio(**self.RANGE)["p2"]["avg_hours"], 4.0)


class AgentPerformanceTests(TestCase):
    RANGE = {"date_from": "2026-06-01", "date_to": "2026-06-30"}

    def setUp(self):
        _seed_min()
        self.inc = _inc_project()
        self.a = User.objects.create_user(username="asha", password="x", full_name="Asha Rao")
        self.b = User.objects.create_user(username="bong", password="x")
        self.c = User.objects.create_user(username="cee", password="x")
        self.d = User.objects.create_user(username="dk", password="x", first_name="Dee",
                                          last_name="Kay")
        tk = _ticket
        tk(self.inc, assignee=self.a, created=_utc(2026, 6, 15, 10), resolved=_utc(2026, 6, 15, 14))
        tk(self.inc, assignee=self.a, created=_utc(2026, 6, 16, 8), resolved=_utc(2026, 6, 16, 10))
        tk(self.inc, assignee=self.a, created=_utc(2025, 3, 1, 9))            # open, old
        tk(self.inc, assignee=self.b, created=_utc(2025, 1, 1, 9))            # open, old
        tk(self.inc, assignee=self.b, created=_utc(2025, 1, 2, 9))            # open, old
        tk(self.inc, assignee=self.d, created=_utc(2026, 6, 20, 9))           # open
        tk(self.inc, assignee=self.c, created=_utc(2026, 5, 1, 9), resolved=_utc(2026, 5, 10, 9))
        tk(self.inc, created=_utc(2026, 6, 17, 9), resolved=_utc(2026, 6, 17, 10))  # unassigned

    def test_rows(self):
        rows = reports.agent_performance(**self.RANGE)
        self.assertEqual([r["agent"] for r in rows], ["Asha Rao", "bong", "Dee Kay"])
        a, b, d = rows
        self.assertEqual((a["resolved_count"], a["open_count"], a["avg_resolution_hours"]),
                         (2, 1, 3.0))
        # Agent with only open work (created long before the range) is listed; Open is live.
        self.assertEqual((b["resolved_count"], b["open_count"], b["avg_resolution_hours"]),
                         (0, 2, None))
        self.assertEqual((d["resolved_count"], d["open_count"]), (0, 1))

    def test_api(self):
        admin = User.objects.create_superuser(username="adm", password="x", email="a@a.io")
        client = APIClient()
        client.force_authenticate(admin)
        resp = client.get(f"{REPORTS_BASE}agent-performance/?date_from=2026-06-01"
                          "&date_to=2026-06-30")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.json()["data"]), 3)


class AttentionBusinessTimeTests(TestCase):
    """"SLA at risk" uses the engine's business-time reader (``timer_snapshot``), the
    same as the queue bars — not the old wall-clock fraction."""

    def test_weekend_does_not_count_toward_at_risk(self):
        from unittest import mock

        _seed_min()
        inc = _inc_project()
        cal = _calendar("9-17", time(9), time(17))
        metric = SLAMetric.objects.create(policy=SLAPolicy.objects.create(name="P"),
                                          kind="resolution", name="Resolution")
        t = _ticket(inc, created=_utc(2026, 6, 19, 16, 30))
        # Fri 16:30 + 120 business min → due Mon 10:30.
        SLATracker.objects.create(ticket=t, metric=metric, calendar=cal, target_minutes=120,
                                  state="running", started_at=_utc(2026, 6, 19, 16, 30),
                                  due_at=_utc(2026, 6, 22, 10, 30))
        # Mon 09:05: 35 of 120 business minutes used (29%) → green. Wall-clock would
        # say 64h35m of 66h (98%) → amber / "at risk".
        with mock.patch("django.utils.timezone.now", return_value=_utc(2026, 6, 22, 9, 5)):
            s = reports.attention_summary(project=inc.id)
        self.assertEqual((s["sla_at_risk"], s["sla_breached"]), (0, 0))
        with mock.patch("django.utils.timezone.now", return_value=_utc(2026, 6, 22, 10, 0)):
            s = reports.attention_summary(project=inc.id)  # 90/120 = 75% → amber
        self.assertEqual(s["sla_at_risk"], 1)
