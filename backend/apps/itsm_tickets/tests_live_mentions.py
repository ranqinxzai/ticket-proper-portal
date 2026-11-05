"""WS9 (2026-10-18): per-ticket live pulse, the interactive stale-write guard (409),
@mention extraction + scoping, and the canned-picker ``for_helpdesk`` filter."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_helpdesks.models import HelpdeskMembership
from apps.itsm_projects.models import Project, ProjectMembership
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac

from .models import CannedNote, Comment, MentionRecord, Ticket
from .services import ticket_service

User = get_user_model()


def _seed_min():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    from apps.itsm_workflows.seed import run as seed_workflows
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


def _project(helpdesk_key, project_type):
    return Project.objects.get(helpdesk__key=helpdesk_key, project_type=project_type)


class _Base(TestCase):
    def setUp(self):
        cache.clear()  # check_permission caches per (role, module, action)
        _seed_min()
        self.proj = _project("IT", "incident")
        self.hr = _project("HR", "incident")
        self.admin = User.objects.create_superuser(username="root9", password="x",
                                                   full_name="Root Admin")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _user(self, username, role="agent", project=None, member=True, **kw):
        u = User.objects.create_user(username=username, password="x",
                                     full_name=kw.pop("full_name", username.title()), **kw)
        if role:
            RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code=role))
        proj = project or self.proj
        if member:
            HelpdeskMembership.objects.create(helpdesk_id=proj.helpdesk_id, user=u)
            ProjectMembership.objects.create(project=proj, user=u)
        return u

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def _mk(self, project=None, **kw):
        proj = project or self.proj
        with self.captureOnCommitCallbacks(execute=True):
            t = ticket_service.create_ticket(
                project=proj, ticket_type=proj.ticket_types.first(),
                summary=kw.pop("summary", "T"), priority=kw.pop("priority", "p3"),
                apply_routing=False, **kw)
        t.refresh_from_db()
        return t


class TicketLivePulseTests(_Base):
    def _pulse(self, t, client=None):
        return (client or self.client).get(reverse("itsm-ticket-live-pulse", args=[t.ticket_number]))

    def test_pulse_shape_for_member_agent(self):
        agent = self._user("ag")
        t = self._mk()
        r = self._pulse(t, self._client(agent))
        self.assertEqual(r.status_code, 200, r.data)
        for key in ("version", "updated_at", "comment_count", "attachment_count",
                    "last_event_id", "last_actor"):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["comment_count"], 0)

    def test_pulse_is_helpdesk_scoped(self):
        hr_agent = self._user("hrag", project=self.hr)
        t = self._mk()  # IT ticket
        self.assertEqual(self._pulse(t, self._client(hr_agent)).status_code, 404)

    def test_version_changes_on_patch_comment_and_set_fields(self):
        t = self._mk()
        v0 = self._pulse(t).data["version"]
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(reverse("itsm-ticket-detail", args=[t.ticket_number]),
                              {"priority": "p1"}, format="json")
        r1 = self._pulse(t)
        self.assertNotEqual(v0, r1.data["version"])
        self.assertEqual(r1.data["last_actor"]["name"], "Root Admin")
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("itsm-ticket-comments", args=[t.ticket_number]),
                             {"body_html": "<p>hi</p>"}, format="json")
        r2 = self._pulse(t)
        self.assertEqual(r2.data["comment_count"], 1)
        self.assertNotEqual(r1.data["version"], r2.data["version"])

    def test_private_note_not_counted_without_permission(self):
        t = self._mk()
        ticket_service.add_comment(ticket=t, author=self.admin, body_html="<p>x</p>",
                                   visibility="private")
        self.assertEqual(self._pulse(t).data["comment_count"], 1)  # superuser sees it
        agent = self._user("noprv")
        from apps.itsm_rbac.models import Module, RoleModulePermission
        RoleModulePermission.objects.filter(
            role__code="agent", module__code="itsm.tickets.comments_private"
        ).update(can_read=False)
        self.assertTrue(Module.objects.filter(code="itsm.tickets.comments_private").exists())
        cache.clear()
        self.assertEqual(self._pulse(t, self._client(agent)).data["comment_count"], 0)


class StaleWriteGuardTests(_Base):
    def _patch(self, t, body):
        return self.client.patch(reverse("itsm-ticket-detail", args=[t.ticket_number]),
                                 body, format="json")

    def _set_fields(self, t, body):
        return self.client.post(reverse("itsm-ticket-set-fields", args=[t.ticket_number]),
                                body, format="json")

    def _seen(self, t):
        return self.client.get(reverse("itsm-ticket-detail", args=[t.ticket_number])).data["updated_at"]

    def test_fresh_token_saves(self):
        t = self._mk()
        r = self._patch(t, {"priority": "p2", "expected_updated_at": self._seen(t)})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["priority"], "p2")

    def test_stale_token_is_409_and_row_unchanged(self):
        t = self._mk()
        seen = self._seen(t)
        # Someone else saves first (pushes updated_at forward).
        Ticket.objects.filter(pk=t.pk).update(summary="Other edit",
                                              updated_at=t.updated_at + timedelta(seconds=5))
        r = self._patch(t, {"summary": "Mine", "expected_updated_at": seen})
        self.assertEqual(r.status_code, 409, r.data)
        self.assertEqual(r.data["code"], "stale_write")
        self.assertIn("changed", r.data["detail"])
        t.refresh_from_db()
        self.assertEqual(t.summary, "Other edit")

    def test_without_token_is_backward_compatible(self):
        t = self._mk()
        Ticket.objects.filter(pk=t.pk).update(updated_at=t.updated_at + timedelta(seconds=5))
        self.assertEqual(self._patch(t, {"priority": "p1"}).status_code, 200)

    def test_invalid_token_is_400(self):
        t = self._mk()
        r = self._patch(t, {"priority": "p1", "expected_updated_at": "yesterday-ish"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("expected_updated_at", r.data)

    def _text_field(self):
        from apps.itsm_core.models import FieldDefinition
        return FieldDefinition.objects.create(project=self.proj, key="ws9_note", name="WS9 note",
                                              field_type="text")

    def test_set_fields_guard_and_stamp(self):
        self._text_field()
        t = self._mk()
        seen = self._seen(t)
        r = self._set_fields(t, {"custom_fields": {"ws9_note": "a"}, "expected_updated_at": seen})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertNotEqual(r.data["updated_at"], seen, "set-fields must bump updated_at")
        t.refresh_from_db()
        self.assertEqual(t.updated_by_id, self.admin.pk)
        # A second editor still holding the pre-edit copy is refused.
        r2 = self._set_fields(t, {"custom_fields": {"ws9_note": "b"}, "expected_updated_at": seen})
        self.assertEqual(r2.status_code, 409, r2.data)
        # Unchanged value ⇒ no stamp (no spurious conflicts for others).
        fresh = r.data["updated_at"]
        r3 = self._set_fields(t, {"custom_fields": {"ws9_note": "a"}, "expected_updated_at": fresh})
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.data["updated_at"], fresh)

    def test_system_and_automation_writes_never_guarded(self):
        from apps.itsm_automation.services.system_user import get_automation_bot, reset_cache
        reset_cache()
        t = self._mk()
        seen = self._seen(t)
        # Automation (service call, no token) and an email-style comment both succeed…
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.update_ticket(ticket=t, user=get_automation_bot(), priority="p1")
            ticket_service.add_comment(ticket=t, author=None, body_html="<p>from email</p>")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p1")
        # …and the interactive client holding the old copy is then told about it.
        self.assertEqual(self._patch(t, {"priority": "p4", "expected_updated_at": seen}).status_code, 409)

    def test_comment_by_someone_else_does_not_conflict(self):
        t = self._mk()
        seen = self._seen(t)
        ticket_service.add_comment(ticket=t, author=self.admin, body_html="<p>c</p>")
        self.assertEqual(self._patch(t, {"priority": "p2", "expected_updated_at": seen}).status_code, 200)


class StaleWriteAutomationTests(TransactionTestCase):
    """Real commits: on_commit automation runs inside the PATCH (no ATOMIC_REQUESTS),
    so the response must carry the post-automation updated_at — otherwise the agent's
    very next edit would be a false 409 (BUG_LOG 2026-10-18 automation gotcha)."""

    def setUp(self):
        from apps.itsm_automation.services import system_user
        from apps.itsm_groups.models import GroupMembership
        from apps.itsm_workflows.models import Status, Transition

        system_user.reset_cache()
        cache.clear()
        _seed_min()
        self.inc = _project("IT", "incident")
        self.group = self.inc.default_group
        self.agent = User.objects.create_user(username="ag2", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        GroupMembership.objects.create(group=self.group, user=self.agent)
        wf = self.inc.default_workflow
        self.status = {s.key: s for s in Status.objects.filter(workflow=wf)}
        assign_tr = Transition.objects.get(workflow=wf, name="Assign")
        from apps.itsm_automation.models import AutomationRule
        AutomationRule.objects.create(
            project=self.inc, name="Move to Assigned",
            triggers=[{"type": "ticket_updated", "config": {"fields": ["assignee"]}}],
            conditions={"match": "all", "conditions": [
                {"field": "status", "op": "eq", "value": str(self.status["new"].pk)},
                {"field": "assignee", "op": "is_not_empty"}]},
            actions=[{"type": "transition",
                      "config": {"transition_id": str(assign_tr.pk), "keep_assignee": True}}])
        self.admin = User.objects.create_superuser(username="rootx", password="x", email="r@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_follow_up_edit_after_automation_is_not_a_false_conflict(self):
        t = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.first(), summary="S",
            user=self.agent, assigned_group=self.group, apply_routing=False)
        url = reverse("itsm-ticket-detail", args=[t.ticket_number])
        seen = self.client.get(url).data["updated_at"]
        r = self.client.patch(url, {"assignee": self.agent.pk, "expected_updated_at": seen},
                              format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(str(r.data["status"]), str(self.status["assigned"].pk))
        t.refresh_from_db()
        from rest_framework import serializers as s
        self.assertEqual(r.data["updated_at"], s.DateTimeField().to_representation(t.updated_at))
        r2 = self.client.patch(url, {"priority": "p2", "expected_updated_at": r.data["updated_at"]},
                               format="json")
        self.assertEqual(r2.status_code, 200, r2.data)


def _mention(user):
    return (f'<span data-type="mention" class="mention" data-id="{user.pk}" '
            f'data-label="{user.full_name}">@{user.full_name}</span>')


class MentionTests(_Base):
    def setUp(self):
        super().setUp()
        from apps.itsm_notifications.seed import run as seed_notifications
        seed_notifications()
        self.author = self._user("author")
        self.colleague = self._user("colleague", full_name="Priya Raman")
        self.c = self._client(self.author)
        self.t = self._mk()

    def _post(self, body, **extra):
        with self.captureOnCommitCallbacks(execute=True):
            return self.c.post(reverse("itsm-ticket-comments", args=[self.t.ticket_number]),
                               {"body_html": body, **extra}, format="json")

    def test_body_mention_records_and_notifies(self):
        from apps.itsm_notifications.models import InAppNotification
        r = self._post(f"<p>Hey {_mention(self.colleague)} can you look?</p>")
        self.assertEqual(r.status_code, 201, r.data)
        c = Comment.objects.get(pk=r.data["id"])
        self.assertEqual(list(c.mentions.values_list("mentioned_user_id", flat=True)),
                         [self.colleague.pk])
        self.assertIn('data-type="mention"', c.body_html)
        self.assertTrue(InAppNotification.objects.filter(
            recipient=self.colleague, event_type="Mentioned", ticket=self.t).exists())

    def test_explicit_and_body_ids_deduplicated(self):
        r = self._post(f"<p>{_mention(self.colleague)}</p>", mention_user_ids=[self.colleague.pk])
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(MentionRecord.objects.filter(comment_id=r.data["id"]).count(), 1)

    def test_public_comment_mention_allowed(self):
        r = self._post(f"<p>{_mention(self.colleague)}</p>", visibility="public")
        self.assertEqual(r.status_code, 201)

    def _assert_rejected(self, user):
        before = Comment.objects.count()
        r = self._post(f"<p>{_mention(user)}</p>")
        self.assertEqual(r.status_code, 403, r.data)
        self.assertIn(str(user.pk), r.data["invalid_mention_ids"])
        self.assertEqual(Comment.objects.count(), before, "no comment on a rejected mention")

    def test_other_helpdesk_agent_rejected(self):
        self._assert_rejected(self._user("hrmate", project=self.hr))

    def test_requestor_rejected(self):
        req = self._user("req", role="requestor", member=False)
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=req)  # legacy row
        self._assert_rejected(req)

    def test_inactive_membership_and_inactive_user_rejected(self):
        u1 = self._user("left")
        HelpdeskMembership.objects.filter(user=u1).update(is_active=False)
        self._assert_rejected(u1)
        u2 = self._user("gone")
        User.objects.filter(pk=u2.pk).update(is_active=False)
        self._assert_rejected(u2)

    def test_garbage_id_is_403_not_500(self):
        r = self._post("<p>x</p>", mention_user_ids=["not-a-user"])
        self.assertEqual(r.status_code, 403)

    def test_service_never_extracts_from_body(self):
        """Inbound email HTML goes straight to add_comment — forged spans can't notify."""
        c = ticket_service.add_comment(ticket=self.t, author=None,
                                       body_html=f"<p>{_mention(self.colleague)}</p>")
        self.assertEqual(c.mentions.count(), 0)

    def test_mention_ids_in_parses_sanitised_body(self):
        self.assertEqual(ticket_service.mention_ids_in(
            f'{_mention(self.colleague)} {_mention(self.colleague)} <span data-id="9">x</span>'),
            [str(self.colleague.pk)])
        self.assertEqual(ticket_service.mention_ids_in(""), [])

    def test_mentionable_lists_agent_members_only(self):
        self._user("hrmate2", project=self.hr)
        req = self._user("req2", role="requestor", member=False)
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=req)
        url = reverse("itsm-ticket-mentionable", args=[self.t.ticket_number])
        r = self.c.get(url)
        self.assertEqual(r.status_code, 200)
        names = {u["username"] for u in r.data}
        self.assertEqual(names, {"author", "colleague"})
        r2 = self.c.get(url, {"term": "priya"})
        self.assertEqual([u["username"] for u in r2.data], ["colleague"])

    def test_mentionable_cross_helpdesk_404(self):
        hr_agent = self._user("hrag3", project=self.hr)
        r = self._client(hr_agent).get(reverse("itsm-ticket-mentionable",
                                               args=[self.t.ticket_number]))
        self.assertEqual(r.status_code, 404)


class CannedForHelpdeskTests(_Base):
    def test_for_helpdesk_includes_org_wide_and_personal(self):
        agent = self._user("cn")
        other = self._user("cn2")
        it_hd, hr_hd = self.proj.helpdesk, self.hr.helpdesk
        mk = CannedNote.objects.create
        pinned = mk(title="Pinned", scope="workspace", helpdesk=it_hd, is_shared=True)
        org = mk(title="Org", scope="workspace", helpdesk=None, is_shared=True)
        mine = mk(title="Mine", scope="personal", is_shared=False, owner=agent)
        mk(title="Theirs", scope="personal", is_shared=False, owner=other)
        mk(title="HR", scope="workspace", helpdesk=hr_hd, is_shared=True)
        c = self._client(agent)
        r = c.get(reverse("itsm-canned-note-list"), {"for_helpdesk": str(it_hd.id), "page_size": 200})
        self.assertEqual(r.status_code, 200)
        rows = r.data["results"] if isinstance(r.data, dict) else r.data
        titles = {n["title"] for n in rows}
        self.assertTrue({pinned.title, org.title, mine.title} <= titles)
        self.assertNotIn("Theirs", titles)
        self.assertNotIn("HR", titles)
        # The exact ?helpdesk= filter (admin page) is unchanged.
        r2 = c.get(reverse("itsm-canned-note-list"), {"helpdesk": str(it_hd.id), "page_size": 200})
        rows2 = r2.data["results"] if isinstance(r2.data, dict) else r2.data
        self.assertNotIn("Org", {n["title"] for n in rows2})

    def test_invalid_for_helpdesk_ignored(self):
        r = self.client.get(reverse("itsm-canned-note-list"), {"for_helpdesk": "nope"})
        self.assertEqual(r.status_code, 200)


