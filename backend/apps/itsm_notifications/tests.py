"""Per-project notification provisioning, channel/recipient validation, the
metadata/for-project endpoints, and the WhatsApp groundwork no-op."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole

from .models import EmailTemplate, NotificationOutbox, NotificationScheme
from .seed import ensure_notification_scheme
from .seed import run as seed_notifications
from .serializers import NotificationRuleSerializer
from .services import bus
from .views import NotificationSchemeViewSet

User = get_user_model()


def _seed_min():
    from apps.itsm_groups.seed import run as seed_groups
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    from apps.itsm_projects.seed import run as seed_projects
    from apps.itsm_rbac.registry import seed_rbac
    from apps.itsm_workflows.seed import run as seed_workflows

    seed_rbac()
    seed_helpdesks()
    seed_workflows()
    seed_groups()
    seed_projects()


def _project(helpdesk_key="IT", project_type="incident"):
    return Project.objects.get(helpdesk__key=helpdesk_key, project_type=project_type)


def _make_ticket(project, requestor):
    from apps.itsm_tickets.services import ticket_service

    return ticket_service.create_ticket(
        project=project, ticket_type=project.ticket_types.first(),
        summary="Printer on 3rd floor not working", requestor=requestor,
    )


class EnsureSchemeTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()

    def test_provisions_full_event_matrix(self):
        scheme = ensure_notification_scheme(self.project)
        self.assertEqual(scheme.project_id, self.project.id)
        self.assertFalse(scheme.is_default)
        self.assertEqual(scheme.rules.count(), 11)  # every EVENT_CHOICES entry

    def test_idempotent(self):
        s1 = ensure_notification_scheme(self.project)
        rules = s1.rules.count()
        owned = EmailTemplate.objects.filter(is_system=False).count()
        s2 = ensure_notification_scheme(self.project)
        self.assertEqual(s1.id, s2.id)
        self.assertEqual(s1.rules.count(), rules)
        self.assertEqual(EmailTemplate.objects.filter(is_system=False).count(), owned)

    def test_cloned_templates_are_project_owned_and_isolated(self):
        other = _project("IT", "service_request")
        sa = ensure_notification_scheme(self.project)
        sb = ensure_notification_scheme(other)
        rule_a = sa.rules.get(event_type="CommentAdded")
        rule_b = sb.rules.get(event_type="CommentAdded")
        self.assertIsNotNone(rule_a.email_template)
        self.assertFalse(rule_a.email_template.is_system)
        self.assertNotEqual(rule_a.email_template_id, rule_b.email_template_id)
        # Editing project A's template must not affect project B's clone.
        rule_a.email_template.subject_template = "CHANGED-A"
        rule_a.email_template.save()
        rule_b.email_template.refresh_from_db()
        self.assertNotEqual(rule_b.email_template.subject_template, "CHANGED-A")


class SchemeResolutionTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()
        self.req = User.objects.create_user("req", email="req@example.com", password="x")

    def test_scheme_for_prefers_project_scheme(self):
        ticket = _make_ticket(self.project, self.req)
        scheme = ensure_notification_scheme(self.project)
        self.assertEqual(bus._scheme_for(ticket).id, scheme.id)

    def test_falls_back_to_default_when_no_project_scheme(self):
        seed_notifications()  # global default scheme only
        other = _project("IT", "service_request")
        ticket = _make_ticket(other, self.req)
        scheme = bus._scheme_for(ticket)
        self.assertIsNotNone(scheme)
        self.assertTrue(scheme.is_default)


class EmitTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()
        self.scheme = ensure_notification_scheme(self.project)
        self.req = User.objects.create_user("req", email="req@example.com", password="x")
        self.actor = User.objects.create_user("act", email="act@example.com", password="x")
        self.ticket = _make_ticket(self.project, self.req)

    def test_active_email_rule_enqueues_outbox(self):
        rule = self.scheme.rules.get(event_type="CommentAdded")
        self.assertIn("requestor", rule.recipients)
        self.assertIn("email", rule.channels)
        bus.emit("CommentAdded", ticket=self.ticket, actor=self.actor)
        self.assertTrue(
            NotificationOutbox.objects.filter(ticket=self.ticket, channel="email").exists()
        )

    def test_disabled_rule_emits_nothing(self):
        self.scheme.rules.filter(event_type="CommentAdded").update(is_active=False)
        bus.emit("CommentAdded", ticket=self.ticket, actor=self.actor)
        self.assertFalse(NotificationOutbox.objects.filter(ticket=self.ticket).exists())

    def test_whatsapp_channel_is_a_safe_noop(self):
        rule = self.scheme.rules.get(event_type="CommentAdded")
        rule.channels = ["whatsapp"]
        rule.recipients = ["requestor"]
        rule.save()
        bus.emit("CommentAdded", ticket=self.ticket, actor=self.actor)  # must not raise
        self.assertFalse(NotificationOutbox.objects.filter(ticket=self.ticket).exists())


class RenderAndDeliveryTests(TestCase):
    """The branded HTML shell, role-aware deep links, and that the HTML body is
    actually rendered, stored on the outbox, and attached to the sent email."""

    def setUp(self):
        _seed_min()
        self.project = _project()
        self.scheme = ensure_notification_scheme(self.project)
        self.req = User.objects.create_user("req", email="req@example.com", password="x")
        self.agent = User.objects.create_user("agent1", email="agent1@example.com", password="x")
        self.ticket = _make_ticket(self.project, self.req)
        self.ticket.assignee = self.agent
        self.ticket.save(update_fields=["assignee"])

    def test_render_wraps_body_in_branded_shell(self):
        from .services import templates

        rule = self.scheme.rules.get(event_type="CommentAdded")
        subject, html, text = templates.render(
            rule.email_template, self.ticket, self.agent, {}, "CommentAdded", recipient=self.agent
        )
        # Subject keeps the [INC-…] threading token used by itsm_email.
        self.assertTrue(subject.startswith(f"[{self.ticket.ticket_number}]"))
        self.assertIn("One Helpdesk", html)   # brand header
        self.assertIn("View ticket", html)    # CTA (agent recipient)
        self.assertIn("<table", html)         # table-based shell layout
        self.assertTrue(text)                 # plain-text mirror present

    def test_agent_email_shows_requester(self):
        from .services import templates

        self.req.full_name = "Riya Sen"
        self.req.save(update_fields=["full_name"])
        rule = self.scheme.rules.get(event_type="TicketCreated")
        _s, html, _t = templates.render(
            rule.email_template, self.ticket, None, {}, "TicketCreated", recipient=self.agent
        )
        self.assertIn(">Requester<", html)
        self.assertIn("Riya Sen (req@example.com)", html)

    def test_requester_row_falls_back_to_email_and_skips_requestor(self):
        from .services import templates

        rule = self.scheme.rules.get(event_type="TicketCreated")
        # No full_name on the requestor → the email alone, not "x (x)".
        _s, html, _t = templates.render(
            rule.email_template, self.ticket, None, {}, "TicketCreated", recipient=self.agent
        )
        self.assertIn(">req@example.com<", html)
        # The requestor's own copy has no Requester row.
        _s, html_req, _t = templates.render(
            rule.email_template, self.ticket, None, {}, "TicketCreated", recipient=self.req
        )
        self.assertNotIn(">Requester<", html_req)

    def test_role_aware_links(self):
        from .services import templates

        # Requestor → self-service portal.
        path_req = templates.build_ticket_path(self.ticket, self.req)
        self.assertIn(f"/portal/requests/{self.ticket.ticket_number}", path_req)
        # Any other recipient (staff) → agent workspace under the project.
        path_agent = templates.build_ticket_path(self.ticket, self.agent)
        self.assertIn("/agent/w/", path_agent)
        self.assertIn(f"/p/{self.project.key}/{self.ticket.ticket_number}", path_agent)

    def test_emit_stores_rendered_html(self):
        bus.emit("CommentAdded", ticket=self.ticket, actor=self.agent)
        row = NotificationOutbox.objects.get(
            ticket=self.ticket, channel="email", event_type="CommentAdded", recipient=self.req
        )
        self.assertIn("One Helpdesk", row.rendered_html)
        # Requestor's email links to the portal, not the agent console.
        self.assertIn("/portal/requests/", row.rendered_html)

    def test_flush_attaches_html_alternative(self):
        from .services import outbox

        bus.emit("CommentAdded", ticket=self.ticket, actor=self.agent)
        result = outbox.flush()
        self.assertGreaterEqual(result["sent"], 1)
        self.assertTrue(mail.outbox)
        msg = mail.outbox[0]
        self.assertTrue(
            any(content_type == "text/html" for _content, content_type in msg.alternatives),
            "sent email is missing its HTML alternative part",
        )


class SerializerValidationTests(TestCase):
    def setUp(self):
        _seed_min()
        self.scheme = ensure_notification_scheme(_project())

    def _data(self, **over):
        base = {"scheme": str(self.scheme.id), "event_type": "CommentAdded",
                "recipients": ["requestor"], "channels": ["email"]}
        base.update(over)
        return base

    def test_rejects_unknown_channel(self):
        s = NotificationRuleSerializer(data=self._data(channels=["email", "carrier_pigeon"]))
        self.assertFalse(s.is_valid())
        self.assertIn("channels", s.errors)

    def test_rejects_unknown_recipient(self):
        s = NotificationRuleSerializer(data=self._data(recipients=["requestor", "the_ceo"]))
        self.assertFalse(s.is_valid())
        self.assertIn("recipients", s.errors)

    def test_allows_whatsapp_channel_forward_compatibly(self):
        s = NotificationRuleSerializer(data=self._data(channels=["in_app", "whatsapp"]))
        self.assertTrue(s.is_valid(), s.errors)


class EndpointTests(TestCase):
    def setUp(self):
        _seed_min()
        self.project = _project()
        self.sup = User.objects.create_user("sup", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.factory = APIRequestFactory()

    def _call(self, action, params=None):
        req = self.factory.get("/", params or {})
        force_authenticate(req, user=self.sup)
        return NotificationSchemeViewSet.as_view({"get": action})(req)

    def test_metadata(self):
        resp = self._call("metadata")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["events"]), 11)
        self.assertEqual(len(resp.data["recipients"]), 6)
        whatsapp = next(c for c in resp.data["channels"] if c["value"] == "whatsapp")
        self.assertFalse(whatsapp["available"])
        self.assertTrue(whatsapp["coming_soon"])

    def test_for_project_provisions_on_first_access(self):
        self.assertFalse(
            NotificationScheme.objects.filter(project=self.project, is_deleted=False).exists()
        )
        resp = self._call("for_project", {"project": str(self.project.id)})
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.data["rules"]), 11)
        self.assertTrue(
            NotificationScheme.objects.filter(project=self.project, is_deleted=False).exists()
        )

    def test_for_project_requires_project_param(self):
        resp = self._call("for_project")
        self.assertEqual(resp.status_code, 400)


class StatusChangeEmissionTests(TestCase):
    """The engine's post-commit emits: done transitions notify as Resolved/Closed
    (one specific email, not a generic StatusChanged too), and every transition is
    a distinct outbox occurrence — the requestor gets email for the 2nd, 3rd, …
    status change and for a re-resolve after reopen (previously all dedupe-dropped)."""

    def setUp(self):
        _seed_min()
        self.project = _project()
        self.scheme = ensure_notification_scheme(self.project)
        self.req = User.objects.create_user("req", email="req@example.com", password="x")
        self.agent = User.objects.create_user("ag", email="ag@example.com", password="x")
        RoleAssignment.objects.create(
            user=self.agent, role=SystemRole.objects.get(code="agent")
        )
        self.ticket = _make_ticket(self.project, self.req)

    def _move(self, name, **kwargs):
        from apps.itsm_workflows.models import Transition
        from apps.itsm_workflows.services import engine

        tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(self.ticket, tr, self.agent, **kwargs)
        self.ticket.refresh_from_db()

    def _requestor_emails(self, event_type):
        return NotificationOutbox.objects.filter(
            ticket=self.ticket, recipient=self.req, channel="email", event_type=event_type
        )

    def test_default_rules_email_status_events_to_requestor(self):
        for event in ("StatusChanged", "Resolved", "Closed"):
            rule = self.scheme.rules.get(event_type=event)
            self.assertIn("requestor", rule.recipients, event)
            self.assertIn("email", rule.channels, event)

    def test_every_status_change_emails_requestor(self):
        self._move("Assign")
        self._move("Start Progress")
        # Two distinct occurrences → two outbox rows (the 2nd used to dedupe away).
        self.assertEqual(self._requestor_emails("StatusChanged").count(), 2)

    def test_resolve_and_close_emit_specific_events_only(self):
        self._move("Assign")
        self._move("Start Progress")
        self._move("Resolve", fields={"resolution": "fixed"}, comment="Replaced toner")
        self._move("Close")
        self.assertEqual(self._requestor_emails("Resolved").count(), 1)
        self.assertEqual(self._requestor_emails("Closed").count(), 1)
        # The done transitions must NOT also send the generic StatusChanged email.
        self.assertEqual(self._requestor_emails("StatusChanged").count(), 2)

    def test_reopen_then_resolve_emails_again(self):
        self._move("Assign")
        self._move("Start Progress")
        self._move("Resolve", fields={"resolution": "fixed"}, comment="Replaced toner")
        self._move("Reopen")   # resolved → in_progress: generic status change
        self._move("Resolve", fields={"resolution": "fixed"}, comment="Fixed for real")
        self.assertEqual(self._requestor_emails("Resolved").count(), 2)
        self.assertEqual(self._requestor_emails("StatusChanged").count(), 3)

    def test_identical_context_still_collapses(self):
        # True duplicates of the SAME occurrence (e.g. an emit_event post-function
        # plus the engine's canonical emit) share a dedupe key → one email.
        ctx = {"from": "New", "to": "Assigned", "changed_at": "2026-07-04T00:00:00"}
        bus.emit("StatusChanged", ticket=self.ticket, actor=self.agent, context=dict(ctx))
        bus.emit("StatusChanged", ticket=self.ticket, actor=self.agent, context=dict(ctx))
        self.assertEqual(self._requestor_emails("StatusChanged").count(), 1)


class ReassignmentEmailTests(TestCase):
    """Assigned emits carry a per-occurrence dedupe context: assigning a ticket
    back to a previous assignee must email them again (previously their first
    Assigned outbox row owned the dedupe key forever)."""

    def setUp(self):
        _seed_min()
        self.project = _project()
        ensure_notification_scheme(self.project)
        self.req = User.objects.create_user("req", email="req@example.com", password="x")
        self.sup = User.objects.create_user("sup", email="sup@example.com", password="x")
        self.alice = User.objects.create_user("alice", email="alice@example.com", password="x")
        self.bob = User.objects.create_user("bob", email="bob@example.com", password="x")
        self.ticket = _make_ticket(self.project, self.req)

    def _assign(self, assignee):
        from apps.itsm_tickets.services import ticket_service

        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.assign(ticket=self.ticket, assignee_id=assignee.id, user=self.sup)
        self.ticket.refresh_from_db()

    def test_reassign_back_emails_again(self):
        self._assign(self.alice)
        self._assign(self.bob)
        self._assign(self.alice)  # back to alice → must be a fresh occurrence
        alice_rows = NotificationOutbox.objects.filter(
            ticket=self.ticket, recipient=self.alice, channel="email", event_type="Assigned"
        )
        self.assertEqual(alice_rows.count(), 2)
