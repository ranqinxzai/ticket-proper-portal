"""WS3 (2026-10-18): workflows & assignment fixes.

B14 create transition · B17a/b/c field conditions + never-overwrite auto-assign · U4
blocked_reason/to_status_name · U6 usage + clone (+ automation re-point, status-filter
lineage) · U1/C5 status delete · C7 set_priority audit · Rejected request status · R3
routing-rule helpdesk clamp · A1 move start status.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_core.models import AuditEvent, FieldDefinition, FieldOption
from apps.itsm_groups.models import Group, GroupAssignmentState, GroupMembership, RoutingRule
from apps.itsm_groups.services import pick_assignee_if_unassigned
from apps.itsm_projects.models import Project
from apps.itsm_tickets.models import Ticket
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Status, Transition, TransitionCondition, Workflow
from apps.itsm_workflows.services import engine
from apps.itsm_workflows.services.cloner import clone_workflow
from apps.itsm_workflows.validators import validate_workflow_graph

from .tests import _seed_all

User = get_user_model()


def _proj(hd, ptype="incident"):
    return Project.objects.get(helpdesk__key=hd, project_type=ptype)


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        _seed_all()  # once per class (seeding is the slow part)
        cls.root = User.objects.create_superuser(username="root", password="x")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.inc = _proj("IT")
        self.hrinc = _proj("HR")
        self.wf = self.inc.default_workflow

    def _ticket(self, project=None, **kw):
        project = project or self.inc
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.create_ticket(
                project=project, ticket_type=project.ticket_types.first(), summary="T",
                user=self.root, apply_routing=False, **kw)

    def _tr(self, name, wf=None):
        return Transition.objects.get(workflow=wf or self.wf, name=name)

    def _run(self, ticket, name, **kw):
        with self.captureOnCommitCallbacks(execute=True):
            return engine.transition(ticket, self._tr(name, ticket.workflow), self.root, **kw)


# ── B14 ─────────────────────────────────────────────────────────────────────

class CreateTransitionTests(_Base):
    def test_seeded_workflow_starts_in_new(self):
        t = self._ticket()
        self.assertEqual(t.status.key, "new")
        self.assertTrue(validate_workflow_graph(self.wf)["valid"])

    def test_start_status_follows_create_transition_target(self):
        create = Transition.objects.get(workflow=self.wf, from_status__isnull=True)
        assigned = Status.objects.get(workflow=self.wf, key="assigned")
        create.to_status = assigned
        create.save()
        t = self._ticket()
        self.assertEqual(t.status_id, assigned.id)
        warnings = validate_workflow_graph(self.wf)["warnings"]
        self.assertTrue(any("start in" in w for w in warnings), warnings)

    def test_create_post_functions_auto_assign_fill_only_and_priority_ignored(self):
        member = User.objects.create_user(username="m1", password="x")
        GroupMembership.objects.create(group=self.inc.default_group, user=member)
        create = Transition.objects.get(workflow=self.wf, from_status__isnull=True)
        create.post_functions = [{"type": "auto_assign", "config": {"strategy": "round_robin"}},
                                 {"type": "set_priority", "config": {"priority": "p1"}}]
        create.save()
        t = self._ticket(priority="p3")
        self.assertEqual(t.assignee_id, member.id)
        self.assertEqual(t.priority, "p3")  # set_priority is skipped at create
        self.assertIsNotNone(t.assigned_at)
        other = User.objects.create_user(username="m2", password="x")
        GroupMembership.objects.create(group=self.inc.default_group, user=other)
        t2 = self._ticket(assignee=self.root)
        self.assertEqual(t2.assignee_id, self.root.id)  # explicit pick wins

    def test_create_transition_starts_approval_in_transaction(self):
        from apps.itsm_approvals.models import ApprovalStage, ApprovalWorkflow
        awf = ApprovalWorkflow.objects.create(name="Create gate", project=self.inc)
        ApprovalStage.objects.create(workflow=awf, name="L1", level=1,
                                     approver_type="specific_user", approver_user=self.root)
        create = Transition.objects.get(workflow=self.wf, from_status__isnull=True)
        create.post_functions = [{"type": "request_approval", "config": {"workflow_id": str(awf.id)}}]
        create.save()
        t = self._ticket()
        self.assertTrue(t.approval_requests.filter(status="pending").exists())

    def test_create_transition_refused_on_existing_ticket(self):
        t = self._ticket()
        self._run(t, "Assign")
        create = Transition.objects.get(workflow=self.wf, from_status__isnull=True)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(t, create, self.root)
        self.assertEqual(ctx.exception.status_code, 400)
        resp = self.client.post(reverse("itsm-ticket-transition", args=[str(t.pk)]),
                                {"transition_id": str(create.id)}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        t.refresh_from_db()
        self.assertEqual(t.status.key, "assigned")

    def test_global_transition_runs_from_any_status(self):
        cancelled = Status.objects.get(workflow=self.wf, key="closed")
        g = Transition.objects.create(workflow=self.wf, name="Cancel", from_status=None,
                                      to_status=cancelled, is_global=True, sort_order=999)
        t = self._ticket()
        self._run(t, "Assign")
        t.refresh_from_db()
        self.assertIn(g.id, [x.id for x in engine.available_transitions(t, self.root)])
        self._run(t, "Cancel")
        t.refresh_from_db()
        self.assertEqual(t.status_id, cancelled.id)
        self.assertTrue(validate_workflow_graph(self.wf)["valid"])

    def test_second_create_transition_rejected_by_api(self):
        resp = self.client.post(reverse("itsm-transition-list"), {
            "workflow": str(self.wf.id), "name": "Dup", "from_status": None,
            "to_status": str(Status.objects.get(workflow=self.wf, key="assigned").id)},
            format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        resp = self.client.post(reverse("itsm-transition-list"), {
            "workflow": str(self.wf.id), "name": "AnyHold", "from_status": None, "is_global": True,
            "to_status": str(Status.objects.get(workflow=self.wf, key="pending").id)},
            format="json")
        self.assertEqual(resp.status_code, 201, resp.content)


# ── B17 ─────────────────────────────────────────────────────────────────────

class FieldConditionApplicabilityTests(_Base):
    def setUp(self):
        super().setUp()
        FieldDefinition.objects.create(project=self.inc, key="userlocation",
                                       name="User Location", field_type="text")
        self.start = self._tr("Start Progress")
        self.start.field_conditions = [{"field_key": "userlocation", "operator": "is_not_empty",
                                        "message": "Location first."}]
        self.start.save()

    def _assigned(self, project):
        t = self._ticket(project)
        self._run(t, "Assign")
        t.refresh_from_db()
        return t

    def test_rule_applies_where_field_exists(self):
        t = self._assigned(self.inc)
        with self.assertRaises(engine.TransitionError):
            engine.transition(t, self.start, self.root)

    def test_rule_skipped_where_project_lacks_field(self):
        self.assertEqual(self.hrinc.default_workflow_id, self.wf.id)  # shared workflow
        t = self._assigned(self.hrinc)
        self.assertIsNone(engine.blocked_reasons(t, [self.start]).get(self.start.id))
        self._run(t, "Start Progress")
        t.refresh_from_db()
        self.assertEqual(t.status.key, "in_progress")

    def test_global_applies_to_excluded_project_type_skipped(self):
        req = _proj("IT", "service_request")
        approve = Transition.objects.get(workflow=req.default_workflow, name="Approve")
        approve.field_conditions = [{"field_key": "impact", "operator": "is_not_empty",
                                     "message": "Impact!"}]
        approve.save()
        t = self._ticket(req)
        self.assertEqual(engine.blocked_reasons(t, [approve]), {})


class CascadeCompletenessTests(_Base):
    def setUp(self):
        super().setUp()
        self.cat = FieldDefinition.objects.create(project=self.inc, key="ws3cat",
                                                  name="WS3 Category", field_type="cascade")
        hw = FieldOption.objects.create(field=self.cat, value="hw", label="Hardware", level=1)
        FieldOption.objects.create(field=self.cat, value="laptop", label="Laptop", level=2, parent=hw)
        FieldOption.objects.create(field=self.cat, value="other", label="Other", level=1)
        sw = FieldOption.objects.create(field=self.cat, value="sw", label="Software", level=1)
        FieldOption.objects.create(field=self.cat, value="old", label="Old", level=2, parent=sw,
                                   is_active=False)
        self.start = self._tr("Start Progress")
        self.start.field_conditions = [{"field_key": "ws3cat", "operator": "is_not_empty",
                                        "message": "Full category please."}]
        self.start.save()

    def _check(self, value, via_screen=False):
        from apps.itsm_core.services import fields as field_service
        t = self._ticket()
        self._run(t, "Assign")
        t.refresh_from_db()
        if via_screen:
            return engine._check_field_conditions(self.start, t, {"ws3cat": value})
        field_service.set_values(t, {"ws3cat": value}, self.root)
        return engine._check_field_conditions(self.start, t, None)

    def test_level_one_only_is_blocked(self):
        with self.assertRaises(engine.TransitionError):
            self._check(["hw"])

    def test_leaf_path_passes(self):
        self._check(["hw", "laptop"])

    def test_childless_level_one_passes_and_inactive_children_ignored(self):
        self._check(["other"])
        self._check(["sw"])

    def test_submitted_screen_value_checked(self):
        with self.assertRaises(engine.TransitionError):
            self._check(["hw"], via_screen=True)


class AutoAssignNeverOverwritesTests(_Base):
    def setUp(self):
        super().setUp()
        self.group = self.inc.default_group
        self.a = User.objects.create_user(username="a", password="x")
        self.b = User.objects.create_user(username="b", password="x")
        for u in (self.a, self.b):
            GroupMembership.objects.create(group=self.group, user=u)

    def test_existing_assignee_kept_and_cursor_still(self):
        t = self._ticket(assignee=self.root)
        self._run(t, "Assign")
        t.refresh_from_db()
        self.assertEqual(t.assignee_id, self.root.id)
        self.assertFalse(GroupAssignmentState.objects.filter(group=self.group,
                                                             last_assigned_user__isnull=False).exists())

    def test_unassigned_gets_round_robin_pick(self):
        t = self._ticket()
        self._run(t, "Assign")
        t.refresh_from_db()
        self.assertIn(t.assignee_id, {self.a.id, self.b.id})

    def test_preserve_assignee_false_still_keeps(self):
        t = self._ticket(assignee=self.root)
        with self.captureOnCommitCallbacks(execute=True):
            engine.transition(t, self._tr("Assign"), self.root, preserve_assignee=False)
        t.refresh_from_db()
        self.assertEqual(t.assignee_id, self.root.id)

    def test_service_helper(self):
        self.assertIsNone(pick_assignee_if_unassigned(self.root.id, "round_robin", self.group))
        self.assertIn(pick_assignee_if_unassigned(None, "round_robin", self.group),
                      {self.a.id, self.b.id})


# ── U4 ──────────────────────────────────────────────────────────────────────

class BlockedReasonApiTests(_Base):
    def _avail(self, t):
        resp = self.client.get(reverse("itsm-ticket-available-transitions", args=[str(t.pk)]))
        self.assertEqual(resp.status_code, 200, resp.content)
        return {r["name"]: r for r in resp.json()}

    def test_names_and_blocked_reason(self):
        start = self._tr("Start Progress")
        start.field_conditions = [{"field_key": "assignee", "operator": "is_not_empty",
                                   "message": "Assign someone first."}]
        start.save()
        t = self._ticket()
        self._run(t, "Assign")
        Ticket.objects.filter(pk=t.pk).update(assignee=None)
        rows = self._avail(t)
        self.assertEqual(rows["Start Progress"]["to_status_name"], "In Progress")
        self.assertEqual(rows["Start Progress"]["to_status_category"], "in_progress")
        self.assertEqual(rows["Start Progress"]["blocked_reason"], "Assign someone first.")
        resp = self.client.post(reverse("itsm-ticket-transition", args=[str(t.pk)]),
                                {"transition_id": str(start.id)}, format="json")
        self.assertEqual(resp.status_code, 422)  # engine stays authoritative
        Ticket.objects.filter(pk=t.pk).update(assignee=self.root)
        self.assertIsNone(self._avail(t)["Start Progress"]["blocked_reason"])

    def test_rule_on_screen_field_not_precomputed(self):
        t = self._ticket()
        self._run(t, "Assign")
        self._run(t, "Start Progress")
        resolve = self._tr("Resolve")
        resolve.field_conditions = [{"field_key": "root_cause", "operator": "is_not_empty",
                                     "message": "Root cause!"}]
        resolve.save()
        self.assertIsNone(self._avail(t)["Resolve"]["blocked_reason"])


# ── U6 + A2 + A3 ────────────────────────────────────────────────────────────

class CloneWorkflowTests(_Base):
    def test_deep_copy_links_project_and_keeps_open_tickets(self):
        old_ticket = self._ticket()
        resp = self.client.post(reverse("itsm-workflow-clone", args=[str(self.wf.id)]),
                                {"project": str(self.inc.id)}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        copy = Workflow.objects.get(pk=resp.json()["id"])
        self.assertFalse(copy.is_default)
        self.assertEqual(set(copy.statuses.values_list("key", flat=True)),
                         set(self.wf.statuses.values_list("key", flat=True)))
        self.assertEqual(copy.transitions.count(), self.wf.transitions.count())
        resolve = copy.transitions.get(name="Resolve")
        self.assertTrue(resolve.screen_id and resolve.screen.workflow_id == copy.id)
        self.assertEqual(resolve.post_functions, self._tr("Resolve").post_functions)
        self.assertTrue(validate_workflow_graph(copy)["valid"])
        self.inc.refresh_from_db()
        self.hrinc.refresh_from_db()
        self.assertEqual(self.inc.default_workflow_id, copy.id)
        self.assertEqual(self.hrinc.default_workflow_id, self.wf.id)
        old_ticket.refresh_from_db()
        self.assertEqual(old_ticket.workflow_id, self.wf.id)  # rule 10
        self.assertEqual(self._ticket().workflow_id, copy.id)

    def test_conditions_and_shared_screen_copied(self):
        req = _proj("IT", "service_request")
        wf = req.default_workflow
        copy, _ = clone_workflow(wf, name="Req copy")
        self.assertEqual(
            TransitionCondition.objects.filter(transition__workflow=copy).count(),
            TransitionCondition.objects.filter(transition__workflow=wf).count())
        self.assertTrue(copy.transitions.filter(name="Reject").exists())

    def test_duplicate_name_and_rbac(self):
        resp = self.client.post(reverse("itsm-workflow-clone", args=[str(self.wf.id)]),
                                {"name": self.wf.name}, format="json")
        self.assertEqual(resp.status_code, 400)
        req = _proj("IT", "service_request")
        resp = self.client.post(reverse("itsm-workflow-clone", args=[str(self.wf.id)]),
                                {"project": str(req.id)}, format="json")
        self.assertEqual(resp.status_code, 400)  # project doesn't use this workflow

        from apps.itsm_rbac.models import Module, RoleAssignment, RoleModulePermission, SystemRole
        from apps.itsm_rbac.services import invalidate_permission_cache
        role = SystemRole.objects.create(code="wfonly", name="WF only")
        RoleModulePermission.objects.create(role=role, module=Module.objects.get(code="itsm.workflows"),
                                            can_read=True, can_create=True, can_update=True)
        u = User.objects.create_user(username="wfonly", password="x")
        RoleAssignment.objects.create(user=u, role=role)
        invalidate_permission_cache()
        c = APIClient()
        c.force_authenticate(u)
        resp = c.post(reverse("itsm-workflow-clone", args=[str(self.wf.id)]),
                      {"project": str(self.inc.id)}, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_usage_endpoint(self):
        resp = self.client.get(reverse("itsm-workflow-usage", args=[str(self.wf.id)]))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        keys = {p["key"] for p in body["projects"]}
        self.assertIn(self.inc.key, keys)
        self.assertIn(self.hrinc.key, keys)
        self.assertEqual(body["hidden_count"], 0)
        self.assertGreaterEqual(body["project_count"], 2)

    def test_status_filter_lineage_after_copy(self):
        from apps.itsm_tickets.services import filter_fields
        from apps.itsm_tickets.services.query_builder import build_q
        before = self._ticket()
        copy, _ = clone_workflow(self.wf, project=self.inc)
        Status.objects.filter(workflow=copy, key="new").update(name="Brand New")
        after = self._ticket()
        opts = filter_fields.status_options_for_project(self.inc)
        new_opts = [o for o in opts if o["label"] in ("Brand New", "New")]
        self.assertEqual(len(new_opts), 1)
        self.assertEqual(new_opts[0]["label"], "Brand New")  # default workflow wins
        # N18: the pre-copy "new" id rides along as an alias so an older saved
        # filter's chip still resolves its label + checked state client-side.
        self.assertIn(str(Status.objects.get(workflow=self.wf, key="new").id), new_opts[0]["aliases"])
        q = build_q({"conditions": [{"field": "status", "op": "in", "value": [new_opts[0]["value"]]}]})
        ids = set(Ticket.objects.filter(project=self.inc).filter(q).values_list("id", flat=True))
        self.assertEqual(ids, {before.id, after.id})
        hr_new = [o for o in filter_fields.status_options_for_project(self.hrinc) if o["label"] == "New"]
        self.assertEqual(hr_new[0]["value"], str(Status.objects.get(workflow=self.wf, key="new").id))

    def test_automation_rules_repointed(self):
        from apps.itsm_automation.models import AutomationRule
        new_old = Status.objects.get(workflow=self.wf, key="new")
        assigned_old = Status.objects.get(workflow=self.wf, key="assigned")
        assign_old = self._tr("Assign")
        dead = Transition.objects.create(workflow=self.wf, name="Dead", from_status=new_old,
                                         to_status=assigned_old, sort_order=998)
        rule = AutomationRule.objects.create(
            project=self.inc, name="R1",
            triggers=[{"type": "status_changed", "config": {"to_status_ids": [str(new_old.id)]}}],
            conditions={"match": "all", "conditions": [
                {"field": "status", "op": "in", "value": [str(assigned_old.id)]}]},
            actions=[{"type": "transition", "config": {"transition_id": str(assign_old.id)}},
                     {"type": "transition", "config": {"transition_id": str(dead.id)}}])
        other = AutomationRule.objects.create(
            project=self.hrinc, name="R2",
            actions=[{"type": "transition", "config": {"transition_id": str(assign_old.id)}}])
        dead.soft_delete()
        copy, report = clone_workflow(self.wf, project=self.inc)
        rule.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(rule.triggers[0]["config"]["to_status_ids"],
                         [str(Status.objects.get(workflow=copy, key="new").id)])
        self.assertEqual(rule.conditions["conditions"][0]["value"],
                         [str(Status.objects.get(workflow=copy, key="assigned").id)])
        self.assertEqual(rule.actions[0]["config"]["transition_id"],
                         str(copy.transitions.get(name="Assign").id))
        self.assertEqual(rule.actions[1]["config"]["transition_id"], str(dead.id))  # kept
        self.assertEqual(report["repointed"], 1)
        self.assertTrue(any("Dead" in u for u in report["unmatched"]))
        self.assertEqual(other.actions[0]["config"]["transition_id"], str(assign_old.id))


# ── U1 / C5 ─────────────────────────────────────────────────────────────────

class StatusDeleteTests(_Base):
    def _delete(self, st):
        return self.client.delete(reverse("itsm-status-detail", args=[str(st.id)]))

    def test_in_use_and_start_status_refused(self):
        t = self._ticket()
        resp = self._delete(t.status)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ticket", resp.json()["detail"])
        Ticket.objects.all().delete()
        resp = self._delete(Status.objects.get(workflow=self.wf, key="new"))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("start", resp.json()["detail"])

    def test_free_status_cascades_transitions(self):
        pending = Status.objects.get(workflow=self.wf, key="pending")
        resp = self._delete(pending)
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(Transition.objects.filter(workflow=self.wf, name__in=["Put on Hold", "Resume"]).exists())


# ── C7 ──────────────────────────────────────────────────────────────────────

class SetPriorityAuditTests(_Base):
    def test_set_priority_post_function_is_audited(self):
        start = self._tr("Start Progress")
        start.post_functions = [{"type": "set_priority", "config": {"priority": "p1"}}]
        start.save()
        t = self._ticket(priority="p3")
        self._run(t, "Assign")
        self._run(t, "Start Progress")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p1")
        ev = AuditEvent.objects.filter(ticket=t, action="priority_changed").first()
        self.assertIsNotNone(ev)
        self.assertEqual(ev.payload, {"old": "p3", "new": "p1"})


# ── Rejected request ───────────────────────────────────────────────────────

class RejectedRequestTests(_Base):
    def setUp(self):
        super().setUp()
        self.req = _proj("IT", "service_request")
        self.rwf = self.req.default_workflow

    def test_seeded_status_and_gate(self):
        st = Status.objects.get(workflow=self.rwf, key="rejected")
        self.assertEqual(st.category.key, "done")
        reject = Transition.objects.get(workflow=self.rwf, name="Reject")
        self.assertEqual(reject.from_status.key, "new")
        self.assertTrue(reject.conditions.filter(condition_type="approval_rejected").exists())
        self.assertTrue(validate_workflow_graph(self.rwf)["valid"])

    def test_hidden_until_latest_approval_rejected(self):
        from apps.itsm_approvals.models import ApprovalRequest, ApprovalWorkflow
        t = self._ticket(self.req)
        names = lambda: {x.name for x in engine.available_transitions(t, self.root)}  # noqa: E731
        self.assertNotIn("Reject", names())
        awf = ApprovalWorkflow.objects.create(name="A", project=self.req)
        ApprovalRequest.objects.create(ticket=t, workflow=awf, status="rejected")
        self.assertIn("Reject", names())
        self._run(t, "Reject")
        t.refresh_from_db()
        self.assertEqual(t.status.key, "rejected")
        self.assertIsNotNone(t.closed_at)

    def test_migration_forward_is_idempotent(self):
        import importlib

        from django.apps import apps as global_apps
        mig = importlib.import_module("apps.itsm_workflows.migrations.0009_request_rejected_status")
        before = Status.all_objects.filter(key="rejected").count()

        class _SE:
            connection = None
        mig.forward(global_apps, _SE())
        self.assertEqual(Status.all_objects.filter(key="rejected").count(), before)


# ── R3 ──────────────────────────────────────────────────────────────────────

class RoutingRuleScopeTests(_Base):
    def test_rules_clamped_to_helpdesk(self):
        from apps.itsm_helpdesks.models import Helpdesk, HelpdeskMembership
        from apps.itsm_rbac.models import RoleAssignment, SystemRole
        hr_rule = RoutingRule.objects.create(project=self.hrinc, name="HR rule",
                                             target_group=self.hrinc.default_group)
        it_rule = RoutingRule.objects.create(project=self.inc, name="IT rule",
                                             target_group=self.inc.default_group)
        sup = User.objects.create_user(username="sup", password="x")
        RoleAssignment.objects.create(user=sup, role=SystemRole.objects.get(code="supervisor"))
        HelpdeskMembership.objects.create(user=sup, helpdesk=Helpdesk.objects.get(key="IT"))
        c = APIClient()
        c.force_authenticate(sup)
        resp = c.get(reverse("itsm-routing-rule-list"))
        ids = {r["id"] for r in (resp.json().get("results", resp.json()))}
        self.assertIn(str(it_rule.id), ids)
        self.assertNotIn(str(hr_rule.id), ids)
        resp = c.post(reverse("itsm-routing-rule-list"), {
            "project": str(self.hrinc.id), "name": "x",
            "target_group": str(self.hrinc.default_group_id)}, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)


# ── A1 ──────────────────────────────────────────────────────────────────────

class MoveStartStatusTests(_Base):
    def test_initial_status_helper_uses_create_target(self):
        create = Transition.objects.get(workflow=self.wf, from_status__isnull=True)
        assigned = Status.objects.get(workflow=self.wf, key="assigned")
        create.to_status = assigned
        create.save()
        self.assertEqual(ticket_service._initial_status(self.wf).id, assigned.id)
