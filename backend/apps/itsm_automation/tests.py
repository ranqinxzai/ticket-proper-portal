"""Automation rules: trigger matching, conditions, each action, the loop guard,
failure isolation, and the API (validation, permissions, helpdesk scoping)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.itsm_core.models import AuditEvent
from apps.itsm_core.models.fields import FieldDefinition, FieldOption, FieldValue
from apps.itsm_groups.models import Group, GroupMembership
from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_tickets.models import CannedNote, Comment
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Status, Transition
from apps.itsm_workflows.seed import run as seed_workflows
from apps.itsm_workflows.services import engine

from .models import AutomationRule, AutomationRun
from .services import system_user
from .views import AutomationRuleViewSet

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


def _cf(project, key, field_type, options=(), **kw):
    """A project custom field. ``options``: ``(value, parent_value_or_None)`` pairs."""
    fd = FieldDefinition.objects.create(project=project, key=key, name=kw.pop("name", key.title()),
                                        field_type=field_type, **kw)
    by_value = {}
    for i, (value, parent) in enumerate(options):
        by_value[value] = FieldOption.objects.create(
            field=fd, value=value, label=value.upper(), sort_order=i,
            parent=by_value.get(parent), level=2 if parent else 1)
    return fd


class AutomationTestBase(TestCase):
    def setUp(self):
        system_user.reset_cache()
        _seed_min()
        self.inc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.wf = self.inc.default_workflow
        self.group = self.inc.default_group or Group.objects.filter(helpdesk=self.inc.helpdesk).first()
        self.agent = self._agent("ag1")
        self.agent2 = self._agent("ag2")
        self.status = {s.key: s for s in Status.objects.filter(workflow=self.wf)}
        self.assign_tr = Transition.objects.get(workflow=self.wf, name="Assign")

    def _agent(self, username):
        u = User.objects.create_user(username=username, password="x", full_name=username.upper())
        RoleAssignment.objects.create(user=u, role=SystemRole.objects.get(code="agent"))
        GroupMembership.objects.create(group=self.group, user=u)
        return u

    def _ticket(self, **kw):
        with self.captureOnCommitCallbacks(execute=True):
            t = ticket_service.create_ticket(
                project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
                summary="Printer down", priority="p3", user=self.agent,
                assigned_group=self.group, **kw)
        t.refresh_from_db()
        return t

    def _rule(self, *, triggers=None, conditions=None, actions=None, **kw):
        return AutomationRule.objects.create(
            project=self.inc, name=kw.pop("name", "Rule"),
            triggers=triggers if triggers is not None else [
                {"type": "ticket_updated", "config": {"fields": ["assignee"]}}],
            conditions=conditions if conditions is not None else {},
            actions=actions or [], **kw)

    def _assign_rule(self, **kw):
        """The driving use case: assignee set while New → run Assign, keep the agent."""
        return self._rule(
            name="Move to Assigned",
            triggers=[{"type": "ticket_created", "config": {}},
                      {"type": "ticket_updated", "config": {"fields": ["assignee"]}}],
            conditions={"match": "all", "conditions": [
                {"field": "status", "op": "eq", "value": str(self.status["new"].pk)},
                {"field": "assignee", "op": "is_not_empty"}]},
            actions=[{"type": "transition",
                      "config": {"transition_id": str(self.assign_tr.pk), "keep_assignee": True}}],
            **kw)

    def _update(self, ticket, **changes):
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.update_ticket(ticket=ticket, user=self.agent, **changes)
        ticket.refresh_from_db()
        return ticket


class AssignUseCaseTests(AutomationTestBase):
    def test_update_ticket_assignee_moves_new_to_assigned_and_keeps_agent(self):
        self._assign_rule()
        t = self._ticket()
        self.assertEqual(t.status.key, "new")
        t = self._update(t, assignee_id=self.agent2.pk)
        self.assertEqual(t.status.key, "assigned")
        self.assertEqual(t.assignee_id, self.agent2.pk, "round-robin must not replace the pick")
        self.assertIsNotNone(t.assigned_at)
        run = AutomationRun.objects.get(ticket=t)
        self.assertEqual(run.status, "success")
        audit = AuditEvent.objects.filter(ticket=t, action="automation_applied").get()
        self.assertEqual(audit.payload["rule_name"], "Move to Assigned")
        self.assertEqual(audit.actor.username, "automation-bot")

    def test_assign_service_path(self):
        self._assign_rule()
        t = self._ticket()
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.assign(ticket=t, assignee_id=self.agent2.pk, user=self.agent)
        t.refresh_from_db()
        self.assertEqual(t.status.key, "assigned")
        self.assertEqual(t.assignee_id, self.agent2.pk)

    def test_created_with_assignee(self):
        self._assign_rule()
        t = self._ticket(assignee=self.agent2)
        self.assertEqual(t.status.key, "assigned")
        self.assertEqual(t.assignee_id, self.agent2.pk)

    def test_conditions_not_met_does_nothing(self):
        self._assign_rule()
        t = self._ticket(assignee=self.agent)  # → Assigned by the rule
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(t, Transition.objects.get(workflow=self.wf, name="Start Progress"),
                              self.agent)
        runs_before = AutomationRun.objects.count()
        t = self._update(t, assignee_id=self.agent2.pk)
        self.assertEqual(t.status.key, "in_progress")
        self.assertEqual(AutomationRun.objects.count(), runs_before, "no run when conditions fail")

    def test_unrelated_field_change_does_not_fire(self):
        self._assign_rule()
        t = self._ticket()
        self._update(t, priority="p1")
        self.assertFalse(AutomationRun.objects.filter(ticket=t).exists())

    def test_inactive_rule_is_ignored(self):
        self._assign_rule(is_active=False)
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(t.status.key, "new")


class FailureAndGuardTests(AutomationTestBase):
    def test_blocked_transition_records_failure_and_leaves_ticket(self):
        self.assign_tr.field_conditions = [
            {"field_key": "summary", "operator": "equals", "value": "nope",
             "message": "Summary must be nope"}]
        self.assign_tr.save(update_fields=["field_conditions"])
        self._assign_rule()
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(t.status.key, "new")
        run = AutomationRun.objects.get(ticket=t)
        self.assertEqual(run.status, "failed")
        self.assertIn("Summary must be nope", run.message)
        self.assertEqual(AutomationRule.objects.get().failure_count, 1)

    def test_failure_rolls_back_earlier_actions_of_the_same_rule(self):
        self._rule(actions=[
            {"type": "set_field", "config": {"field": "priority", "value": "p1"}},
            {"type": "transition", "config": {"transition_id": str(self.assign_tr.pk)}},
        ])
        self.assign_tr.field_conditions = [
            {"field_key": "summary", "operator": "equals", "value": "nope", "message": "blocked"}]
        self.assign_tr.save(update_fields=["field_conditions"])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(t.priority, "p3", "the rule's earlier action is rolled back")

    def test_bot_writes_do_not_trigger_rules(self):
        # Rule A sets priority whenever the assignee changes; rule B watches priority.
        self._rule(name="A", actions=[{"type": "set_field", "config": {"field": "priority", "value": "p1"}}])
        self._rule(name="B", triggers=[{"type": "ticket_updated", "config": {"fields": ["priority"]}}],
                   actions=[{"type": "add_comment",
                             "config": {"body_html": "<p>loop</p>", "visibility": "private"}}])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(t.priority, "p1")
        self.assertFalse(AutomationRun.objects.filter(rule__name="B").exists())

    def test_stop_processing(self):
        self._rule(name="first", order=1, stop_processing=True,
                   actions=[{"type": "set_field", "config": {"field": "priority", "value": "p2"}}])
        self._rule(name="second", order=2,
                   actions=[{"type": "set_field", "config": {"field": "priority", "value": "p1"}}])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(t.priority, "p2")
        self.assertFalse(AutomationRun.objects.filter(rule__name="second").exists())

    def test_wrong_from_status_is_skipped_not_failed(self):
        self._rule(actions=[{"type": "transition",
                             "config": {"transition_id": str(Transition.objects.get(
                                 workflow=self.wf, name="Resolve").pk)}}])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertEqual(AutomationRun.objects.get(ticket=t).status, "skipped")


class ActionTests(AutomationTestBase):
    def test_status_changed_trigger_with_to_status_filter(self):
        self._rule(triggers=[{"type": "status_changed",
                              "config": {"to_status_ids": [str(self.status["in_progress"].pk)]}}],
                   actions=[{"type": "set_field", "config": {"field": "priority", "value": "p2"}}])
        t = self._ticket(assignee=self.agent)
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(t, self.assign_tr, self.agent)
        t.refresh_from_db()
        self.assertEqual(t.priority, "p3", "Assigned isn't the configured target status")
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(t, Transition.objects.get(workflow=self.wf, name="Start Progress"),
                              self.agent)
        t.refresh_from_db()
        self.assertEqual(t.priority, "p2")

    def test_private_comment_from_canned_note(self):
        note = CannedNote.objects.create(title="Ack", body_html="<p>We are on it</p>", is_shared=True)
        self._rule(actions=[{"type": "add_comment",
                             "config": {"canned_note_id": str(note.pk), "visibility": "private"}}])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        c = Comment.objects.get(ticket=t)
        self.assertEqual(c.visibility, "private")
        self.assertIn("We are on it", c.body_html)
        self.assertEqual(c.author.username, "automation-bot")

    def test_public_automated_comment_does_not_count_as_first_response(self):
        self._rule(actions=[{"type": "add_comment",
                             "config": {"body_html": "<p>Thanks</p>", "visibility": "public"}}])
        t = self._update(self._ticket(), assignee_id=self.agent2.pk)
        self.assertTrue(Comment.objects.filter(ticket=t, visibility="public").exists())
        self.assertIsNone(t.first_responded_at)

    def test_set_group_clears_assignee_outside_the_group(self):
        other = Group.objects.create(name="Automation QA", key="automation-qa", helpdesk=self.inc.helpdesk)
        self._rule(triggers=[{"type": "ticket_updated", "config": {"fields": ["priority"]}}],
                   actions=[{"type": "set_field",
                             "config": {"field": "assigned_group", "value": str(other.pk)}}])
        t = self._update(self._ticket(assignee=self.agent), priority="p1")
        self.assertEqual(t.assigned_group_id, other.pk)
        self.assertIsNone(t.assignee_id)


class SetAnyFieldTests(AutomationTestBase):
    """2026-10-31 (GridCrest): Set field covers every ticket-detail field, not only
    Priority / Assignee / Group / Impact / Urgency and single-value custom fields."""

    def _on_create(self, *actions):
        self._rule(triggers=[{"type": "ticket_created", "config": {}}],
                   actions=[{"type": "set_field", "config": {"field": f, "value": v}} for f, v in actions])

    def test_itil_columns(self):
        self._on_create(("users_affected", "25"), ("resolution_code", "workaround"),
                        ("major_incident", True), ("service_downtime", False),
                        ("root_cause", "Loose cable"))
        t = self._ticket()
        self.assertEqual(AutomationRun.objects.get(ticket=t).status, "success",
                         AutomationRun.objects.get(ticket=t).message)
        self.assertEqual(t.users_affected, 25)
        self.assertEqual(t.resolution_code, "workaround")
        self.assertTrue(t.major_incident)
        self.assertIs(t.service_downtime, False)
        self.assertEqual(t.root_cause, "Loose cable")
        self.assertTrue(AuditEvent.objects.filter(ticket=t, action="automation_applied").exists())

    def test_bad_column_value_fails_the_run(self):
        # A stored rule can't be saved like this through the API; the runner still guards.
        self._on_create(("users_affected", "-3"))
        t = self._ticket()
        run = AutomationRun.objects.get(ticket=t)
        self.assertEqual(run.status, "failed")
        self.assertIsNone(t.users_affected)

    def test_impact_still_rederives_priority(self):
        from apps.itsm_tickets.services.priority import compute_priority

        self._on_create(("impact", "critical"), ("urgency", "high"))
        t = self._ticket()
        self.assertEqual(t.priority, compute_priority(self.inc, "critical", "high") or "p3")

    def test_multiselect_cascade_and_group_fields(self):
        _cf(self.inc, "tags", "multiselect", options=[("a", None), ("b", None)])
        _cf(self.inc, "area", "cascade", options=[("hw", None), ("laptop", "hw"), ("sw", None)],
            config={"levels": ["Area", "Item"]})
        _cf(self.inc, "team", "group_picker")
        self._on_create(("cf:tags", ["a", "b"]), ("cf:area", ["hw", "laptop"]),
                        ("cf:team", str(self.group.pk)))
        t = self._ticket()
        self.assertEqual(AutomationRun.objects.get(ticket=t).status, "success")
        values = {v.field.key: v.value_json for v in FieldValue.objects.filter(ticket=t).select_related("field")}
        self.assertEqual(values["tags"], ["a", "b"])
        self.assertEqual(values["area"], ["hw", "laptop"])
        self.assertEqual(values["team"], [str(self.group.pk)])


class ApiTests(AutomationTestBase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser(username="root", password="x", email="r@x.io")

    def _call(self, method, user, data=None, pk=None, action=None):
        factory = APIRequestFactory()
        url = "/automation-rules/"
        req = getattr(factory, method)(url, data or {}, format="json") if method != "get" \
            else factory.get(url, data or {})
        force_authenticate(req, user=user)
        mapping = {"get": "list" if pk is None else "retrieve", "post": "create",
                   "patch": "partial_update", "delete": "destroy"}
        if action:
            mapping = {"get": action}
        view = AutomationRuleViewSet.as_view(mapping)
        return view(req, pk=pk) if pk else view(req)

    def _payload(self, **over):
        p = {"project": str(self.inc.pk), "name": "Move to Assigned",
             "triggers": [{"type": "ticket_updated", "config": {"fields": ["assignee"]}}],
             "conditions": {"match": "all", "conditions": [
                 {"field": "status", "op": "eq", "value": str(self.status["new"].pk)}]},
             "actions": [{"type": "transition", "config": {"transition_id": str(self.assign_tr.pk)}}]}
        p.update(over)
        return p

    def test_create_and_list(self):
        resp = self._call("post", self.admin, self._payload())
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data["actions"][0]["config"]["keep_assignee"])
        resp = self._call("get", self.admin, {"project": str(self.inc.pk)})
        self.assertEqual(resp.status_code, 200)

    def test_validation_errors(self):
        bad = [
            self._payload(triggers=[]),
            self._payload(triggers=[{"type": "nope"}]),
            self._payload(triggers=[{"type": "ticket_updated", "config": {"fields": ["bogus"]}}]),
            self._payload(actions=[]),
            self._payload(actions=[{"type": "transition", "config": {"transition_id": "x"}}]),
            self._payload(actions=[{"type": "set_field", "config": {"field": "priority", "value": "p9"}}]),
            self._payload(actions=[{"type": "add_comment", "config": {"body_html": "  "}}]),
            self._payload(conditions={"conditions": [{"field": "status", "op": "bogus"}]}),
            self._payload(conditions={"conditions": [{"field": "assignee", "op": "eq", "value": "me"}]}),
        ]
        for p in bad:
            self.assertEqual(self._call("post", self.admin, p).status_code, 400, p)

    def test_create_transition_rejected(self):
        create_tr = Transition.objects.filter(workflow=self.wf, from_status__isnull=True,
                                              is_global=False).first()
        p = self._payload(actions=[{"type": "transition",
                                    "config": {"transition_id": str(create_tr.pk)}}])
        self.assertEqual(self._call("post", self.admin, p).status_code, 400)

    def test_agent_cannot_write(self):
        resp = self._call("post", self.agent, self._payload())
        self.assertEqual(resp.status_code, 403)

    def test_catalog(self):
        resp = self._call("get", self.admin, {"project": str(self.inc.pk)}, action="catalog")
        self.assertEqual(resp.status_code, 200)
        keys = {f["key"] for f in resp.data["set_fields"]}
        self.assertTrue({"priority", "assignee", "assigned_group"} <= keys)
        self.assertIn("assignee", {f["key"] for f in resp.data["update_fields"]})
        watch = [f["key"] for f in resp.data["update_fields"]]
        self.assertEqual(len(watch), len(set(watch)), "no duplicate watchable fields")
        self.assertNotIn("description_html", watch, "the built-in Description covers it")

    def test_catalog_lists_every_ticket_detail_field(self):
        _cf(self.inc, "tags", "multiselect", options=[("a", None)])
        _cf(self.inc, "area", "cascade", options=[("hw", None), ("laptop", "hw")],
            config={"levels": ["Area", "Item"]})
        _cf(self.inc, "team", "group_picker")
        resp = self._call("get", self.admin, {"project": str(self.inc.pk)}, action="catalog")
        settable = {f["key"]: f for f in resp.data["set_fields"]}
        itil = {"impact", "urgency", "users_affected", "business_impact", "root_cause",
                "resolution_code", "resolution_notes", "service_downtime",
                "workaround_provided", "major_incident"}
        self.assertTrue(itil <= set(settable), itil - set(settable))
        self.assertEqual(settable["users_affected"]["field_type"], "number")
        self.assertEqual(settable["users_affected"]["filter_key"], "cf:users_affected")
        self.assertTrue({"cf:tags", "cf:area", "cf:team"} <= set(settable))
        cascade = settable["cf:area"]["cascade"]
        self.assertEqual(cascade["levels"], ["Area", "Item"])
        hw = next(o for o in cascade["options"] if o["value"] == "hw")
        laptop = next(o for o in cascade["options"] if o["value"] == "laptop")
        self.assertIsNone(hw["parent"])
        self.assertEqual(laptop["parent"], hw["id"])
        for excluded in ("summary", "description", "requestor"):
            self.assertNotIn(excluded, settable)

    def test_set_field_values_are_validated_and_normalised(self):
        _cf(self.inc, "tags", "multiselect", options=[("a", None), ("b", None)])
        _cf(self.inc, "area", "cascade", options=[("hw", None), ("laptop", "hw"), ("sw", None)])
        _cf(self.inc, "team", "group_picker")

        def act(field, value):
            return self._payload(actions=[{"type": "set_field", "config": {"field": field, "value": value}}])

        for field, value in [("users_affected", "-1"), ("users_affected", "lots"),
                             ("resolution_code", "bogus"), ("resolution_code", ["fixed"]),
                             ("cf:tags", ["zzz"]), ("cf:tags", []),
                             ("cf:area", ["laptop"]), ("cf:area", ["sw", "laptop"]), ("cf:area", []),
                             ("cf:team", "not-a-uuid")]:
            self.assertEqual(self._call("post", self.admin, act(field, value)).status_code, 400,
                             (field, value))
        for field, value, stored in [("users_affected", "25", 25), ("major_incident", "true", True),
                                     ("resolution_code", "fixed", "fixed"),
                                     ("cf:tags", ["b", "a", "b"], ["b", "a"]),
                                     ("cf:area", ["hw", "laptop"], ["hw", "laptop"]),
                                     ("cf:team", [str(self.group.pk)], str(self.group.pk))]:
            resp = self._call("post", self.admin, act(field, value))
            self.assertEqual(resp.status_code, 201, (field, resp.data))
            self.assertEqual(resp.data["actions"][0]["config"]["value"], stored, field)

    def test_helpdesk_scoping_hides_other_helpdesks_rules(self):
        rule = self._assign_rule()
        outsider = User.objects.create_user(username="out", password="x")
        RoleAssignment.objects.create(user=outsider, role=SystemRole.objects.get(code="supervisor"))
        resp = self._call("get", outsider, pk=str(rule.pk))
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(self._call("post", outsider, self._payload()).status_code, 403)


class ViewResponseTests(TransactionTestCase):
    """Real commits (no TestCase wrapper), so on_commit automation runs inside the
    request, the same way it does in production."""

    def setUp(self):
        AutomationTestBase.setUp(self)

    _agent = AutomationTestBase._agent
    _assign_rule = AutomationTestBase._assign_rule
    _rule = AutomationTestBase._rule

    def test_patch_response_reflects_automation(self):
        from apps.itsm_tickets.views import TicketViewSet

        self._assign_rule()
        t = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="Printer down", user=self.agent, assigned_group=self.group)
        admin = User.objects.create_superuser(username="root", password="x", email="r@x.io")
        req = APIRequestFactory().patch(f"/tickets/{t.pk}/", {"assignee": self.agent2.pk},
                                        format="json")
        force_authenticate(req, user=admin)
        resp = TicketViewSet.as_view({"patch": "partial_update"})(req, pk=str(t.pk))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(str(resp.data["status"]), str(self.status["assigned"].pk))
