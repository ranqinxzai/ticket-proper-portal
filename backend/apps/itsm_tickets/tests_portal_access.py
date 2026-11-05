"""Portal read-only access for approvers and watchers (U3/U13, 2026-10-18).

Matrix: requestor / approver (pending, decided) / watcher / stranger ×
view, conversation, reply, reopen, watchers add/remove, upload, feedback.
Only the requestor writes; approvers and watchers read (403 on writes); a
stranger sees nothing (404). "My Requests" stays requestor-only."""

from __future__ import annotations

import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.services import engine

from .models import Watcher
from .services import ticket_service
from .tests import _project, _seed_min

User = get_user_model()


def _requestor(username):
    u = User.objects.create_user(username=username, password="x", email=f"{username}@ex.com",
                                 full_name=username.title())
    RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code="requestor"))
    return u


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class PortalAccessMatrixTests(TestCase):
    def setUp(self):
        from apps.itsm_approvals.models import ApprovalStage, ApprovalWorkflow
        from apps.itsm_approvals.services import engine as approvals

        _seed_min()
        self.inc = _project("IT", "incident")
        self.req = _requestor("req")
        self.approver = _requestor("appr")
        self.watcher = _requestor("watch")
        self.stranger = _requestor("stranger")
        self.colleague = _requestor("colleague")
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))

        self.t = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="Laptop", priority="p3", requestor=self.req, user=self.req,
            apply_routing=False,
        )
        Watcher.objects.create(ticket=self.t, user=self.watcher)
        wf = ApprovalWorkflow.objects.create(name="Mgr", project=self.inc)
        ApprovalStage.objects.create(workflow=wf, name="Manager", level=1,
                                     approver_type="specific_user", approver_user=self.approver)
        self.areq = approvals.start_approval(self.t, wf, user=self.req)

    # helpers ---------------------------------------------------------------
    def _c(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def _url(self, name):
        return reverse(name, args=[self.t.ticket_number])

    def _decide_and_resolve(self):
        from apps.itsm_approvals.services import engine as approvals

        approvals.decide(self.areq, self.approver, "approved", "ok")
        for name in ("Assign", "Start Progress", "Resolve"):
            tr = Transition.objects.get(workflow=self.t.workflow, name=name)
            engine.transition(self.t, tr, self.agent, fields={"resolution": "x"}, comment="done")
        self.t.refresh_from_db()

    # view ------------------------------------------------------------------
    def test_view_matrix_pending_approval(self):
        url = self._url("itsm-portal-request-detail")
        for user, role in ((self.req, "requestor"), (self.approver, "approver"),
                           (self.watcher, "watcher")):
            resp = self._c(user).get(url)
            self.assertEqual(resp.status_code, 200, user.username)
            self.assertEqual(resp.data["viewer_role"], role)
            comments = self._c(user).get(self._url("itsm-portal-request-comments"))
            self.assertEqual(comments.status_code, 200, user.username)
        self.assertEqual(self._c(self.stranger).get(url).status_code, 404)

    def test_decided_approver_keeps_read_access(self):
        self._decide_and_resolve()
        resp = self._c(self.approver).get(self._url("itsm-portal-request-detail"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["viewer_role"], "approver")

    def test_removed_watcher_loses_access(self):
        Watcher.objects.get(ticket=self.t, user=self.watcher).soft_delete()
        resp = self._c(self.watcher).get(self._url("itsm-portal-request-detail"))
        self.assertEqual(resp.status_code, 404)

    def test_my_requests_list_and_pulse_stay_requestor_only(self):
        for user, n in ((self.req, 1), (self.approver, 0), (self.watcher, 0)):
            resp = self._c(user).get("/api/v1/itsm/portal/requests/")
            rows = resp.data["results"] if isinstance(resp.data, dict) else resp.data
            self.assertEqual(len(rows), n, user.username)
            pulse = self._c(user).get("/api/v1/itsm/portal/requests/pulse/")
            self.assertEqual(pulse.data["count"], n, user.username)

    # writes ----------------------------------------------------------------
    def test_reply_matrix(self):
        url = self._url("itsm-portal-request-comments")
        for user in (self.approver, self.watcher):
            self.assertEqual(self._c(user).post(url, {"body_html": "hi"}, format="json").status_code,
                             403, user.username)
        self.assertEqual(self._c(self.stranger).post(url, {"body_html": "hi"}, format="json")
                         .status_code, 404)
        self.assertEqual(self._c(self.req).post(url, {"body_html": "hi"}, format="json").status_code,
                         201)

    def test_reopen_matrix(self):
        self._decide_and_resolve()
        reopen = Transition.objects.get(workflow=self.t.workflow, name="Reopen")
        url = self._url("itsm-portal-request-transition")
        avail = self._url("itsm-portal-request-available-transitions")
        for user in (self.approver, self.watcher):
            self.assertEqual(self._c(user).get(avail).data, [], user.username)
            resp = self._c(user).post(url, {"transition_id": str(reopen.id)}, format="json")
            self.assertEqual(resp.status_code, 403, user.username)
        self.assertEqual(self._c(self.stranger).post(
            url, {"transition_id": str(reopen.id)}, format="json").status_code, 404)
        self.assertEqual([x["name"] for x in self._c(self.req).get(avail).data], ["Reopen"])
        resp = self._c(self.req).post(url, {"transition_id": str(reopen.id)}, format="json")
        self.assertEqual(resp.status_code, 200)

    def test_watchers_matrix(self):
        add = self._url("itsm-portal-request-watchers")
        remove = self._url("itsm-portal-request-remove-watcher")
        w = Watcher.objects.get(ticket=self.t, user=self.watcher)
        for user in (self.approver, self.watcher):
            self.assertEqual(self._c(user).get(add).status_code, 200, user.username)  # names only
            self.assertEqual(self._c(user).post(add, {"email": "colleague@ex.com"}, format="json")
                             .status_code, 403, user.username)
            self.assertEqual(self._c(user).post(remove, {"watcher_id": str(w.id)}, format="json")
                             .status_code, 403, user.username)
        self.assertEqual(self._c(self.stranger).post(add, {"email": "colleague@ex.com"},
                                                     format="json").status_code, 404)
        self.assertEqual(self._c(self.req).post(add, {"email": "colleague@ex.com"}, format="json")
                         .status_code, 201)
        self.assertEqual(self._c(self.req).post(remove, {"watcher_id": str(w.id)}, format="json")
                         .status_code, 204)

    def test_upload_matrix(self):
        url = reverse("itsm-portal-intake-attachments", args=[self.t.ticket_number])

        def _post(user):
            f = SimpleUploadedFile("a.txt", b"hello", content_type="text/plain")
            return self._c(user).post(url, {"file": f}, format="multipart")

        self.assertEqual(_post(self.approver).status_code, 403)
        self.assertEqual(_post(self.watcher).status_code, 403)
        self.assertEqual(_post(self.stranger).status_code, 404)
        self.assertEqual(_post(self.req).status_code, 201)

    def test_feedback_matrix(self):
        from apps.itsm_surveys.models import SurveyResponse
        from apps.itsm_surveys.seed import ensure_survey_config

        ensure_survey_config(self.inc)
        SurveyResponse.objects.create(ticket=self.t, project=self.inc, requestor=self.req,
                                      status="pending", scale_type="csat5")
        url = self._url("itsm-portal-request-survey")
        for user in (self.approver, self.watcher):
            self.assertEqual(self._c(user).get(url).status_code, 403, user.username)
            self.assertEqual(self._c(user).post(url, {"rating": 5}, format="json").status_code,
                             403, user.username)
        self.assertEqual(self._c(self.stranger).post(url, {"rating": 5}, format="json")
                         .status_code, 404)
        resp = self._c(self.req).post(url, {"rating": 5}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["response"]["status"], "submitted")
