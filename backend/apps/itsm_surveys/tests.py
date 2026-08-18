"""CSAT survey tests: trigger matching, scale normalisation, submit rules,
comment sanitisation, the CSAT report aggregate, and the portal boundary."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_tickets.portal import PortalTicketViewSet
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.seed import run as seed_workflows
from apps.itsm_workflows.services import engine

from apps.itsm_reporting.services import reports

from .models import SurveyConfig, SurveyResponse, normalize
from .seed import ensure_survey_config
from .services import survey_service

User = get_user_model()


def _seed_min():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


class SurveyTestBase(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.requestor = User.objects.create_user(
            username="req", email="req@example.com", password="x")
        RoleAssignment.objects.create(
            user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.cfg = ensure_survey_config(self.inc)
        self.cfg.enabled = True
        self.cfg.trigger = "closed"
        self.cfg.scale_type = "csat5"
        self.cfg.save()

    def _ticket(self, requestor=None):
        return ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="Printer down", priority="p2", user=self.agent,
            requestor=requestor if requestor is not None else self.requestor,
        )

    def _advance(self, ticket, *names):
        for name in names:
            tr = Transition.objects.get(workflow=ticket.workflow, name=name)
            kwargs = {}
            if tr.note_required:
                kwargs = {"comment": "done", "fields": {"resolution": "fixed"}}
            with self.captureOnCommitCallbacks(execute=True):
                engine.transition(ticket, tr, self.agent, **kwargs)
            ticket.refresh_from_db()
        return ticket

    def _survey_count(self, ticket):
        return SurveyResponse.objects.filter(ticket=ticket, is_deleted=False).count()


class TriggerTests(SurveyTestBase):
    def test_survey_sent_on_close(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve")
        self.assertEqual(self._survey_count(t), 0, "closed trigger must not fire on resolve")
        self._advance(t, "Close")
        self.assertEqual(self._survey_count(t), 1)
        resp = SurveyResponse.objects.get(ticket=t)
        self.assertEqual(resp.status, "pending")
        self.assertEqual(resp.scale_type, "csat5")
        self.assertIsNotNone(resp.sent_at)
        # A branded survey email is queued in the notification outbox.
        from apps.itsm_notifications.models import NotificationOutbox
        row = NotificationOutbox.objects.get(event_type="SurveyRequest", ticket=t)
        self.assertEqual(row.status, "queued")
        self.assertIn("/feedback", row.rendered_html)

    def test_resolved_trigger_fires_on_resolve(self):
        self.cfg.trigger = "resolved"
        self.cfg.save()
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve")
        self.assertEqual(self._survey_count(t), 1)

    def test_disabled_sends_nothing(self):
        self.cfg.enabled = False
        self.cfg.save()
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        self.assertEqual(self._survey_count(t), 0)

    def test_no_requestor_email_sends_nothing(self):
        nobody = User.objects.create_user(username="anon", password="x")  # no email
        t = self._ticket(requestor=nobody)
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        self.assertEqual(self._survey_count(t), 0)

    def test_idempotent_no_double_send(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        self.assertEqual(self._survey_count(t), 1)
        # A second matching transition (or a re-fire) must never create a 2nd survey.
        survey_service.maybe_send_survey(t, t.status)
        self.assertEqual(self._survey_count(t), 1)


class NormalizationTests(TestCase):
    def test_scale_maps(self):
        self.assertEqual(normalize("csat5", 5), (100.0, True))
        self.assertEqual(normalize("csat5", 3), (50.0, False))
        self.assertEqual(normalize("csat5", 4), (75.0, True))
        self.assertEqual(normalize("stars5", 1), (0.0, False))
        self.assertEqual(normalize("thumbs", 2), (100.0, True))
        self.assertEqual(normalize("thumbs", 1), (0.0, False))
        self.assertEqual(normalize("nps", 9), (90.0, True))
        self.assertEqual(normalize("nps", 6), (60.0, False))


class SubmitTests(SurveyTestBase):
    def _sent_ticket(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        return t

    def test_submit_records_and_normalizes(self):
        t = self._sent_ticket()
        resp = survey_service.submit(t, self.requestor, 5, "great job")
        self.assertEqual(resp.status, "submitted")
        self.assertEqual(resp.rating, 5)
        self.assertEqual(resp.csat_score, 100.0)
        self.assertTrue(resp.is_satisfied)
        self.assertEqual(resp.comment_text, "great job")
        self.assertIsNotNone(resp.submitted_at)

    def test_invalid_rating_rejected(self):
        t = self._sent_ticket()
        with self.assertRaises(ValueError):
            survey_service.submit(t, self.requestor, 9, "")  # 9 invalid on csat5

    def test_submit_without_sent_survey_rejected(self):
        t = self._ticket()  # never resolved/closed → no survey
        with self.assertRaises(ValueError):
            survey_service.submit(t, self.requestor, 5, "")

    def test_comment_required(self):
        self.cfg.comment_required = True
        self.cfg.save()
        t = self._sent_ticket()
        with self.assertRaises(ValueError):
            survey_service.submit(t, self.requestor, 4, "   ")
        resp = survey_service.submit(t, self.requestor, 4, "ok thanks")
        self.assertEqual(resp.comment_text, "ok thanks")

    def test_comment_sanitized(self):
        t = self._sent_ticket()
        resp = survey_service.submit(
            t, self.requestor, 5, "<script>alert(1)</script>nice")
        self.assertNotIn("<script>", resp.comment_text)
        self.assertIn("nice", resp.comment_text)


class ReportTests(SurveyTestBase):
    def test_csat_summary(self):
        for rating in (5, 3):  # one satisfied, one not
            t = self._ticket()
            self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
            survey_service.submit(t, self.requestor, rating, "")
        data = reports.csat_summary(project=str(self.inc.id))
        self.assertEqual(data["responses"], 2)
        self.assertEqual(data["satisfied"], 1)
        self.assertEqual(data["csat_pct"], 50.0)
        self.assertEqual(data["avg_score"], 75.0)  # (100 + 50) / 2
        ratings = {r["rating"]: r["value"] for r in data["by_rating"]}
        self.assertEqual(ratings, {3: 1, 5: 1})

    def test_csat_responses_list(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        survey_service.submit(t, self.requestor, 4, "solid")
        rows = reports.csat_responses(project=str(self.inc.id))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["rating"], 4)
        self.assertEqual(rows[0]["comment"], "solid")
        self.assertEqual(rows[0]["ticket"], t.ticket_number)


class PortalBoundaryTests(SurveyTestBase):
    def _survey_view(self):
        return PortalTicketViewSet.as_view({"get": "survey", "post": "survey"})

    def test_requestor_can_fetch_and_submit(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        factory = APIRequestFactory()
        view = self._survey_view()

        get_req = factory.get(f"/portal/requests/{t.ticket_number}/survey/")
        force_authenticate(get_req, user=self.requestor)
        get_resp = view(get_req, pk=t.ticket_number)
        self.assertEqual(get_resp.status_code, 200)
        self.assertTrue(get_resp.data["enabled"])
        self.assertEqual(get_resp.data["config"]["scale_type"], "csat5")

        post_req = factory.post(
            f"/portal/requests/{t.ticket_number}/survey/", {"rating": 5}, format="json")
        force_authenticate(post_req, user=self.requestor)
        post_resp = view(post_req, pk=t.ticket_number)
        self.assertEqual(post_resp.status_code, 200)
        self.assertEqual(post_resp.data["response"]["status"], "submitted")

    def test_non_requestor_gets_404(self):
        t = self._ticket()
        self._advance(t, "Assign", "Start Progress", "Resolve", "Close")
        other = User.objects.create_user(username="req2", email="r2@example.com", password="x")
        RoleAssignment.objects.create(
            user=other, role=SystemRole.objects.get(code="requestor"))
        factory = APIRequestFactory()
        post_req = factory.post(
            f"/portal/requests/{t.ticket_number}/survey/", {"rating": 5}, format="json")
        force_authenticate(post_req, user=other)
        resp = self._survey_view()(post_req, pk=t.ticket_number)
        self.assertEqual(resp.status_code, 404)
