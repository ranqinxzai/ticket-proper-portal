"""Reporting: explicit From–To date-range window, inclusive `to` day, and the
6-month cap guard (added 2026-06-24).

The reports console runs each report over an explicit date range (default: the
current month) capped at 6 months. These cover the service windowing and the
view-level guard. Existing report endpoints had no tests; this is the first.
"""

from datetime import date, datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.itsm_projects.models import Project
from apps.itsm_rbac.registry import seed_rbac
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
        summary=summary, priority="high",
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
