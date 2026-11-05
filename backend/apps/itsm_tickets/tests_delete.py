"""A deleted ticket is inert (BUG_LOG 2026-10-29: GridCrest REQ14 kept emailing).

`ticket_service.delete_ticket` stops SLA clocks, cancels pending approvals and drops
unsent emails; the sweep, emit, flush, approvals, CSAT, bell, links and inbound-retry
guards cover tickets deleted any other way (or before the fix). The data migration
`itsm_tickets 0013` quiets tickets deleted before the fix."""

from __future__ import annotations

import importlib
from datetime import time, timedelta

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.itsm_approvals.models import ApprovalRequest, ApprovalStage, ApprovalWorkflow
from apps.itsm_approvals.services import engine as approval_engine
from apps.itsm_notifications.models import InAppNotification, NotificationOutbox
from apps.itsm_notifications.seed import ensure_notification_scheme
from apps.itsm_notifications.services import outbox
from apps.itsm_projects.models import Project
from apps.itsm_sla.models import (
    BusinessCalendar,
    BusinessHours,
    EscalationRule,
    SLAMetric,
    SLAPolicy,
    SLATarget,
    SLATracker,
)
from apps.itsm_sla.services import sla_engine

from .models import Ticket
from .services import ticket_service

User = get_user_model()


def _seed():
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_rbac.registry import seed_rbac
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_rbac(); seed_helpdesks(); seed_workflows(); seed_groups(); seed_projects()


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        _seed()

    def setUp(self):
        self.root = User.objects.create_superuser(username="root", password="x", email="root@x.io")
        self.boss = User.objects.create_user(username="boss", password="x", email="boss@x.io")
        self.req_user = User.objects.create_user(username="req", password="x", email="req@x.io",
                                                 manager=self.boss)
        self.project = Project.objects.get(helpdesk__key="IT", project_type="service_request")
        ensure_notification_scheme(self.project)
        # 24/7 calendar + a resolution clock with a 100% "notify" escalation, so a
        # past-due clock on a LIVE ticket would breach and email.
        cal = BusinessCalendar.objects.create(name="24x7", timezone="UTC", is_default=True)
        for d in range(7):
            BusinessHours.objects.create(calendar=cal, weekday=d, start_time=time(0, 0),
                                         end_time=time(23, 59))
        policy = SLAPolicy.objects.create(name="REQ", project=self.project, calendar=cal,
                                          is_default=True, is_active=True)
        self.metric = SLAMetric.objects.create(policy=policy, kind="resolution", name="Resolution")
        SLATarget.objects.create(metric=self.metric, priority="p3", target_minutes=480)
        EscalationRule.objects.create(metric=self.metric, threshold_pct=100, action="notify")

    def ticket(self):
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.create_ticket(
                project=self.project, ticket_type=self.project.ticket_types.first(),
                summary="Need a laptop", priority="p3", user=self.root,
                requestor=self.req_user, apply_routing=False,
            )

    def delete(self, t):
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.delete_ticket(ticket=t, user=self.root)
        t.refresh_from_db()

    def overdue(self, t):
        """Push the ticket's resolution clock past due."""
        SLATracker.all_objects.filter(ticket=t).update(
            due_at=timezone.now() - timedelta(hours=1),
            started_at=timezone.now() - timedelta(hours=10))

    def client_for(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c


class DeleteTicketServiceTests(_Base):
    def test_delete_stops_running_and_paused_clocks(self):
        t = self.ticket()
        tr = SLATracker.objects.get(ticket=t)
        self.assertEqual(tr.state, "running")
        sla_engine._pause_tracker(tr, timezone.now())
        self.delete(t)
        tr.refresh_from_db()
        self.assertTrue(t.is_deleted)
        self.assertEqual(tr.state, "stopped")
        self.assertIsNotNone(tr.stopped_at)
        self.assertIsNone(tr.paused_at)
        self.assertFalse(tr.pauses.filter(resumed_at__isnull=True).exists())

    def test_delete_drops_unsent_email_and_flush_sends_nothing(self):
        t = self.ticket()
        queued = NotificationOutbox.objects.filter(ticket=t, status="queued")
        self.assertTrue(queued.exists())  # TicketCreated mails waiting for the flusher
        self.delete(t)
        self.assertFalse(NotificationOutbox.objects.filter(ticket=t, status="queued").exists())
        self.assertTrue(NotificationOutbox.objects.filter(
            ticket=t, status="dead", last_error=outbox.CANCELLED_TICKET_DELETED).exists())
        mail.outbox = []
        outbox.flush()
        self.assertEqual(mail.outbox, [])

    def test_delete_cancels_pending_approval_silently(self):
        ApprovalStage.objects.create(workflow=self._awf(), level=1, name="Manager",
                                     approver_type="requestor_manager")
        t = self.ticket()
        req = approval_engine.start_approval(t, self._awf())
        NotificationOutbox.objects.all().delete()
        self.delete(t)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        self.assertFalse(NotificationOutbox.objects.filter(ticket=t).exists())  # no ApprovalCancelled

    def test_delete_api_and_bulk_use_the_service(self):
        a, b = self.ticket(), self.ticket()
        c = self.client_for(self.root)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(c.delete(reverse("itsm-ticket-detail", args=[a.id])).status_code, 204)
            r = c.post(reverse("itsm-ticket-bulk"), {"ids": [str(b.id)], "op": "delete"}, format="json")
        self.assertEqual(r.status_code, 200)
        for t in (a, b):
            t.refresh_from_db()
            self.assertTrue(t.is_deleted)
            self.assertEqual(SLATracker.objects.get(ticket=t).state, "stopped")
            self.assertFalse(NotificationOutbox.objects.filter(ticket=t, status="queued").exists())

    def _awf(self):
        awf, _ = ApprovalWorkflow.objects.get_or_create(name="Manager sign-off", project=self.project)
        return awf


class GuardTests(_Base):
    """Tickets deleted WITHOUT the service (old deletes, future code paths)."""

    def bare_delete(self, t):
        Ticket.objects.filter(pk=t.pk).update(is_deleted=True, deleted_at=timezone.now())
        t.refresh_from_db()

    def test_sweep_skips_deleted_ticket(self):
        live, dead = self.ticket(), self.ticket()
        self.overdue(live)
        self.overdue(dead)
        self.bare_delete(dead)
        NotificationOutbox.objects.all().delete()
        with self.captureOnCommitCallbacks(execute=True):
            sla_engine.scan_breaches()
        self.assertTrue(SLATracker.objects.get(ticket=live).breached)  # control
        tr = SLATracker.objects.get(ticket=dead)
        self.assertFalse(tr.breached)
        self.assertFalse(NotificationOutbox.objects.filter(ticket=dead).exists())
        self.assertFalse(dead.activity.filter(action="sla_breached").exists())

    def test_emit_event_on_deleted_ticket_creates_nothing(self):
        from apps.itsm_core.services import hooks
        t = self.ticket()
        self.bare_delete(t)
        NotificationOutbox.objects.all().delete()
        InAppNotification.objects.all().delete()
        hooks.emit_event("SLABreach", t, context={"metric": "resolution"})
        self.assertFalse(NotificationOutbox.objects.filter(ticket=t).exists())
        self.assertFalse(InAppNotification.objects.filter(ticket=t).exists())

    def test_flush_drops_rows_queued_before_a_bare_delete(self):
        t = self.ticket()
        self.assertTrue(NotificationOutbox.objects.filter(ticket=t, status="queued").exists())
        self.bare_delete(t)
        mail.outbox = []
        result = outbox.flush()
        self.assertEqual(mail.outbox, [])
        self.assertGreaterEqual(result["cancelled"], 1)
        self.assertFalse(NotificationOutbox.objects.filter(ticket=t, status="queued").exists())

    def test_approval_inbox_and_decide_hide_deleted_ticket(self):
        ApprovalStage.objects.create(
            workflow=ApprovalWorkflow.objects.create(name="Mgr", project=self.project),
            level=1, name="Manager", approver_type="requestor_manager")
        awf = ApprovalWorkflow.objects.get(name="Mgr")
        t = self.ticket()
        req = approval_engine.start_approval(t, awf)
        self.assertIn(req.id, [r.id for r in approval_engine.pending_for(self.boss)])
        self.bare_delete(t)
        self.assertNotIn(req.id, [r.id for r in approval_engine.pending_for(self.boss)])
        r = self.client_for(self.boss).post(reverse("itsm-approval-request-approve", args=[req.id]))
        self.assertEqual(r.status_code, 404)

    def test_csat_excludes_deleted_ticket(self):
        from apps.itsm_reporting.services import reports
        from apps.itsm_surveys.models import SurveyResponse
        now = timezone.now()
        live, dead = self.ticket(), self.ticket()
        for t in (live, dead):
            SurveyResponse.objects.create(
                ticket=t, project=self.project, requestor=self.req_user, status="submitted",
                rating=5, csat_score=100, is_satisfied=True, sent_at=now, submitted_at=now)
        self.assertEqual(reports.csat_summary(project=self.project.id)["responses"], 2)
        self.bare_delete(dead)
        self.assertEqual(reports.csat_summary(project=self.project.id)["responses"], 1)

    def test_bell_hides_deleted_ticket(self):
        t = self.ticket()
        InAppNotification.objects.all().delete()
        InAppNotification.objects.create(recipient=self.boss, event_type="Assigned", ticket=t, title="x")
        InAppNotification.objects.create(recipient=self.boss, event_type="System", title="no ticket")
        c = self.client_for(self.boss)
        self.assertEqual(c.get(reverse("itsm-notification-unread-count")).data["unread"], 2)
        self.bare_delete(t)
        self.assertEqual(c.get(reverse("itsm-notification-unread-count")).data["unread"], 1)

    def test_linked_issue_to_deleted_ticket_is_hidden(self):
        a, b = self.ticket(), self.ticket()
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.link_tickets(source=a, target=b, link_type="relates_to", user=self.root)
        url = reverse("itsm-ticket-links", args=[str(a.id)])
        c = self.client_for(self.root)
        self.assertIn(b.ticket_number, str(c.get(url).data))
        self.bare_delete(b)
        self.assertNotIn(b.ticket_number, str(c.get(url).data))


class InboundRetryTests(TestCase):
    """A failed inbound row still bound to a since-deleted ticket opens a new ticket
    on retry (user decision 2026-10-29), never a comment on the deleted one."""

    def setUp(self):
        from apps.itsm_email.services import system_user
        from apps.itsm_email.models import EmailChannel
        from apps.itsm_email.services import inbound, parser
        from apps.itsm_email.tests import _raw
        _seed()
        system_user.reset_cache()
        self.inc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.ch = EmailChannel.objects.create(name="C", project=self.inc, address="support@itsm.local",
                                              create_users=True)
        alice = User.objects.create_user(username="alice", email="alice@corp.com", password="x")
        self.seed = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Seed", message_id="<seed@x>")),
            sender=alice, bot=system_user.get_email_bot())
        self.parsed = parser.parse(_raw(subject=f"Re: [{self.seed.ticket_number}] again",
                                        message_id="<r1@x>"))

    def test_retry_after_delete_opens_new_ticket(self):
        from apps.itsm_email.models import InboundEmail
        from apps.itsm_email.services import inbound
        InboundEmail.objects.create(channel=self.ch, message_id=self.parsed.message_id,
                                    **{**inbound._row_defaults(self.parsed), "status": "failed"},
                                    ticket=self.seed)
        Ticket.objects.filter(pk=self.seed.pk).update(is_deleted=True)
        with self.captureOnCommitCallbacks(execute=True):
            row = inbound.process_inbound(self.ch, self.parsed)
        self.assertEqual(row.status, "processed")
        self.assertEqual(row.action_taken, "created_ticket")
        self.assertNotEqual(row.ticket_id, self.seed.pk)
        self.assertFalse(Ticket.all_objects.get(pk=self.seed.pk).comments.exists())


class QuiesceMigrationTests(_Base):
    """itsm_tickets 0013 quiets tickets deleted before delete_ticket existed."""

    def test_migration_quiets_old_deletes_only(self):
        mig = importlib.import_module("apps.itsm_tickets.migrations.0013_quiesce_deleted_tickets")
        ApprovalStage.objects.create(
            workflow=ApprovalWorkflow.objects.create(name="Mgr", project=self.project),
            level=1, name="Manager", approver_type="requestor_manager")
        awf = ApprovalWorkflow.objects.get(name="Mgr")
        live, dead = self.ticket(), self.ticket()
        live_req = approval_engine.start_approval(live, awf)
        dead_req = approval_engine.start_approval(dead, awf)
        Ticket.objects.filter(pk=dead.pk).update(is_deleted=True)  # old-style bare delete

        mig.quiesce_deleted_tickets(django_apps, None)

        self.assertEqual(SLATracker.objects.get(ticket=dead).state, "stopped")
        self.assertEqual(SLATracker.objects.get(ticket=live).state, "running")
        dead_req.refresh_from_db(); live_req.refresh_from_db()
        self.assertEqual(dead_req.status, "cancelled")
        self.assertEqual(live_req.status, "pending")
        self.assertFalse(NotificationOutbox.objects.filter(ticket=dead, status="queued").exists())
        self.assertTrue(NotificationOutbox.objects.filter(ticket=live, status="queued").exists())
        # Idempotent.
        mig.quiesce_deleted_tickets(django_apps, None)
