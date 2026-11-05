"""2026-10-18 batch (WS6): internal-event privacy (S3), approval notifications (G4),
the rejected-request message, WatcherAdded (U13), audience-aware links and the
bell's live link (U5), and the additive data migration."""

from __future__ import annotations

import importlib

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_tickets.models import Watcher
from apps.itsm_tickets.services import ticket_service

from .models import EVENT_CHOICES, InAppNotification, NotificationOutbox, NotificationRule
from .seed import ensure_notification_scheme
from .services import bus, templates
from .tests import _make_ticket, _project, _seed_min

User = get_user_model()


def _user(username, role=None, helpdesk=None, **kw):
    u = User.objects.create_user(username, email=f"{username}@example.com", password="x", **kw)
    if role:
        RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code=role))
    if helpdesk is not None:
        HelpdeskMembership.objects.create(helpdesk=helpdesk, user=u)
    return u


def _inapp(event, ticket):
    return set(InAppNotification.objects.filter(event_type=event, ticket=ticket)
               .values_list("recipient__username", flat=True))


def _emails(event, ticket):
    return set(NotificationOutbox.objects.filter(event_type=event, ticket=ticket, channel="email")
               .values_list("recipient__username", flat=True))


class InternalEventPrivacyTests(TestCase):
    """S3: internal notes / SLA alerts never reach requestor-added portal watchers."""

    def setUp(self):
        _seed_min()
        self.project = _project()
        hd = self.project.helpdesk
        other_hd = Helpdesk.objects.exclude(pk=hd.pk).first()
        self.scheme = ensure_notification_scheme(self.project)
        self.req = _user("req", role="requestor")
        self.agent = _user("agentw", role="agent", helpdesk=hd)
        self.colleague = _user("colleague", role="requestor")  # requestor-added, no membership
        self.outsider = _user("outsider", role="agent", helpdesk=other_hd)  # other helpdesk
        self.gone = _user("gone", role="agent", helpdesk=hd)  # watcher who was removed
        self.author = User.objects.create_superuser("root", email="root@example.com", password="x")
        self.ticket = _make_ticket(self.project, self.req)
        for u in (self.agent, self.colleague, self.outsider, self.gone):
            Watcher.objects.create(ticket=self.ticket, user=u)
        Watcher.objects.get(ticket=self.ticket, user=self.gone).soft_delete()

    def _comment(self, visibility):
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.add_comment(ticket=self.ticket, author=self.author,
                                              body_html="<p>note</p>", visibility=visibility)

    def test_private_note_only_reaches_helpdesk_agent_watchers(self):
        # Even when an admin adds the requestor to the rule, the clamp holds.
        NotificationRule.objects.filter(scheme=self.scheme, event_type="CommentAddedPrivate").update(
            recipients=["assignee", "watchers", "requestor"])
        self._comment("private")
        self.assertEqual(_inapp("CommentAddedPrivate", self.ticket), {"agentw"})

    def test_private_note_needs_internal_comment_read(self):
        # A member whose role can't read internal notes isn't told about one.
        viewer_role = SystemRole.objects.create(code="viewer", name="Viewer")
        ra = RoleAssignment.objects.get(user=self.agent)
        ra.role = viewer_role
        ra.save()
        self._comment("private")
        self.assertEqual(_inapp("CommentAddedPrivate", self.ticket), set())

    def test_public_comment_still_reaches_portal_watcher(self):
        self._comment("public")
        got = _inapp("CommentAdded", self.ticket)
        self.assertIn("colleague", got)
        self.assertIn("req", got)
        self.assertNotIn("gone", got)  # removed watchers are no longer notified

    def test_sla_breach_clamped_to_agents(self):
        NotificationRule.objects.filter(scheme=self.scheme, event_type="SLABreach").update(
            recipients=["watchers", "requestor"])
        bus.emit("SLABreach", ticket=self.ticket, actor=None, context={"metric": "resolution"})
        self.assertEqual(_inapp("SLABreach", self.ticket), {"agentw"})

    def test_mention_in_private_note_clamped(self):
        c = self._comment("private")
        bus.emit("Mentioned", ticket=self.ticket, actor=self.author,
                 context={"comment_id": str(c.id),
                          "user_ids": [str(self.colleague.id), str(self.agent.id)]})
        self.assertEqual(_inapp("Mentioned", self.ticket), {"agentw"})


class AudienceLinkTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()
        ensure_notification_scheme(self.project)
        self.req = _user("req", role="requestor")
        self.agent = _user("ag", role="agent", helpdesk=self.project.helpdesk)
        self.colleague = _user("colleague", role="requestor")
        self.ticket = _make_ticket(self.project, self.req)

    def test_links_follow_helpdesk_membership(self):
        self.assertIn("/agent/w/", templates.build_ticket_path(self.ticket, self.agent))
        # Not a member of the helpdesk → the (read-only) portal view, not a dead agent link.
        self.assertIn("/portal/requests/", templates.build_ticket_path(self.ticket, self.colleague))
        self.assertIn("/portal/requests/", templates.build_ticket_path(self.ticket, self.req))

    def test_bell_link_is_recomputed_for_the_viewer(self):
        InAppNotification.objects.create(recipient=self.colleague, event_type="CommentAdded",
                                         ticket=self.ticket, title="x", link="/tickets/OLD-1")
        c = APIClient()
        c.force_authenticate(self.colleague)
        resp = c.get("/api/v1/itsm/notifications/")
        self.assertEqual(resp.status_code, 200)
        row = resp.data["results"][0] if "results" in resp.data else resp.data[0]
        self.assertTrue(row["link"].endswith(f"/portal/requests/{self.ticket.ticket_number}"))


class ApprovalNotificationTests(TestCase):
    """G4: approvers are asked; requestor + assignee hear the outcome."""

    def setUp(self):
        from apps.itsm_approvals.models import ApprovalStage, ApprovalWorkflow

        _seed_min()
        self.project = _project()
        hd = self.project.helpdesk
        ensure_notification_scheme(self.project)
        self.req = _user("req", role="requestor")
        self.mgr = _user("mgr", role="requestor")  # portal-only approver
        self.lead = _user("lead", role="agent", helpdesk=hd)  # agent approver
        self.tech = _user("tech", role="agent", helpdesk=hd)
        self.ticket = _make_ticket(self.project, self.req)
        self.ticket.assignee = self.tech
        self.ticket.save(update_fields=["assignee"])
        self.wf = ApprovalWorkflow.objects.create(name="Mgr sign-off", project=self.project)
        self.l1 = ApprovalStage.objects.create(workflow=self.wf, name="Manager", level=1,
                                               approver_type="specific_user", approver_user=self.mgr)
        self.l2 = ApprovalStage.objects.create(workflow=self.wf, name="Lead", level=2,
                                               approver_type="specific_user", approver_user=self.lead)

    def _start(self):
        from apps.itsm_approvals.services import engine
        with self.captureOnCommitCallbacks(execute=True):
            return engine.start_approval(self.ticket, self.wf, user=self.req)

    def _decide(self, req, who, decision, comment=""):
        from apps.itsm_approvals.services import engine
        with self.captureOnCommitCallbacks(execute=True):
            return engine.decide(req, who, decision, comment)

    def test_event_choices_include_new_events(self):
        keys = {k for k, _ in EVENT_CHOICES}
        for e in ("ApprovalRequested", "ApprovalGranted", "ApprovalRejected",
                  "ApprovalCancelled", "WatcherAdded"):
            self.assertIn(e, keys)

    def test_requested_notifies_pending_approver_with_inbox_link(self):
        self._start()
        self.assertEqual(_inapp("ApprovalRequested", self.ticket), {"mgr"})
        note = InAppNotification.objects.get(event_type="ApprovalRequested", recipient=self.mgr)
        self.assertTrue(note.link.endswith("/portal/approvals"))
        row = NotificationOutbox.objects.get(event_type="ApprovalRequested", recipient=self.mgr)
        self.assertIn("/portal/approvals", row.rendered_html)
        self.assertIn("Review approval", row.rendered_html)
        self.assertTrue(row.rendered_subject.startswith(f"[{self.ticket.ticket_number}]"))

    def test_next_level_is_asked_after_level_one_approves(self):
        req = self._start()
        self._decide(req, self.mgr, "approved")
        note = InAppNotification.objects.get(event_type="ApprovalRequested", recipient=self.lead)
        self.assertTrue(note.link.endswith("/agent/approvals"))  # agent → agent inbox

    def test_same_approver_on_two_levels_is_emailed_twice(self):
        # The level-2 ask must not dedupe onto the level-1 email (same request id).
        # (Driven via bus.emit: in a real decide() the approver is the actor and is
        # suppressed as such.)
        self.l2.approver_user = self.mgr
        self.l2.save()
        req = self._start()
        req.current_stage = self.l2
        req.save(update_fields=["current_stage"])
        bus.emit("ApprovalRequested", ticket=self.ticket, actor=self.req,
                 context={"approval_request": str(req.id), "stage": str(self.l2.id)})
        self.assertEqual(NotificationOutbox.objects.filter(
            event_type="ApprovalRequested", recipient=self.mgr).count(), 2)

    def test_granted_goes_to_requestor_and_assignee(self):
        req = self._start()
        self._decide(req, self.mgr, "approved")
        self._decide(req, self.lead, "approved")
        self.assertEqual(_emails("ApprovalGranted", self.ticket), {"req", "tech"})

    def test_rejected_carries_the_reason(self):
        req = self._start()
        self._decide(req, self.mgr, "rejected", "Over budget this quarter")
        self.assertEqual(_emails("ApprovalRejected", self.ticket), {"req", "tech"})
        row = NotificationOutbox.objects.get(event_type="ApprovalRejected", recipient=self.req)
        self.assertIn("Over budget this quarter", row.rendered_html)
        self.assertIn("Over budget this quarter", row.rendered_body)
        self.assertIn("rejected", row.rendered_subject.lower())

    def test_move_into_rejected_status_is_one_clear_email(self):
        """WS1 auto-moves a rejected request to a done "Rejected" status. The engine
        then emits Resolved; the requestor must get ONE rejection email with the
        reason, never "Good news — resolved"."""
        from apps.itsm_workflows.models import Status, StatusCategory

        req = self._start()
        self._decide(req, self.mgr, "rejected", "Not approved: duplicate request")
        rejected = Status.objects.create(
            workflow=self.ticket.workflow, name="Rejected", key="rejected",
            category=StatusCategory.objects.get(key="done"))
        self.ticket.status = rejected
        self.ticket.save(update_fields=["status"])
        bus.emit("Resolved", ticket=self.ticket, actor=self.mgr,
                 context={"from": "New", "to": "Rejected", "changed_at": "2026-10-18T10:00:00"})
        self.assertFalse(NotificationOutbox.objects.filter(
            ticket=self.ticket, event_type="Resolved").exists())
        req_rows = NotificationOutbox.objects.filter(
            ticket=self.ticket, recipient=self.req, channel="email",
            event_type__in=["ApprovalRejected", "StatusChanged", "Resolved"])
        self.assertEqual(req_rows.count(), 1)  # ApprovalRejected; the status email collapsed
        # A watcher (not told by ApprovalRejected) gets the status email, worded as a rejection.
        watcher = _user("w2", role="requestor")
        Watcher.objects.create(ticket=self.ticket, user=watcher)
        bus.emit("Resolved", ticket=self.ticket, actor=self.mgr,
                 context={"from": "New", "to": "Rejected", "changed_at": "2026-10-18T10:00:01"})
        row = NotificationOutbox.objects.get(ticket=self.ticket, recipient=watcher)
        self.assertEqual(row.event_type, "StatusChanged")
        self.assertIn("Not approved: duplicate request", row.rendered_html)
        self.assertIn("Request rejected", row.rendered_html)


class WatcherAddedTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()
        ensure_notification_scheme(self.project)
        self.req = _user("req", role="requestor")
        self.colleague = _user("colleague", role="requestor")
        self.root = User.objects.create_superuser("root", email="root@example.com", password="x")
        self.ticket = _make_ticket(self.project, self.req)

    def _add(self, user, actor):
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.add_watcher(ticket=self.ticket, user=user, actor=actor)

    def test_added_watcher_is_told(self):
        self._add(self.colleague, self.req)
        self.assertEqual(_inapp("WatcherAdded", self.ticket), {"colleague"})
        self.assertEqual(_emails("WatcherAdded", self.ticket), {"colleague"})
        from apps.itsm_core.models import AuditEvent
        self.assertTrue(AuditEvent.objects.filter(ticket=self.ticket, action="watcher_added").exists())

    def test_self_add_is_silent(self):
        self._add(self.colleague, self.colleague)
        self.assertEqual(_inapp("WatcherAdded", self.ticket), set())

    def test_existing_watcher_not_renotified(self):
        self._add(self.colleague, self.req)
        self._add(self.colleague, self.req)
        self.assertEqual(InAppNotification.objects.filter(event_type="WatcherAdded").count(), 1)

    def test_agent_api_add_after_soft_delete_restores_and_notifies(self):
        w = self._add(self.colleague, self.root)
        w.soft_delete()
        c = APIClient()
        c.force_authenticate(self.root)
        with self.captureOnCommitCallbacks(execute=True):
            resp = c.post("/api/v1/itsm/watchers/",
                          {"ticket": str(self.ticket.id), "user_id": self.colleague.id}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Watcher.all_objects.filter(ticket=self.ticket, user=self.colleague).count(), 1)
        self.assertTrue(Watcher.objects.filter(ticket=self.ticket, user=self.colleague).exists())
        self.assertEqual(InAppNotification.objects.filter(event_type="WatcherAdded").count(), 2)

    def test_agent_self_watch_after_removal_no_500(self):
        w = self._add(self.root, self.root)
        w.soft_delete()
        c = APIClient()
        c.force_authenticate(self.root)
        resp = c.post(f"/api/v1/itsm/tickets/{self.ticket.id}/watch/")
        self.assertEqual(resp.status_code, 201)


class MetadataAndMigrationTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()

    def test_metadata_scopes_added_watcher_chip(self):
        sup = _user("sup", role="supervisor")
        c = APIClient()
        c.force_authenticate(sup)
        resp = c.get("/api/v1/itsm/notification-schemes/metadata/")
        recs = {r["value"]: r for r in resp.data["recipients"]}
        self.assertIn("approvers", recs)
        self.assertEqual(recs["added_watcher"]["events"], ["WatcherAdded"])
        self.assertNotIn("events", recs["watchers"])

    def test_existing_scheme_is_topped_up_once(self):
        scheme = ensure_notification_scheme(self.project)
        scheme.rules.filter(event_type__startswith="Approval").delete()
        scheme.rules.filter(event_type="WatcherAdded").delete()
        ensure_notification_scheme(self.project)
        ensure_notification_scheme(self.project)
        self.assertEqual(scheme.rules.filter(is_deleted=False).count(), len(EVENT_CHOICES))
        self.assertFalse(scheme.rules.get(event_type="ApprovalCancelled").is_active)
        self.assertFalse(scheme.rules.get(event_type="WatcherAdded").email_template.is_system)

    def test_data_migration_adds_rules_idempotently(self):
        from django.apps import apps as django_apps

        mig = importlib.import_module(
            "apps.itsm_notifications.migrations.0004_approval_and_watcher_events")
        scheme = ensure_notification_scheme(self.project)
        scheme.rules.filter(event_type__in=list(mig.NEW_EVENTS)).delete()
        mig.add_events(django_apps, None)
        mig.add_events(django_apps, None)
        for event in mig.NEW_EVENTS:
            self.assertEqual(scheme.rules.filter(event_type=event, is_deleted=False).count(), 1, event)
        rule = scheme.rules.get(event_type="ApprovalRequested")
        self.assertEqual(rule.recipients, ["approvers"])
        self.assertFalse(rule.email_template.is_system)  # project-owned copy
