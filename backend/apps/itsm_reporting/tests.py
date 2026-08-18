"""Reporting: explicit From–To date-range window, inclusive `to` day, and the
6-month cap guard (added 2026-06-24).

The reports console runs each report over an explicit date range (default: the
current month) capped at 6 months. These cover the service windowing and the
view-level guard. Existing report endpoints had no tests; this is the first.
"""

from datetime import date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.itsm_projects.models import Project
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_sla.models import SLAMetric, SLAPolicy, SLATracker
from apps.itsm_tickets.models import Ticket
from apps.itsm_tickets.services import ticket_service

from .services import reports

User = get_user_model()

REPORTS_BASE = "/api/v1/itsm/reports/"


def _seed_min():
    seed_rbac()
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


def _inc_project():
    return Project.objects.get(helpdesk__key="IT", project_type="incident")


def _make_ticket(project, summary, created):
    """Create a ticket, then stamp ``created_at`` to a fixed datetime — ``update``
    bypasses the field's ``auto_now_add`` so we can place it in a known month."""
    t = ticket_service.create_ticket(
        project=project, ticket_type=project.ticket_types.get(key="incident"),
        summary=summary, priority="p2",
    )
    Ticket.objects.filter(pk=t.pk).update(created_at=created)
    t.refresh_from_db()
    return t


def _aware(y, m, d, hour=12):
    return timezone.make_aware(datetime(y, m, d, hour, 0), timezone.get_current_timezone())


class ReportDateWindowServiceTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _inc_project()
        # Three tickets across two months (noon to dodge tz day-edge ambiguity).
        _make_ticket(self.inc, "May ticket", _aware(2026, 5, 15))
        _make_ticket(self.inc, "Jun 1 ticket", _aware(2026, 6, 1))
        _make_ticket(self.inc, "Jun 30 ticket", _aware(2026, 6, 30))

    def _count(self, **f):
        return sum(r["value"] for r in reports.by_status(**f))

    def test_range_filters_by_created_day(self):
        # June window → 2 tickets (Jun 1 + Jun 30); the May ticket is excluded.
        self.assertEqual(self._count(date_from="2026-06-01", date_to="2026-06-30"), 2)

    def test_to_day_is_inclusive(self):
        # A ticket created ON the `to` day is counted (a midnight-truncating
        # `created_at__lte=<date>` would have dropped it).
        self.assertEqual(self._count(date_from="2026-06-30", date_to="2026-06-30"), 1)

    def test_created_vs_resolved_honors_explicit_window(self):
        rows = reports.created_vs_resolved(date_from="2026-06-01", date_to="2026-06-30")
        by_date = {r["date"]: r["created"] for r in rows}
        self.assertNotIn("2026-05-15", by_date)  # before the window
        self.assertEqual(by_date.get("2026-06-01"), 1)
        self.assertEqual(by_date.get("2026-06-30"), 1)  # inclusive end day

    def test_window_lone_date_to_anchors_on_end(self):
        # A lone date_to (no date_from) must anchor the `days` fallback on the END,
        # not "now" — otherwise start could exceed end and silently return nothing.
        start, end = reports._window(30, None, "2026-06-30")
        self.assertEqual(end, date(2026, 6, 30))
        self.assertEqual(start, date(2026, 5, 31))  # end - 30 days, deterministic

    def test_created_vs_resolved_lone_date_to_not_empty(self):
        rows = reports.created_vs_resolved(date_to="2026-06-30")  # days defaults to 30
        self.assertTrue(rows)  # not the old silent start>end empty window
        by_date = {r["date"]: r["created"] for r in rows}
        self.assertEqual(by_date.get("2026-06-30"), 1)
        self.assertEqual(by_date.get("2026-06-01"), 1)  # within [end-30, end]
        self.assertNotIn("2026-05-15", by_date)  # before end-30


class ReportRangeGuardViewTests(TestCase):
    def setUp(self):
        _seed_min()
        self.admin = User.objects.create_superuser(username="adm", password="x", email="a@a.io")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_over_six_months_is_400(self):
        resp = self.client.get(f"{REPORTS_BASE}by-status/?date_from=2025-01-01&date_to=2026-01-01")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_reversed_range_is_400(self):
        resp = self.client.get(f"{REPORTS_BASE}by-status/?date_from=2026-06-30&date_to=2026-06-01")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_within_six_months_is_200(self):
        resp = self.client.get(f"{REPORTS_BASE}by-status/?date_from=2026-01-01&date_to=2026-06-15")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_open_ended_days_window_not_capped(self):
        # The dashboard sends `days` with no `date_to` → exempt from the 6-month cap.
        resp = self.client.get(f"{REPORTS_BASE}created-vs-resolved/?days=365")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_malformed_days_is_400(self):
        # A non-numeric `days` must be a clean 400, not an unhandled 500.
        resp = self.client.get(f"{REPORTS_BASE}by-status/?days=abc")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_negative_days_is_400(self):
        resp = self.client.get(f"{REPORTS_BASE}by-status/?days=-5")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_export_single_respects_cap(self):
        resp = self.client.get(
            f"{REPORTS_BASE}by-status/export/?format=csv&date_from=2025-01-01&date_to=2026-01-01")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_export_single_returns_file_not_404(self):
        # Regression: ?format=xlsx|csv used to 404 via DRF content negotiation
        # (no xlsx/csv renderer). It must now return the file.
        xlsx = self.client.get(
            f"{REPORTS_BASE}by-status/export/?format=xlsx&date_from=2026-06-01&date_to=2026-06-30")
        self.assertEqual(xlsx.status_code, 200, xlsx.content[:200])
        self.assertIn("spreadsheetml", xlsx["Content-Type"])
        self.assertIn("attachment", xlsx["Content-Disposition"])
        csv = self.client.get(
            f"{REPORTS_BASE}by-status/export/?format=csv&date_from=2026-06-01&date_to=2026-06-30")
        self.assertEqual(csv.status_code, 200, csv.content[:200])
        self.assertIn("text/csv", csv["Content-Type"])

    def test_export_all_returns_workbook(self):
        resp = self.client.get(
            f"{REPORTS_BASE}export/?format=xlsx&date_from=2026-06-01&date_to=2026-06-30")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertIn("spreadsheetml", resp["Content-Type"])


class TicketDataExportServiceTests(TestCase):
    """The raw "Ticket Data" export must carry every standard ticket field — incl.
    the ITIL Impact Assessment + Resolution Details fields added in migration 0005.
    Regression: those eight fields were absent from the export manifest."""

    _ITIL_FIELDS = [
        "business_impact", "users_affected", "service_downtime", "major_incident",
        "resolution_code", "root_cause", "workaround_provided", "resolution_notes",
    ]

    @classmethod
    def setUpTestData(cls):
        _seed_min()
        cls.inc = _inc_project()
        cls.ticket = _make_ticket(cls.inc, "Prod outage", _aware(2026, 6, 15))
        Ticket.objects.filter(pk=cls.ticket.pk).update(
            business_impact="Checkout down for all customers", users_affected=1200,
            service_downtime=True, major_incident=True,
            resolution_code="fixed", root_cause="Bad deploy", workaround_provided=False,
            resolution_notes="Rolled back release 4.2.",
        )

    def test_columns_include_itil_fields(self):
        keys = {c["key"] for c in reports.ticket_data()["columns"]}
        for f in self._ITIL_FIELDS:
            self.assertIn(f, keys, f"{f} missing from Ticket Data columns")

    def test_rows_carry_itil_values(self):
        row = next(r for r in reports.ticket_data()["rows"]
                   if r["ticket_number"] == self.ticket.ticket_number)
        self.assertEqual(row["business_impact"], "Checkout down for all customers")
        self.assertEqual(row["users_affected"], 1200)
        self.assertIs(row["service_downtime"], True)
        self.assertIs(row["major_incident"], True)
        self.assertEqual(row["resolution_code"], "fixed")
        self.assertEqual(row["root_cause"], "Bad deploy")
        self.assertIs(row["workaround_provided"], False)
        self.assertEqual(row["resolution_notes"], "Rolled back release 4.2.")


class DashboardDrilldownReportTests(TestCase):
    """The dashboard drill-down surface (added 2026-07-10): accurate server-side
    attention counts + the SLA at-risk / breached-open drill lists, plus the
    id/key fields the segment→queue drill-down navigation relies on."""

    def setUp(self):
        _seed_min()
        self.inc = _inc_project()
        self.agent = User.objects.create_user(username="agent1", password="x", email="a1@a.io")
        self.now = timezone.now()

        # Open tickets in known states (created "now" so they land in the open backlog).
        self.t_unassigned = _make_ticket(self.inc, "No owner", self.now)
        self.t_overdue = _make_ticket(self.inc, "Past due", self.now)
        Ticket.objects.filter(pk=self.t_overdue.pk).update(
            assignee=self.agent, due_date=self.now - timedelta(hours=3))
        # A resolved (done) ticket — must be excluded from every open count.
        self.t_done = _make_ticket(self.inc, "Fixed", self.now)
        self._resolve(self.t_done)

        # SLA trackers (manually built — _seed_min seeds no SLA policy, so the create
        # hook starts none). One breached (red), one at-risk (amber), one healthy.
        self.policy = SLAPolicy.objects.create(name="P", is_default=True)
        self.metric = SLAMetric.objects.create(policy=self.policy, kind="resolution", name="Resolution")
        self.t_breached = self._sla_ticket("Breaching", started=-130, due=-30, state="running")
        self.t_at_risk = self._sla_ticket("At risk", started=-80, due=+20, state="running")
        self.t_green = self._sla_ticket("Healthy", started=-10, due=+90, state="running")

    def _resolve(self, ticket):
        from apps.itsm_workflows.models import Status
        done = Status.objects.filter(
            workflow=self.inc.default_workflow, category__key="done").first()
        Ticket.objects.filter(pk=ticket.pk).update(status=done, resolved_at=self.now)

    def _sla_ticket(self, summary, *, started, due, state):
        """An OPEN, assigned ticket with one resolution tracker at the given offsets
        (minutes relative to now). Assigned + no due_date so it only affects the SLA
        counts, not unassigned/overdue."""
        t = _make_ticket(self.inc, summary, self.now)
        Ticket.objects.filter(pk=t.pk).update(assignee=self.agent)
        SLATracker.objects.create(
            ticket=t, metric=self.metric, target_minutes=100,
            started_at=self.now + timedelta(minutes=started),
            due_at=self.now + timedelta(minutes=due), state=state)
        return t.__class__.objects.get(pk=t.pk)

    # ── attention summary ────────────────────────────────────────────────────
    def test_attention_counts_are_accurate(self):
        s = reports.attention_summary(project=self.inc.id)
        # 6 open tickets (unassigned, overdue, breached, at_risk, green); done excluded.
        self.assertEqual(s["open_total"], 5)
        self.assertEqual(s["unassigned"], 1)          # only t_unassigned
        self.assertEqual(s["overdue"], 1)             # only t_overdue
        self.assertEqual(s["sla_breached"], 1)        # t_breached (red)
        self.assertEqual(s["sla_at_risk"], 1)         # t_at_risk (amber, not breached)
        self.assertFalse(s["sla_partial"])

    def test_done_ticket_excluded_from_attention(self):
        # If the resolved ticket leaked into the open backlog, open_total would be 6.
        s = reports.attention_summary(project=self.inc.id)
        self.assertEqual(s["open_total"], 5)

    def test_attention_respects_helpdesk_clamp(self):
        # An HR-helpdesk ticket must not roll into an IT-scoped summary.
        hr = Project.objects.get(helpdesk__key="HR", project_type="incident")
        _make_ticket(hr, "HR unassigned", self.now)
        it_id = self.inc.helpdesk_id
        s = reports.attention_summary(helpdesk_ids=[it_id])
        self.assertEqual(s["unassigned"], 1)  # the HR ticket is clamped out

    # ── drill-down lists ─────────────────────────────────────────────────────
    def test_at_risk_list_has_the_amber_ticket(self):
        rows = reports.sla_at_risk_list(project=self.inc.id)
        nums = {r["ticket_number"] for r in rows}
        self.assertIn(self.t_at_risk.ticket_number, nums)
        self.assertNotIn(self.t_breached.ticket_number, nums)
        self.assertNotIn(self.t_green.ticket_number, nums)
        self.assertTrue(all(r["project_key"] for r in rows))  # drill link needs the key

    def test_breached_open_list_has_the_red_ticket(self):
        rows = reports.sla_breached_open_list(project=self.inc.id)
        nums = {r["ticket_number"] for r in rows}
        self.assertIn(self.t_breached.ticket_number, nums)
        self.assertNotIn(self.t_at_risk.ticket_number, nums)

    # ── drill-down id/key fields on the distribution reports ──────────────────
    def test_by_status_carries_status_id(self):
        rows = reports.by_status(project=self.inc.id)
        self.assertTrue(rows)
        self.assertTrue(all(r.get("status_id") for r in rows))

    def test_by_group_carries_group_id_or_unassigned(self):
        rows = reports.by_group(project=self.inc.id)
        self.assertTrue(rows)
        for r in rows:
            if r["label"] == "Unassigned":
                self.assertIsNone(r["group_id"])
            else:
                self.assertTrue(r["group_id"])

    def test_by_source_groups_by_source(self):
        rows = reports.by_source(project=self.inc.id)
        total = sum(r["value"] for r in rows)
        # by_source spans all 6 tickets (open + the resolved one — it's not open-only).
        self.assertEqual(total, 6)
        self.assertTrue(all(r["label"] for r in rows))

    def test_dashboard_helper_reports_export_without_500(self):
        # Regression: the list-shaped dashboard helpers are in REPORTS (so
        # /reports/<name>/export/ resolves them) but had no export column map —
        # a non-empty result crashed `_section` on `.items()` → HTTP 500.
        admin = User.objects.create_superuser(username="adm2", password="x", email="adm2@a.io")
        client = APIClient()
        client.force_authenticate(admin)
        for key in ("by-source", "sla-at-risk-list", "sla-breached-open-list"):
            csv = client.get(f"{REPORTS_BASE}{key}/export/?format=csv")
            self.assertEqual(csv.status_code, 200, f"{key} csv: {csv.content[:200]}")
            xlsx = client.get(f"{REPORTS_BASE}{key}/export/?format=xlsx")
            self.assertEqual(xlsx.status_code, 200, f"{key} xlsx: {xlsx.content[:120]}")
