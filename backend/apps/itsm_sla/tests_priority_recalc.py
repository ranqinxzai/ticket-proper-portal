"""B8 (2026-10-18): a blank SLA target means NO SLA for that priority, and a priority
change re-evaluates the ticket's unfinished clocks (re-target / withdraw / restore /
start). Also C3 (stopping a paused clock counts the hold) and C7 (bulk priority goes
through update_ticket)."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

FR_TARGETS = {"p1": 30, "p2": 60}               # p3, p4 blank
RES_TARGETS = {"p1": 240, "p2": 480, "p3": 960}  # p4 blank


def _approx(testcase, a, b, seconds=2):
    testcase.assertLess(abs((a - b).total_seconds()), seconds, f"{a} != {b}")


class SlaTicketMixin:
    """Seeded IT incident project + a project policy with First Response and
    Resolution metrics. No BusinessCalendar exists, so clocks run 24×7 UTC (exact)."""

    def _seed(self):
        from apps.itsm_groups.seed import run as seed_groups
        from apps.itsm_helpdesks.seed import run as seed_helpdesks
        from apps.itsm_projects.models import Project
        from apps.itsm_projects.seed import run as seed_projects
        from apps.itsm_rbac.registry import seed_rbac
        from apps.itsm_workflows.seed import run as seed_workflows

        from .models import SLAMetric, SLAPolicy, SLATarget

        seed_rbac(); seed_helpdesks(); seed_workflows(); seed_groups(); seed_projects()
        self.project = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.policy = SLAPolicy.objects.create(name="IT", project=self.project, is_active=True)
        self.fr = SLAMetric.objects.create(policy=self.policy, kind="first_response",
                                           name="Time to First Response")
        self.res = SLAMetric.objects.create(policy=self.policy, kind="resolution",
                                            name="Time to Resolution")
        for metric, table in ((self.fr, FR_TARGETS), (self.res, RES_TARGETS)):
            for pr, mins in table.items():
                SLATarget.objects.create(metric=metric, priority=pr, target_minutes=mins)
        self.user = get_user_model().objects.create_user(username="ag", password="x")

    def _create(self, priority, project=None):
        from apps.itsm_tickets.services import ticket_service
        project = project or self.project
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.create_ticket(
                project=project, ticket_type=project.ticket_types.first(),
                summary="T", priority=priority, user=self.user, apply_routing=False,
            )

    def _update(self, ticket, **changes):
        from apps.itsm_tickets.services import ticket_service
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.update_ticket(ticket=ticket, user=self.user, **changes)
        ticket.refresh_from_db()

    def _tr(self, ticket, kind, all_rows=False):
        from .models import SLATracker
        mgr = SLATracker.all_objects if all_rows else SLATracker.objects
        return mgr.filter(ticket=ticket, metric__kind=kind).first()

    def _backdate(self, ticket, minutes):
        from .services import sla_engine
        for kind in ("first_response", "resolution"):
            tr = self._tr(ticket, kind)
            if tr:
                tr.started_at = timezone.now() - timedelta(minutes=minutes)
                tr.save(update_fields=["started_at"])
                sla_engine.recompute(tr)


class BlankTargetTests(SlaTicketMixin, TestCase):
    def setUp(self):
        self._seed()

    def test_blank_target_starts_no_clock(self):
        t4 = self._create("p4")
        self.assertIsNone(self._tr(t4, "first_response"))
        self.assertIsNone(self._tr(t4, "resolution"))
        t3 = self._create("p3")
        self.assertIsNone(self._tr(t3, "first_response"))  # no fallback to p1/p2 or 480
        self.assertEqual(self._tr(t3, "resolution").target_minutes, 960)

    def test_target_lookup_has_no_fallback(self):
        from .services.sla_engine import _target_minutes
        self.assertIsNone(_target_minutes(self.fr, "p4"))
        self.assertEqual(_target_minutes(self.fr, "p2"), 60)


class PriorityRecalcTests(SlaTicketMixin, TestCase):
    def setUp(self):
        self._seed()

    def test_retarget_keeps_elapsed_and_start(self):
        from .services import sla_engine
        t = self._create("p2")
        self._backdate(t, 100)
        started = self._tr(t, "resolution").started_at
        self._update(t, priority="p1")
        res = self._tr(t, "resolution")
        self.assertEqual(res.target_minutes, 240)
        self.assertEqual(res.started_at, started)
        _approx(self, res.due_at, started + timedelta(minutes=240))
        fr = self._tr(t, "first_response")
        self.assertEqual(fr.target_minutes, 30)
        snap = sla_engine.timer_snapshot(fr)
        self.assertTrue(snap["breached"])        # 100 min used of a 30-min target
        self.assertGreater(snap["percent_used"], 300)
        t.refresh_from_db()
        _approx(self, t.due_date, res.due_at)    # Ticket.due_date mirrors resolution

    def test_blank_new_priority_withdraws_clock(self):
        from apps.itsm_core.models import AuditEvent

        from .models import SLATracker
        t = self._create("p2")
        self._update(t, priority="p4")
        self.assertEqual(SLATracker.objects.filter(ticket=t).count(), 0)
        rows = SLATracker.all_objects.filter(ticket=t)
        self.assertEqual(rows.count(), 2)
        self.assertTrue(all(r.is_deleted and not r.breached for r in rows))
        self.assertIsNone(t.due_date)
        ev = AuditEvent.objects.filter(ticket=t, action="field_changed", field_key="sla").first()
        self.assertIsNotNone(ev)
        self.assertIn("no SLA", ev.payload["new"])
        self.assertEqual(ev.payload["new_priority"], "p4")
        self.assertEqual({c["action"] for c in ev.payload["changes"]}, {"withdrawn"})

    def test_withdrawn_clock_restored_from_original_start(self):
        t = self._create("p2")
        first = self._tr(t, "resolution")
        self._update(t, priority="p4")
        self._update(t, priority="p1")
        res = self._tr(t, "resolution")
        self.assertEqual(res.pk, first.pk)
        self.assertFalse(res.is_deleted)
        self.assertEqual(res.started_at, first.started_at)
        self.assertEqual((res.target_minutes, res.state), (240, "running"))

    def test_no_clock_then_target_starts_backdated(self):
        t = self._create("p4")
        self._update(t, priority="p1")
        res, fr = self._tr(t, "resolution"), self._tr(t, "first_response")
        self.assertEqual(res.started_at, t.created_at)
        self.assertEqual(fr.started_at, t.created_at)
        self.assertEqual((res.target_minutes, fr.target_minutes), (240, 30))

    def test_already_responded_does_not_start_first_response(self):
        from apps.itsm_tickets.services import ticket_service
        t = self._create("p4")
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=t, author=self.user, body_html="<p>hi</p>")
        t.refresh_from_db()
        self._update(t, priority="p1")
        self.assertIsNone(self._tr(t, "first_response", all_rows=True))
        self.assertIsNotNone(self._tr(t, "resolution"))

    def test_finished_clock_is_untouched(self):
        from apps.itsm_tickets.services import ticket_service
        t = self._create("p2")
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=t, author=self.user, body_html="<p>hi</p>")
        t.refresh_from_db()
        self._update(t, priority="p1")
        fr = self._tr(t, "first_response")
        self.assertEqual((fr.state, fr.target_minutes), ("met", 60))
        self.assertEqual(self._tr(t, "resolution").target_minutes, 240)

    def test_paused_clock_retargeted_stays_paused(self):
        from .services import sla_engine
        t = self._create("p2")
        sla_engine.pause(t, "resolution")
        self._update(t, priority="p1")
        res = self._tr(t, "resolution")
        self.assertEqual((res.state, res.target_minutes), ("paused", 240))

    def test_breach_flag_rederived_on_longer_target(self):
        t = self._create("p2")
        res = self._tr(t, "resolution")
        res.breached, res.breached_at = True, timezone.now()
        res.save(update_fields=["breached", "breached_at"])
        self._update(t, priority="p3")
        res.refresh_from_db()
        self.assertEqual(res.target_minutes, 960)
        self.assertFalse(res.breached)
        self.assertIsNone(res.breached_at)

    def test_impact_urgency_recompute_retargets(self):
        t = self._create("p2")
        self._update(t, impact="critical", urgency="high")  # default matrix → p1
        self.assertEqual(t.priority, "p1")
        self.assertEqual(self._tr(t, "resolution").target_minutes, 240)

    def test_same_target_logs_nothing(self):
        from apps.itsm_core.models import AuditEvent

        from .models import SLATarget
        SLATarget.objects.create(metric=self.fr, priority="p3", target_minutes=60)
        SLATarget.objects.filter(metric=self.res, priority="p3").update(target_minutes=480)
        t = self._create("p2")
        self._update(t, priority="p3")
        self.assertFalse(AuditEvent.objects.filter(ticket=t, field_key="sla").exists())

    def test_automation_set_field_priority_retargets(self):
        from apps.itsm_automation.services.actions import run_set_field
        t = self._create("p2")
        with self.captureOnCommitCallbacks(execute=True):
            run_set_field(t, {"field": "priority", "value": "p1"}, self.user)
        self.assertEqual(self._tr(t, "resolution").target_minutes, 240)

    def test_escalation_raise_priority_goes_through_update_ticket(self):
        from apps.itsm_core.models import AuditEvent

        from .models import EscalationRule
        from .services import sla_engine
        t = self._create("p3")
        esc = EscalationRule.objects.create(metric=self.res, threshold_pct=75, action="raise_priority")
        tr = self._tr(t, "resolution")
        with self.captureOnCommitCallbacks(execute=True):
            sla_engine._run_escalation(esc, tr)
        t.refresh_from_db()
        self.assertEqual(t.priority, "p2")
        ev = AuditEvent.objects.filter(ticket=t, action="priority_changed").first()
        self.assertEqual((ev.payload["old"], ev.payload["new"]), ("p3", "p2"))
        self.assertEqual(self._tr(t, "resolution").target_minutes, 480)

    def test_bulk_priority_validates_and_retargets(self):
        from rest_framework.test import APIClient

        from apps.itsm_core.models import AuditEvent
        t = self._create("p2")
        admin = get_user_model().objects.create_superuser(username="root", password="x")
        client = APIClient()
        client.force_authenticate(admin)
        bad = client.post("/api/v1/itsm/tickets/bulk/", {"ids": [str(t.id)], "op": "priority",
                                                         "value": "urgent"}, format="json")
        self.assertEqual(bad.status_code, 400)
        with self.captureOnCommitCallbacks(execute=True):
            ok = client.post("/api/v1/itsm/tickets/bulk/", {"ids": [str(t.id)], "op": "priority",
                                                            "value": "p1"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        t.refresh_from_db()
        self.assertEqual(t.priority, "p1")
        self.assertTrue(AuditEvent.objects.filter(ticket=t, action="priority_changed").exists())
        self.assertEqual(self._tr(t, "resolution").target_minutes, 240)


class MoveRetargetTests(SlaTicketMixin, TestCase):
    def setUp(self):
        self._seed()

    def test_move_retargets_kept_clocks_and_starts_none(self):
        from apps.itsm_projects.models import Project
        from apps.itsm_tickets.services import ticket_service
        from apps.itsm_workflows.models import Status

        from .models import SLAMetric, SLAPolicy, SLATarget, SLATracker
        dst = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        dpol = SLAPolicy.objects.create(name="REQ", project=dst, is_active=True)
        dmet = SLAMetric.objects.create(policy=dpol, kind="resolution", name="Res (dst)")
        SLATarget.objects.create(metric=dmet, priority="p1", target_minutes=5)
        t = self._create("p2")
        t.impact, t.urgency = "high", "high"
        t.save(update_fields=["impact", "urgency"])
        dst.priority_matrix = {"high": {"high": "p1"}}
        dst.save(update_fields=["priority_matrix"])
        status = Status.objects.filter(workflow=dst.default_workflow).order_by("sort_order").first()
        with self.captureOnCommitCallbacks(execute=True):
            moved = ticket_service.move_ticket(
                ticket=t, target_project=dst, target_ticket_type=dst.ticket_types.first(),
                target_status=status, user=self.user)
        moved.refresh_from_db()
        self.assertEqual(moved.priority, "p1")
        res = SLATracker.objects.get(ticket=moved, metric=self.res)
        self.assertEqual(res.target_minutes, 240)                  # source policy's P1
        self.assertFalse(SLATracker.all_objects.filter(ticket=moved, metric=dmet).exists())


class StopFromPausedTests(SlaTicketMixin, TestCase):
    """C3: resolving straight from a paused status must not count the hold."""

    def setUp(self):
        self._seed()

    def test_stop_from_paused_counts_hold(self):
        from .models import SLAPauseInterval
        from .services import sla_engine
        t = self._create("p2")  # resolution 480 min
        tr = self._tr(t, "resolution")
        now = timezone.now()
        tr.started_at = now - timedelta(hours=10)
        tr.due_at = tr.started_at + timedelta(hours=8)  # 2h "overdue" on the pre-pause due
        tr.state, tr.paused_at = "paused", now - timedelta(hours=9)
        tr.save()
        SLAPauseInterval.objects.create(tracker=tr, paused_at=tr.paused_at)
        sla_engine.stop(t, "resolution")
        tr.refresh_from_db()
        self.assertEqual(tr.state, "met")
        self.assertFalse(tr.breached)
        self.assertAlmostEqual(tr.total_paused_minutes, 540, delta=1)
        self.assertFalse(tr.pauses.filter(resumed_at__isnull=True).exists())
        self.assertAlmostEqual(sla_engine.elapsed_minutes(tr), 60, delta=1)
