"""Integration tests: ticket numbering, RBAC, workflow transitions, filters."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.itsm_projects.models import Project
from apps.itsm_rbac.models import RoleAssignment, SystemRole
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.seed import run as seed_workflows
from apps.itsm_workflows.services import engine

from .services import numbering, ticket_service

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


def _project(helpdesk_key, project_type):
    """Fetch a seeded per-helpdesk project by (helpdesk, type) — keys are now
    prefixed (IT → ITINC/ITREQ), so look up by the stable attributes."""
    return Project.objects.get(helpdesk__key=helpdesk_key, project_type=project_type)


class NumberingTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")

    def test_sequential_unique_numbers(self):
        # Numbers are "{project.key}{n}" with NO separator (client preference), so
        # ITINC1, ITINC2, … — matches the live ticket keys (e.g. INC10).
        nums = [numbering.generate_ticket_number(self.inc) for _ in range(5)]
        self.assertEqual(nums, ["ITINC1", "ITINC2", "ITINC3", "ITINC4", "ITINC5"])
        self.assertEqual(len(set(nums)), 5)

    def test_per_project_sequences_independent(self):
        req = _project("IT", "service_request")
        self.assertEqual(numbering.generate_ticket_number(self.inc), "ITINC1")
        self.assertEqual(numbering.generate_ticket_number(req), "ITREQ1")


class RBACTests(TestCase):
    def setUp(self):
        _seed_min()
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.sup = User.objects.create_user(username="su", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))

    def test_agent_can_create_tickets_not_delete_projects(self):
        self.assertTrue(check_permission(self.agent, "itsm.tickets", "create"))
        self.assertFalse(check_permission(self.agent, "itsm.projects", "delete"))
        self.assertFalse(check_permission(self.agent, "itsm.admin.roles", "read"))

    def test_supervisor_full_access(self):
        self.assertTrue(check_permission(self.sup, "itsm.projects", "delete"))
        self.assertTrue(check_permission(self.sup, "itsm.admin.roles", "update"))

    def test_unassigned_user_denied(self):
        nobody = User.objects.create_user(username="nb", password="x")
        self.assertFalse(check_permission(nobody, "itsm.tickets", "read"))


class WorkflowTransitionTests(TestCase):
    def setUp(self):
        _seed_min()
        self.user = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.user, role=SystemRole.objects.get(code="agent"))
        inc = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=inc, ticket_type=inc.ticket_types.get(key="incident"),
            summary="Test", priority="p2", user=self.user,
        )

    def test_create_starts_in_initial_status(self):
        self.assertEqual(self.ticket.status.key, "new")

    def test_transition_moves_status_and_stamps(self):
        assign = Transition.objects.get(workflow=self.ticket.workflow, name="Assign")
        engine.transition(self.ticket, assign, self.user)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "assigned")
        self.assertIsNotNone(self.ticket.assigned_at)

    def test_stale_transition_conflicts(self):
        # advance, then try a transition that's no longer valid from current status
        assign = Transition.objects.get(workflow=self.ticket.workflow, name="Assign")
        engine.transition(self.ticket, assign, self.user)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(self.ticket, assign, self.user)  # from_status no longer matches
        self.assertEqual(ctx.exception.status_code, 409)

    def test_resolve_stamps_resolved_at(self):
        for name in ("Assign", "Start Progress", "Resolve"):
            tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
            # Resolve is seeded with a mandatory note → pass a comment.
            engine.transition(self.ticket, tr, self.user, fields={"resolution": "fixed"},
                              comment="Resolved")
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.category.key, "done")
        self.assertIsNotNone(self.ticket.resolved_at)

    def test_seeded_resolve_prompts_for_resolution_note(self):
        resolve = Transition.objects.get(workflow=self.ticket.workflow, name="Resolve")
        self.assertTrue(resolve.note_prompt)
        self.assertTrue(resolve.note_required)
        self.assertEqual(resolve.note_heading, "Resolution Note")
        self.assertEqual(resolve.note_visibility, "public")

    def test_mandatory_note_blocks_transition_without_comment(self):
        for name in ("Assign", "Start Progress"):
            tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
            engine.transition(self.ticket, tr, self.user)
        hold = Transition.objects.get(workflow=self.ticket.workflow, name="Put on Hold")
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(self.ticket, hold, self.user)  # no note
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("comment", ctx.exception.errors)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "in_progress")  # unchanged

    def test_mandatory_note_allows_transition_with_comment(self):
        for name in ("Assign", "Start Progress"):
            tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
            engine.transition(self.ticket, tr, self.user)
        hold = Transition.objects.get(workflow=self.ticket.workflow, name="Put on Hold")
        engine.transition(self.ticket, hold, self.user, comment="Waiting on vendor")
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "pending")


class QueryBuilderTests(TestCase):
    """The operator-based filter compiler (apps.itsm_tickets.services.query_builder)."""

    def setUp(self):
        _seed_min()
        from apps.itsm_projects.models import Project

        self.proj = _project("IT", "incident")
        self.tt = self.proj.ticket_types.get(key="incident")
        # A project in a different helpdesk — for the scope-clamp tests.
        self.other = Project.objects.exclude(helpdesk_id=self.proj.helpdesk_id).first()
        self.user = User.objects.create_user(username="ag", password="x", full_name="Alex Agent")

    def _mk(self, project=None, **kw):
        kw.setdefault("priority", "p3")
        return ticket_service.create_ticket(
            project=project or self.proj, ticket_type=(project or self.proj).ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def _run(self, spec, *, user=None, scope=None):
        from apps.itsm_tickets.services import query_builder
        from apps.itsm_tickets.models import Ticket
        return set(Ticket.objects.filter(
            query_builder.build_q(spec, user=user, accessible_helpdesk_ids=scope)
        ).distinct().values_list("pk", flat=True))

    def test_eq_neq_in_not_in_on_priority(self):
        hi = self._mk(priority="p2")
        lo = self._mk(priority="p4")
        cr = self._mk(priority="p1")
        eq = self._run({"conditions": [{"field": "priority", "op": "eq", "value": "p2"}]})
        self.assertEqual(eq, {hi.pk})
        neq = self._run({"conditions": [{"field": "priority", "op": "neq", "value": "p2"}]})
        self.assertEqual(neq, {lo.pk, cr.pk})
        inq = self._run({"conditions": [{"field": "priority", "op": "in", "value": ["p2", "p4"]}]})
        self.assertEqual(inq, {hi.pk, lo.pk})
        notin = self._run({"conditions": [{"field": "priority", "op": "not_in", "value": ["p2", "p4"]}]})
        self.assertEqual(notin, {cr.pk})

    def test_assignee_is_empty_and_not_empty(self):
        unassigned = self._mk()
        assigned = self._mk(assignee=self.user)
        empty = self._run({"conditions": [{"field": "assignee", "op": "is_empty"}]})
        self.assertEqual(empty, {unassigned.pk})
        not_empty = self._run({"conditions": [{"field": "assignee", "op": "is_not_empty"}]})
        self.assertEqual(not_empty, {assigned.pk})

    def test_assignee_me_resolves_to_current_user(self):
        mine = self._mk(assignee=self.user)
        self._mk()  # someone else / unassigned
        res = self._run(
            {"conditions": [{"field": "assignee", "op": "eq", "value": "me"}]}, user=self.user,
        )
        self.assertEqual(res, {mine.pk})

    def test_me_without_user_matches_nothing(self):
        self._mk(assignee=self.user)
        res = self._run({"conditions": [{"field": "assignee", "op": "eq", "value": "me"}]})
        self.assertEqual(res, set())

    def test_match_any_combines_with_or(self):
        hi = self._mk(priority="p2")
        unassigned = self._mk(priority="p4")
        res = self._run({"match": "any", "conditions": [
            {"field": "priority", "op": "eq", "value": "p2"},
            {"field": "assignee", "op": "is_empty"},
        ]})
        self.assertEqual(res, {hi.pk, unassigned.pk})

    def test_helpdesk_clamp_blocks_match_any_leak(self):
        """A match:any spec must never OR past the helpdesk-scope clamp."""
        mine = self._mk(priority="p2")
        foreign = self._mk(project=self.other, priority="p2")
        scope = [self.proj.helpdesk_id]
        res = self._run({"match": "any", "conditions": [
            {"field": "priority", "op": "eq", "value": "p2"},
        ]}, scope=scope)
        self.assertIn(mine.pk, res)
        self.assertNotIn(foreign.pk, res)
        # Unrestricted (None) sees both.
        res_all = self._run({"conditions": [{"field": "priority", "op": "eq", "value": "p2"}]})
        self.assertEqual(res_all, {mine.pk, foreign.pk})

    def test_status_category_in(self):
        t = self._mk()  # starts in "new" → todo
        res = self._run({"conditions": [
            {"field": "status_category", "op": "in", "value": ["todo", "in_progress"]}]})
        self.assertIn(t.pk, res)
        none = self._run({"conditions": [
            {"field": "status_category", "op": "in", "value": ["done"]}]})
        self.assertNotIn(t.pk, none)

    def test_due_date_overdue_excludes_done(self):
        from apps.itsm_tickets.models import Ticket
        from apps.itsm_workflows.models import Status
        past = timezone.now() - timedelta(days=2)
        overdue_open = self._mk()
        overdue_done = self._mk()
        Ticket.objects.filter(pk__in=[overdue_open.pk, overdue_done.pk]).update(due_date=past)
        done_status = Status.objects.filter(
            workflow=self.proj.default_workflow, category__key="done").first()
        Ticket.objects.filter(pk=overdue_done.pk).update(status=done_status)
        res = self._run({"conditions": [{"field": "due_date", "op": "overdue"}]})
        self.assertEqual(res, {overdue_open.pk})

    def test_created_this_week_matches_fresh_ticket(self):
        t = self._mk()
        res = self._run({"conditions": [{"field": "created_at", "op": "this_week"}]})
        self.assertIn(t.pk, res)

    def test_summary_contains(self):
        a = self._mk(summary="Email outage in Finance")
        self._mk(summary="Printer jam")
        res = self._run({"conditions": [{"field": "summary", "op": "contains", "value": "outage"}]})
        self.assertEqual(res, {a.pk})

    def test_custom_field_eq_is_empty_and_soft_delete(self):
        from apps.itsm_core.models import FieldDefinition, FieldOption, FieldValue
        from apps.itsm_core.services import fields as field_service

        fd = FieldDefinition.objects.create(
            project=self.proj, key="severity", name="Severity", field_type="dropdown")
        FieldOption.objects.create(field=fd, value="sev1", label="Sev-1", sort_order=1)
        with_val = self._mk()
        without_val = self._mk()
        field_service.set_values(with_val, {"severity": "sev1"}, self.user)

        eq = self._run({"conditions": [{"field": "cf:severity", "op": "eq", "value": "sev1"}]})
        self.assertEqual(eq, {with_val.pk})
        empty = self._run({"conditions": [{"field": "cf:severity", "op": "is_empty"}]})
        self.assertIn(without_val.pk, empty)
        self.assertNotIn(with_val.pk, empty)

        # Soft-deleting the FieldValue must make the ticket count as empty again.
        FieldValue.objects.get(ticket=with_val, field=fd).soft_delete()
        eq_after = self._run({"conditions": [{"field": "cf:severity", "op": "eq", "value": "sev1"}]})
        self.assertEqual(eq_after, set())
        empty_after = self._run({"conditions": [{"field": "cf:severity", "op": "is_empty"}]})
        self.assertIn(with_val.pk, empty_after)

    def test_richtext_custom_field_value_is_sanitised(self):
        """A custom richtext field is rendered with dangerouslySetInnerHTML on the
        client, so set_values must strip scripts/handlers like ticket descriptions."""
        from apps.itsm_core.models import FieldDefinition, FieldValue
        from apps.itsm_core.services import fields as field_service

        fd = FieldDefinition.objects.create(
            project=self.proj, key="notes", name="Notes", field_type="richtext")
        t = self._mk()
        field_service.set_values(
            t,
            {"notes": '<p>ok <strong>bold</strong></p><script>alert(1)</script>'
                      '<img src=x onerror=alert(1)>'},
            self.user,
        )
        stored = FieldValue.objects.get(ticket=t, field=fd).value_text
        self.assertIn("<strong>bold</strong>", stored)
        self.assertNotIn("<script>", stored)
        self.assertNotIn("onerror", stored)

    def test_unknown_field_and_op_are_ignored(self):
        t = self._mk()
        # Unknown field key → condition dropped → spec has no effective conditions.
        res = self._run({"conditions": [{"field": "assignee__password", "op": "eq", "value": "x"}]})
        self.assertIn(t.pk, res)
        res2 = self._run({"conditions": [{"field": "priority", "op": "regex", "value": ".*"}]})
        self.assertIn(t.pk, res2)

    def test_malformed_fk_values_are_dropped_not_crashed(self):
        self._mk(priority="p2")
        # A bad UUID for a model FK and a bad int for a user FK must not raise.
        self.assertEqual(
            self._run({"conditions": [{"field": "status", "op": "in", "value": ["not-a-uuid"]}]}), set())
        self.assertEqual(
            self._run({"conditions": [{"field": "assignee", "op": "eq", "value": "notanint"}]}), set())
        # A stray scalar (not a list) for an `in` must not iterate characters.
        self.assertEqual(
            self._run({"conditions": [{"field": "status", "op": "in", "value": "not-a-uuid"}]}), set())


class TicketFilterApiTests(TestCase):
    """End-to-end: ?q ad-hoc filtering, alias ordering, filter-fields metadata."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, **kw):
        kw.setdefault("priority", "p3")
        return ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def test_filter_fields_endpoint(self):
        from django.urls import reverse

        self._mk()
        url = reverse("itsm-ticket-filter-fields")
        resp = self.client.get(url, {"project": str(self.proj.id)})
        self.assertEqual(resp.status_code, 200)
        keys = {f["key"] for f in resp.data["fields"]}
        self.assertIn("status", keys)
        self.assertIn("priority", keys)
        view_keys = {v["key"] for v in resp.data["system_views"]}
        self.assertIn("open", view_keys)
        self.assertIn("unassigned", view_keys)

    def test_priority_alias_ordering_is_severity_correct(self):
        from django.urls import reverse

        self._mk(priority="p4")
        self._mk(priority="p1")
        self._mk(priority="p3")
        self._mk(priority="p2")
        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "priority"})
        self.assertEqual(resp.status_code, 200)
        order = [r["priority"] for r in resp.data["results"]]
        self.assertEqual(order, ["p1", "p2", "p3", "p4"])

    def test_requestor_ordering_sorts_by_display_name(self):
        """`ordering=requestor` sorts by the requestor's display name, not the id."""
        from django.urls import reverse

        zoe = User.objects.create_user(username="zoe", password="x", full_name="Zoe")
        amy = User.objects.create_user(username="amy", password="x", full_name="Amy")
        self._mk(requestor=zoe, summary="z")
        self._mk(requestor=amy, summary="a")
        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "requestor"})
        self.assertEqual(resp.status_code, 200)
        names = [r["requestor"]["full_name"] for r in resp.data["results"]]
        self.assertEqual(names, ["Amy", "Zoe"])
        # And descending flips it.
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "-requestor"})
        names = [r["requestor"]["full_name"] for r in resp.data["results"]]
        self.assertEqual(names, ["Zoe", "Amy"])

    def test_group_ordering_sorts_alphabetically(self):
        from django.urls import reverse

        from apps.itsm_groups.models import Group

        a = Group.objects.create(name="Alpha", key="alpha", helpdesk=self.proj.helpdesk)
        b = Group.objects.create(name="Beta", key="beta", helpdesk=self.proj.helpdesk)
        self._mk(assigned_group=b, summary="b")
        self._mk(assigned_group=a, summary="a")
        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "assigned_group"})
        self.assertEqual(resp.status_code, 200)
        groups = [r.get("assigned_group_name") for r in resp.data["results"]]
        self.assertEqual(groups, ["Alpha", "Beta"])

    def test_custom_field_column_is_sortable(self):
        """A value-backed text custom field publishes an `ordering_key` and
        `?ordering=cf:<key>` sorts the list by its stored value."""
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition
        from apps.itsm_core.services import fields as field_service

        FieldDefinition.objects.create(
            project=self.proj, key="vendor", name="Vendor", field_type="text")
        a = self._mk(summary="a")
        b = self._mk(summary="b")
        c = self._mk(summary="c")
        with self.captureOnCommitCallbacks(execute=True):
            field_service.set_values(a, {"vendor": "Zulu"}, self.admin)
            field_service.set_values(b, {"vendor": "Alpha"}, self.admin)
            field_service.set_values(c, {"vendor": "Mike"}, self.admin)

        # The registry advertises it as sortable.
        reg = self.client.get(reverse("itsm-ticket-filter-fields"), {"project": str(self.proj.id)})
        vendor = next(f for f in reg.data["fields"] if f["key"] == "cf:vendor")
        self.assertEqual(vendor["ordering_key"], "cf:vendor")

        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "cf:vendor"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r["id"] for r in resp.data["results"]], [str(b.pk), str(c.pk), str(a.pk)])
        resp = self.client.get(url, {"project": str(self.proj.id), "ordering": "-cf:vendor"})
        self.assertEqual([r["id"] for r in resp.data["results"]], [str(a.pk), str(c.pk), str(b.pk)])

    def test_unsortable_custom_field_has_no_ordering_key(self):
        """A multi-value field (multiselect) is a valid column but NOT sortable."""
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition

        FieldDefinition.objects.create(
            project=self.proj, key="tags", name="Tags", field_type="multiselect")
        self._mk()
        reg = self.client.get(reverse("itsm-ticket-filter-fields"), {"project": str(self.proj.id)})
        tags = next(f for f in reg.data["fields"] if f["key"] == "cf:tags")
        self.assertNotIn("ordering_key", tags)
        # And a forged `?ordering=cf:tags` is ignored (falls back, no 400/500).
        resp = self.client.get(reverse("itsm-ticket-list"),
                               {"project": str(self.proj.id), "ordering": "cf:tags"})
        self.assertEqual(resp.status_code, 200)

    def test_unknown_cf_ordering_is_ignored(self):
        from django.urls import reverse

        self._mk()
        resp = self.client.get(reverse("itsm-ticket-list"),
                               {"project": str(self.proj.id), "ordering": "cf:nope"})
        self.assertEqual(resp.status_code, 200)

    def test_q_param_filters(self):
        import json
        from django.urls import reverse

        hi = self._mk(priority="p2")
        self._mk(priority="p4")
        q = json.dumps({"conditions": [{"field": "priority", "op": "eq", "value": "p2"}]})
        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "q": q})
        self.assertEqual(resp.status_code, 200)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertEqual(ids, {str(hi.pk)})

    def test_malformed_q_is_ignored(self):
        from django.urls import reverse

        self._mk()
        url = reverse("itsm-ticket-list")
        resp = self.client.get(url, {"project": str(self.proj.id), "q": "{not json"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)

    def test_q_with_bad_uuid_does_not_500(self):
        import json
        from django.urls import reverse

        self._mk()
        q = json.dumps({"conditions": [{"field": "status", "op": "in", "value": ["bad"]}]})
        resp = self.client.get(reverse("itsm-ticket-list"), {"project": str(self.proj.id), "q": q})
        self.assertEqual(resp.status_code, 200)

    def test_saved_filter_bad_uuid_is_ignored(self):
        from django.urls import reverse

        self._mk()
        resp = self.client.get(reverse("itsm-ticket-list"),
                               {"project": str(self.proj.id), "saved_filter": "garbage"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)

    def test_filter_fields_bad_project_does_not_500(self):
        from django.urls import reverse

        resp = self.client.get(reverse("itsm-ticket-filter-fields"), {"project": "garbage"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("status", {f["key"] for f in resp.data["fields"]})

    def test_saved_filter_scope_blocks_foreign_private_filter(self):
        from django.urls import reverse

        from apps.itsm_dashboards.models import SavedFilter

        other = User.objects.create_user(username="other2", password="x")
        self._mk(priority="p2")
        self._mk(priority="p4")
        sf = SavedFilter.objects.create(
            name="Other private", owner=other, is_shared=False, project=self.proj,
            query_spec={"conditions": [{"field": "priority", "op": "eq", "value": "p2"}]})
        resp = self.client.get(reverse("itsm-ticket-list"),
                               {"project": str(self.proj.id), "saved_filter": str(sf.id)})
        self.assertEqual(resp.status_code, 200)
        # Not owned by the requester and not shared → filter is not applied.
        self.assertEqual(resp.data["count"], 2)


class CombinedQueueApiTests(TestCase):
    """The combined cross-project ("All Tickets") queue: a helpdesk-wide list scope
    (no `?project`), the UNION filter-field registry across the helpdesk's projects,
    and batched, display-ready custom-field columns via `?cf=`."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.inc = _project("IT", "incident")          # ITINC
        self.req = _project("IT", "service_request")   # ITREQ (same helpdesk)
        self.hr = _project("HR", "incident")           # HRINC (different helpdesk)
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, project, **kw):
        kw.setdefault("priority", "p3")
        return ticket_service.create_ticket(
            project=project, ticket_type=project.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def test_list_spans_projects_in_helpdesk_but_not_others(self):
        from django.urls import reverse

        a = self._mk(self.inc)
        b = self._mk(self.req)
        foreign = self._mk(self.hr)
        resp = self.client.get(reverse("itsm-ticket-list"), {"helpdesk": "IT"})
        self.assertEqual(resp.status_code, 200)
        ids = {r["id"] for r in resp.data["results"]}
        self.assertEqual(ids, {str(a.pk), str(b.pk)})
        self.assertNotIn(str(foreign.pk), ids)

    def test_filter_fields_unions_custom_fields_across_projects(self):
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition

        FieldDefinition.objects.create(
            project=self.inc, key="severity", name="Severity", field_type="dropdown")
        FieldDefinition.objects.create(
            project=self.req, key="region", name="Region", field_type="text")
        # A field in another helpdesk must NOT leak into the IT-scoped registry.
        FieldDefinition.objects.create(
            project=self.hr, key="hronly", name="HR Only", field_type="text")

        resp = self.client.get(reverse("itsm-ticket-filter-fields"), {"helpdesk": "IT"})
        self.assertEqual(resp.status_code, 200)
        keys = {f["key"] for f in resp.data["fields"]}
        self.assertIn("cf:severity", keys)   # from ITINC
        self.assertIn("cf:region", keys)     # from ITREQ
        self.assertNotIn("cf:hronly", keys)  # HR is out of scope
        self.assertIn("status", keys)        # builtins still present

    def test_filter_fields_union_merges_options_and_dedupes_collisions(self):
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition, FieldOption

        # Same key + same type across projects → ONE entry, options merged (union).
        f1 = FieldDefinition.objects.create(
            project=self.inc, key="tier", name="Tier", field_type="dropdown")
        FieldOption.objects.create(field=f1, value="gold", label="Gold", sort_order=1)
        f2 = FieldDefinition.objects.create(
            project=self.req, key="tier", name="Tier", field_type="dropdown")
        FieldOption.objects.create(field=f2, value="silver", label="Silver", sort_order=1)
        # Same key + different type → the conflicting one is dropped (single entry).
        FieldDefinition.objects.create(
            project=self.inc, key="dupe", name="Dupe", field_type="text")
        FieldDefinition.objects.create(
            project=self.req, key="dupe", name="Dupe", field_type="number")

        resp = self.client.get(reverse("itsm-ticket-filter-fields"), {"helpdesk": "IT"})
        fields = resp.data["fields"]
        tier = [f for f in fields if f["key"] == "cf:tier"]
        self.assertEqual(len(tier), 1)  # deduped to one field
        self.assertEqual({o["value"] for o in tier[0].get("options", [])}, {"gold", "silver"})
        dupe = [f for f in fields if f["key"] == "cf:dupe"]
        self.assertEqual(len(dupe), 1)  # type collision collapsed to one entry

    def test_list_cf_columns_are_batched_and_display_ready(self):
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition, FieldOption
        from apps.itsm_core.services import fields as field_service

        fd = FieldDefinition.objects.create(
            project=self.inc, key="severity", name="Severity", field_type="dropdown")
        FieldOption.objects.create(field=fd, value="sev1", label="Sev-1", sort_order=1)
        a = self._mk(self.inc)   # ITINC ticket carries the field
        b = self._mk(self.req)   # ITREQ has no such field → blank cell
        field_service.set_values(a, {"severity": "sev1"}, self.admin)

        resp = self.client.get(
            reverse("itsm-ticket-list"), {"helpdesk": "IT", "cf": "cf:severity"})
        self.assertEqual(resp.status_code, 200)
        by_id = {r["id"]: r for r in resp.data["results"]}
        # Display-ready: the OPTION LABEL ("Sev-1"), not the stored value ("sev1").
        self.assertEqual(by_id[str(a.pk)]["custom_values"], {"cf:severity": "Sev-1"})
        # A project without the field yields a blank (None) cell, not an error.
        self.assertEqual(by_id[str(b.pk)]["custom_values"], {"cf:severity": None})

    def test_list_without_cf_omits_custom_values(self):
        from django.urls import reverse

        self._mk(self.inc)
        resp = self.client.get(reverse("itsm-ticket-list"), {"helpdesk": "IT"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data["results"][0]["custom_values"])


class TicketPulseApiTests(TestCase):
    """The cheap `pulse` change-token polled by the live (silent-refresh) queue:
    it must reuse the same scope/filters as `list`, change on any matching write,
    and (portal) only ever reflect the caller's own tickets."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        self.admin = User.objects.create_superuser(username="rootpulse", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, **kw):
        kw.setdefault("priority", "p3")
        return ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def test_pulse_returns_version_and_count(self):
        from django.urls import reverse

        self._mk()
        self._mk()
        resp = self.client.get(reverse("itsm-ticket-pulse"), {"project": str(self.proj.id)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 2)
        self.assertTrue(resp.data["version"].endswith(":2"))

    def test_pulse_empty_scope_is_zero(self):
        from django.urls import reverse

        resp = self.client.get(reverse("itsm-ticket-pulse"), {"project": str(self.proj.id)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 0)
        self.assertEqual(resp.data["version"], "0:0")

    def test_pulse_version_changes_after_create(self):
        from django.urls import reverse

        url = reverse("itsm-ticket-pulse")
        self._mk()
        v1 = self.client.get(url, {"project": str(self.proj.id)}).data["version"]
        self._mk()
        r2 = self.client.get(url, {"project": str(self.proj.id)})
        self.assertNotEqual(v1, r2.data["version"])
        self.assertEqual(r2.data["count"], 2)

    def test_pulse_respects_q_filter(self):
        import json
        from django.urls import reverse

        self._mk(priority="p2")
        self._mk(priority="p4")
        q = json.dumps({"conditions": [{"field": "priority", "op": "eq", "value": "p2"}]})
        resp = self.client.get(reverse("itsm-ticket-pulse"),
                               {"project": str(self.proj.id), "q": q})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)  # only the matching ticket is counted

    def test_portal_pulse_scoped_to_requestor(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        requestor = User.objects.create_user(username="reqpulse", password="x")
        RoleAssignment.objects.create(user=requestor, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(requestor)

        self._mk(requestor=requestor)  # owned by the requestor
        self._mk()                     # someone else's → must not be counted

        resp = client.get(reverse("itsm-portal-request-pulse"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertTrue(resp.data["version"].endswith(":1"))


class TicketDetailLookupApiTests(TestCase):
    """The detail lookup accepts a human-readable ticket_number as well as the
    UUID pk, on both the agent and portal viewsets, without weakening scope."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        # A project in a different helpdesk — for the scope-clamp tests.
        self.other = Project.objects.exclude(helpdesk_id=self.proj.helpdesk_id).first()
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, project=None, **kw):
        kw.setdefault("priority", "p3")
        proj = project or self.proj
        return ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def test_lookup_by_ticket_number(self):
        from django.urls import reverse

        t = self._mk()
        resp = self.client.get(reverse("itsm-ticket-detail", args=[t.ticket_number]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], str(t.pk))
        self.assertEqual(resp.data["ticket_number"], t.ticket_number)

    def test_lookup_by_uuid_still_works(self):
        from django.urls import reverse

        t = self._mk()
        resp = self.client.get(reverse("itsm-ticket-detail", args=[str(t.pk)]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], str(t.pk))

    def test_action_resolves_by_ticket_number(self):
        """One get_object() override covers every detail @action, not just retrieve."""
        from django.urls import reverse

        t = self._mk()
        resp = self.client.get(reverse("itsm-ticket-activity", args=[t.ticket_number]))
        self.assertEqual(resp.status_code, 200)

    def test_nonexistent_token_404(self):
        from django.urls import reverse

        resp = self.client.get(reverse("itsm-ticket-detail", args=["ITINC-99999"]))
        self.assertEqual(resp.status_code, 404)

    def test_cross_helpdesk_scope_enforced(self):
        """A scoped agent must not reach a foreign-helpdesk ticket by number OR uuid."""
        from django.urls import reverse
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership

        agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=agent)
        # Strict project whitelist: the agent must be assigned the project to see it.
        ProjectMembership.objects.create(project=self.proj, user=agent)
        client = APIClient()
        client.force_authenticate(agent)

        mine = self._mk()
        foreign = self._mk(project=self.other)

        self.assertEqual(
            client.get(reverse("itsm-ticket-detail", args=[mine.ticket_number])).status_code, 200)
        self.assertEqual(
            client.get(reverse("itsm-ticket-detail", args=[foreign.ticket_number])).status_code, 404)
        self.assertEqual(
            client.get(reverse("itsm-ticket-detail", args=[str(foreign.pk)])).status_code, 404)

    def test_portal_lookup_by_number_and_scope(self):
        """Portal resolves a requestor's own ticket by number; others' stay hidden."""
        from django.urls import reverse
        from rest_framework.test import APIClient

        requestor = User.objects.create_user(username="req", password="x")
        RoleAssignment.objects.create(user=requestor, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(requestor)

        mine = self._mk(requestor=requestor)
        someone_else = self._mk()  # no requestor → not owned by `requestor`

        self.assertEqual(
            client.get(reverse("itsm-portal-request-detail", args=[mine.ticket_number])).status_code, 200)
        self.assertEqual(
            client.get(reverse("itsm-portal-request-detail", args=[someone_else.ticket_number])).status_code, 404)


class TicketInlineEditApiTests(TestCase):
    """PATCH /tickets/<id>/ — inline field edits from the detail view route through
    ticket_service.update_ticket (audit-logged, HTML-sanitised, scope/RBAC clamped)."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        self.other = Project.objects.exclude(helpdesk_id=self.proj.helpdesk_id).first()
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.bob = User.objects.create_user(username="bob", password="x", full_name="Bob Builder")
        self.group = self.proj.default_group
        # Strict assignment: an assignee must be an active member of the group.
        from apps.itsm_groups.models import GroupMembership
        GroupMembership.objects.create(
            group=self.group, user=self.bob, role_in_group="member", is_active=True)

    def _mk(self, project=None, **kw):
        kw.setdefault("priority", "p3")
        proj = project or self.proj
        return ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, **kw,
        )

    def _patch(self, ticket, body):
        from django.urls import reverse
        return self.client.patch(
            reverse("itsm-ticket-detail", args=[ticket.ticket_number]), body, format="json")

    def test_patch_priority_updates_and_logs(self):
        from apps.itsm_core.models import AuditEvent

        t = self._mk(priority="p4")
        # log_event fires on transaction commit, so capture + execute the callbacks.
        with self.captureOnCommitCallbacks(execute=True):
            resp = self._patch(t, {"priority": "p2"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["priority"], "p2")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p2")
        self.assertTrue(AuditEvent.objects.filter(ticket=t, action="priority_changed").exists())

    def test_patch_assignee_stamps_and_emits(self):
        t = self._mk()
        self.assertIsNone(t.assignee_id)
        resp = self._patch(t, {"assignee": str(self.bob.pk)})
        self.assertEqual(resp.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.assignee_id, self.bob.pk)
        self.assertIsNotNone(t.assigned_at)

    def test_patch_requestor_and_group(self):
        t = self._mk()
        resp = self._patch(t, {"requestor": str(self.bob.pk), "assigned_group": str(self.group.id)})
        self.assertEqual(resp.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.requestor_id, self.bob.pk)
        self.assertEqual(t.assigned_group_id, self.group.id)

    def test_assignee_change_logs_human_label(self):
        """The `assigned` audit row carries the assignee's display name (not just the
        raw user id) so the activity feed can render 'who → who' without a lookup."""
        from apps.itsm_core.models import AuditEvent

        t = self._mk()
        with self.captureOnCommitCallbacks(execute=True):
            self._patch(t, {"assignee": str(self.bob.pk)})
        ev = AuditEvent.objects.get(ticket=t, action="assigned")
        self.assertIsNone(ev.payload["old_label"])
        self.assertEqual(ev.payload["new_label"], "Bob Builder")

    def test_group_change_logs_human_label(self):
        from apps.itsm_core.models import AuditEvent
        from apps.itsm_groups.models import Group

        # A ticket starts on the project default group; patch it to a distinct group.
        other_group = Group.objects.create(
            helpdesk_id=self.proj.helpdesk_id, name="Second Team", key="second-team")
        t = self._mk()
        with self.captureOnCommitCallbacks(execute=True):
            resp = self._patch(t, {"assigned_group": str(other_group.id)})
        self.assertEqual(resp.status_code, 200)
        ev = AuditEvent.objects.get(ticket=t, action="group_changed")
        self.assertEqual(ev.payload["old_label"], self.group.name)
        self.assertEqual(ev.payload["new_label"], "Second Team")

    def test_summary_change_logs_old_and_new(self):
        """`summary_changed` now records the before/after text (was an empty payload)."""
        from apps.itsm_core.models import AuditEvent

        t = self._mk(summary="Old title")
        with self.captureOnCommitCallbacks(execute=True):
            self._patch(t, {"summary": "New title"})
        ev = AuditEvent.objects.get(ticket=t, action="summary_changed")
        self.assertEqual(ev.payload["old"], "Old title")
        self.assertEqual(ev.payload["new"], "New title")

    def test_patch_clears_assignee_with_null(self):
        t = self._mk(assignee=self.bob)
        resp = self._patch(t, {"assignee": None})
        self.assertEqual(resp.status_code, 200)
        t.refresh_from_db()
        self.assertIsNone(t.assignee_id)

    def test_patch_assignee_not_in_group_is_400(self):
        """Strict assignment — an assignee who is not an active member of the
        ticket's assigned group is rejected at the API."""
        carol = User.objects.create_user(username="carol", password="x", full_name="Carol")
        t = self._mk()  # group = default_group; carol is not a member
        resp = self._patch(t, {"assignee": str(carol.pk)})
        self.assertEqual(resp.status_code, 400)
        t.refresh_from_db()
        self.assertIsNone(t.assignee_id)

    def test_patch_records_updated_by(self):
        t = self._mk(priority="p4")
        with self.captureOnCommitCallbacks(execute=True):
            self._patch(t, {"priority": "p2"})
        t.refresh_from_db()
        self.assertEqual(t.updated_by_id, self.admin.pk)

    def test_patch_description_is_sanitised(self):
        t = self._mk()
        resp = self._patch(t, {"description_html": "<p>hi</p><script>alert(1)</script>"})
        self.assertEqual(resp.status_code, 200)
        t.refresh_from_db()
        self.assertNotIn("<script>", t.description_html)
        self.assertIn("hi", t.description_text)

    def test_invalid_priority_is_400(self):
        t = self._mk()
        self.assertEqual(self._patch(t, {"priority": "urgent"}).status_code, 400)

    def test_unknown_user_is_400(self):
        t = self._mk()
        self.assertEqual(self._patch(t, {"assignee": "987654"}).status_code, 400)

    def test_empty_summary_is_400(self):
        t = self._mk()
        self.assertEqual(self._patch(t, {"summary": "   "}).status_code, 400)

    def test_cross_helpdesk_patch_is_404(self):
        """A scoped agent cannot edit a foreign-helpdesk ticket (row not in scope)."""
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership

        agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=agent)
        client = APIClient()
        client.force_authenticate(agent)

        foreign = self._mk(project=self.other)
        from django.urls import reverse
        resp = client.patch(
            reverse("itsm-ticket-detail", args=[foreign.ticket_number]),
            {"priority": "p2"}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_requestor_role_cannot_patch(self):
        """A requestor has no itsm.tickets perm → 403 on the agent edit endpoint."""
        from rest_framework.test import APIClient

        requestor = User.objects.create_user(username="req", password="x")
        RoleAssignment.objects.create(user=requestor, role=SystemRole.objects.get(code="requestor"))
        client = APIClient()
        client.force_authenticate(requestor)

        t = self._mk()
        from django.urls import reverse
        resp = client.patch(
            reverse("itsm-ticket-detail", args=[t.ticket_number]),
            {"priority": "p2"}, format="json")
        self.assertEqual(resp.status_code, 403)


class CommentVisibilityApiTests(TestCase):
    """POST /tickets/<id>/comments/ — the composer can add a Public Comment (default)
    or an Internal note; private notes are gated by `itsm.tickets.comments_private`."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient

        cache.clear()  # check_permission caches per (role, module, action) across tests
        _seed_min()
        self.proj = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="T", priority="p3", apply_routing=False,
        )
        self.client = APIClient()

    def _agent(self):
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership
        agent = User.objects.create_user(username="ag1", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=agent)
        ProjectMembership.objects.create(project=self.proj, user=agent)
        client = APIClient()
        client.force_authenticate(agent)
        return client

    def _url(self):
        from django.urls import reverse
        return reverse("itsm-ticket-comments", args=[self.ticket.ticket_number])

    def test_default_post_is_public(self):
        """A POST without `visibility` defaults to a public comment."""
        resp = self._agent().post(self._url(), {"body_html": "<p>hi</p>"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["visibility"], "public")

    def test_agent_can_post_private_note(self):
        """An agent holds `itsm.tickets.comments_private` → may add an internal note."""
        resp = self._agent().post(
            self._url(), {"body_html": "<p>secret</p>", "visibility": "private"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["visibility"], "private")

    def test_private_note_does_not_stop_first_response(self):
        """Only the first *public* reply stamps first_responded_at; a note does not."""
        self._agent().post(
            self._url(), {"body_html": "<p>note</p>", "visibility": "private"}, format="json")
        self.ticket.refresh_from_db()
        self.assertIsNone(self.ticket.first_responded_at)

    def test_forged_private_without_grant_is_403(self):
        """A user who can comment but is denied the internal-notes module can't sneak a
        private note via a forged POST — yet a public comment still works."""
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership
        from apps.itsm_rbac.models import Module, RoleModulePermission
        user = User.objects.create_user(username="pubonly", password="x")
        role = SystemRole.objects.create(code="pubonly", name="Pub Only", is_active=True)
        RoleAssignment.objects.create(user=user, role=role)
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=user)
        ProjectMembership.objects.create(project=self.proj, user=user)
        # Grant ticket comment access (POST → itsm.tickets:create) but EXPLICITLY deny the
        # internal-notes module — an explicit row stops the ancestor walk in check_permission,
        # which otherwise would inherit `itsm.tickets` read.
        tickets = Module.objects.get(code="itsm.tickets")
        RoleModulePermission.objects.create(
            role=role, module=tickets, can_read=True, can_create=True, can_update=True)
        private = Module.objects.get(code="itsm.tickets.comments_private")
        RoleModulePermission.objects.create(
            role=role, module=private, can_read=False, can_create=False, can_update=False)
        client = APIClient()
        client.force_authenticate(user)

        resp = client.post(
            self._url(), {"body_html": "<p>x</p>", "visibility": "private"}, format="json")
        self.assertEqual(resp.status_code, 403)
        # A public comment from the same user still works.
        ok = client.post(self._url(), {"body_html": "<p>ok</p>"}, format="json")
        self.assertEqual(ok.status_code, 201)


import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class CommentAttachmentApiTests(TestCase):
    """POST /comment-attachments/ uploads an inline image / file (comment null);
    POST /tickets/<id>/comments/ with `attachment_ids` attaches them to the reply."""

    def setUp(self):
        from django.core.cache import cache
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership
        cache.clear()
        _seed_min()
        self.proj = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="T", priority="p3", apply_routing=False,
        )
        self.agent = User.objects.create_user(username="ag1", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=self.agent)
        ProjectMembership.objects.create(project=self.proj, user=self.agent)
        self.client = APIClient()
        self.client.force_authenticate(self.agent)

    def _upload(self, ticket=None, kind="file", name="doc.pdf", ctype="application/pdf"):
        from django.urls import reverse
        return self.client.post(
            reverse("itsm-comment-attachment-list"),
            {"ticket": str((ticket or self.ticket).id), "kind": kind,
             "file": SimpleUploadedFile(name, b"hello-bytes", content_type=ctype)},
            format="multipart",
        )

    def _comments_url(self, ticket=None):
        from django.urls import reverse
        return reverse("itsm-ticket-comments", args=[(ticket or self.ticket).ticket_number])

    def test_upload_is_unattached_then_associates_on_comment(self):
        up = self._upload()
        self.assertEqual(up.status_code, 201, up.data)
        self.assertEqual(up.data["kind"], "file")
        self.assertIsNone(up.data["comment"])  # not attached to a reply yet
        att_id = up.data["id"]

        resp = self.client.post(
            self._comments_url(), {"body_html": "<p>see file</p>", "attachment_ids": [att_id]},
            format="json")
        self.assertEqual(resp.status_code, 201)
        ids = [a["id"] for a in resp.data["attachments"]]
        self.assertIn(att_id, ids)

    def test_inline_image_html_survives_sanitise(self):
        """An uploaded image embedded by absolute URL stays in body_html (http allowed);
        a base64 data-URI image would be stripped, which is why we upload."""
        body = '<p>pic <img src="http://testserver/media/itsm_attachments/x.png" alt="x"></p>'
        resp = self.client.post(self._comments_url(), {"body_html": body}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertIn("<img", resp.data["body_html"])
        self.assertIn("/media/itsm_attachments/x.png", resp.data["body_html"])

    def test_image_kind_requires_image_content_type(self):
        resp = self._upload(kind="image", name="doc.pdf", ctype="application/pdf")
        self.assertEqual(resp.status_code, 400)

    def test_attachment_from_another_ticket_is_not_associated(self):
        other = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="Other", priority="p3", apply_routing=False,
        )
        up = self._upload(ticket=other)
        self.assertEqual(up.status_code, 201)
        # Post a comment on self.ticket trying to claim `other`'s attachment.
        resp = self.client.post(
            self._comments_url(), {"body_html": "<p>x</p>", "attachment_ids": [up.data["id"]]},
            format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["attachments"], [])  # cross-ticket claim rejected

    def test_upload_to_inaccessible_helpdesk_is_403(self):
        hr_ticket = ticket_service.create_ticket(
            project=_project("HR", "incident"),
            ticket_type=_project("HR", "incident").ticket_types.first(),
            summary="HR", priority="p3", apply_routing=False,
        )
        resp = self._upload(ticket=hr_ticket)
        self.assertEqual(resp.status_code, 403)


class PortalLayoutVisibilityApiTests(TestCase):
    """The Service Portal request-intake `layout` endpoint only exposes
    portal_visible layout items; the Layout designer's Portal toggle opts a field
    in/out per project."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        self.requestor = User.objects.create_user(username="req", password="x")
        RoleAssignment.objects.create(
            user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.client = APIClient()
        self.client.force_authenticate(self.requestor)

    def _layout_keys(self):
        from django.urls import reverse

        resp = self.client.get(
            reverse("itsm-portal-intake-layout"), {"project": str(self.proj.id)})
        self.assertEqual(resp.status_code, 200)
        return {it["field_key"] for it in resp.data["layout"]["items"]}

    def test_seeded_defaults_hide_assignment_and_pickers(self):
        keys = self._layout_keys()
        # Requestor-fillable fields are exposed…
        self.assertIn("summary", keys)
        self.assertIn("description", keys)
        self.assertIn("mode", keys)
        # …assignment / source / picker fields are not; on Incidents Priority is also
        # agent-only (it lives in the agent-only Impact Assessment section).
        for hidden in ("requestor", "assigned_group", "assignee", "source", "priority"):
            self.assertNotIn(hidden, keys)

    def test_portal_toggle_opts_field_out(self):
        from apps.itsm_core.models import FieldLayoutItem

        self.assertIn("mode", self._layout_keys())
        FieldLayoutItem.objects.filter(
            layout__project=self.proj, field__key="mode").update(portal_visible=False)
        self.assertNotIn("mode", self._layout_keys())

    def test_portal_toggle_opts_field_in(self):
        from apps.itsm_core.models import FieldLayoutItem

        self.assertNotIn("requestor", self._layout_keys())
        FieldLayoutItem.objects.filter(
            layout__project=self.proj, field__key="requestor").update(portal_visible=True)
        self.assertIn("requestor", self._layout_keys())

    def test_mandatory_portal_hidden_field_does_not_block_create(self):
        """A field set mandatory but hidden from the portal (portal_visible=False) is
        never rendered to the requestor, so it must NOT block portal submission —
        validate_required runs portal_only on the create path."""
        from django.urls import reverse

        from apps.itsm_core.models import FieldDefinition, FieldLayout, FieldLayoutItem

        fd = FieldDefinition.objects.create(
            project=self.proj, key="internal_ref", name="Internal Ref", field_type="text")
        layout = FieldLayout.objects.get(project=self.proj, ticket_type__isnull=True)
        FieldLayoutItem.objects.create(
            layout=layout, field=fd, sort_order=999,
            is_mandatory=True, is_hidden=False, portal_visible=False)

        # The requestor never sends internal_ref (it isn't on their form); the create
        # must still succeed on the portal-visible mandatory fields it does send.
        resp = self.client.post(
            reverse("itsm-portal-intake-list"),
            {"project": str(self.proj.id),
             "fields": {"summary": "Need help", "description": "<p>x</p>", "priority": "p3"}},
            format="json")
        self.assertEqual(resp.status_code, 201, getattr(resp, "data", None))


def _list_items(resp):
    """Items from a list response, paginated ({results: [...]}) or plain."""
    data = resp.data
    return data["results"] if isinstance(data, dict) and "results" in data else data


class CannedNoteScopeApiTests(TestCase):
    """Canned responses carry a scope (personal / workspace / project). Shared
    helpdesk-pinned notes are visible only to MEMBERS of that helpdesk; org-wide
    shared notes (null helpdesk) stay visible to every agent; personal notes stay
    private to their owner."""

    def setUp(self):
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership

        _seed_min()
        self.proj = _project("IT", "incident")
        self.hr_proj = _project("HR", "incident")
        self.agent = User.objects.create_user(username="agentA", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.agent_b = User.objects.create_user(username="agentB", password="x")
        RoleAssignment.objects.create(user=self.agent_b, role=SystemRole.objects.get(code="agent"))
        # agentA + agentB staff the IT helpdesk; agentC staffs HR only.
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=self.agent)
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=self.agent_b)
        self.agent_c = User.objects.create_user(username="agentC", password="x")
        RoleAssignment.objects.create(user=self.agent_c, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.hr_proj.helpdesk_id, user=self.agent_c)
        self.sup = User.objects.create_user(username="sup", password="x")
        RoleAssignment.objects.create(user=self.sup, role=SystemRole.objects.get(code="supervisor"))
        self.client = APIClient()
        self.client.force_authenticate(self.agent)

    def _create(self, **body):
        from django.urls import reverse

        body.setdefault("title", "Snippet")
        body.setdefault("body_html", "<p>Hi</p>")
        return self.client.post(reverse("itsm-canned-note-list"), body, format="json")

    def test_project_scope_requires_project(self):
        resp = self._create(scope="project")
        self.assertEqual(resp.status_code, 400)

    def test_project_scope_derives_helpdesk_and_shares(self):
        resp = self._create(scope="project", project=str(self.proj.id))
        self.assertEqual(resp.status_code, 201, getattr(resp, "data", None))
        self.assertEqual(resp.data["scope"], "project")
        self.assertTrue(resp.data["is_shared"])
        # DRF holds the raw UUID in resp.data (JSON-rendered to a string on the wire).
        self.assertEqual(str(resp.data["helpdesk"]), str(self.proj.helpdesk_id))
        self.assertEqual(resp.data["scope_label"], "Project")

    def test_personal_scope_is_private(self):
        resp = self._create(scope="personal")
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.data["is_shared"])
        self.assertIsNone(resp.data["helpdesk"])
        self.assertIsNone(resp.data["project"])

    def test_workspace_scope_allows_null_helpdesk(self):
        resp = self._create(scope="workspace")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.data["is_shared"])
        self.assertEqual(resp.data["scope_label"], "Workspace")

    def test_personal_note_hidden_from_other_agents(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        mine = self._create(scope="personal")
        self.assertEqual(mine.status_code, 201)
        note_id = mine.data["id"]

        own_ids = [n["id"] for n in _list_items(self.client.get(reverse("itsm-canned-note-list")))]
        self.assertEqual(own_ids.count(note_id), 1)  # owner sees it exactly once

        other = APIClient()
        other.force_authenticate(self.agent_b)
        other_ids = [n["id"] for n in _list_items(other.get(reverse("itsm-canned-note-list")))]
        self.assertNotIn(note_id, other_ids)

    def test_helpdesk_shared_note_visible_to_members(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        shared = self._create(scope="project", project=str(self.proj.id))  # IT-pinned
        note_id = shared.data["id"]
        other = APIClient()
        other.force_authenticate(self.agent_b)  # also staffs IT
        other_ids = [n["id"] for n in _list_items(other.get(reverse("itsm-canned-note-list")))]
        self.assertIn(note_id, other_ids)

    def test_helpdesk_shared_note_hidden_from_non_member(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        shared = self._create(scope="project", project=str(self.proj.id))  # IT-pinned
        note_id = shared.data["id"]
        other = APIClient()
        other.force_authenticate(self.agent_c)  # staffs HR only
        ids = [n["id"] for n in _list_items(other.get(reverse("itsm-canned-note-list")))]
        self.assertNotIn(note_id, ids)
        # A forged ?helpdesk=<IT> can't widen scope back to the foreign note.
        forced = other.get(reverse("itsm-canned-note-list"), {"helpdesk": str(self.proj.helpdesk_id)})
        self.assertNotIn(note_id, [n["id"] for n in _list_items(forced)])

    def test_org_wide_note_visible_to_every_agent(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        shared = self._create(scope="workspace")  # null helpdesk = org-wide
        note_id = shared.data["id"]
        other = APIClient()
        other.force_authenticate(self.agent_c)  # HR-only agent still sees org-wide
        ids = [n["id"] for n in _list_items(other.get(reverse("itsm-canned-note-list")))]
        self.assertIn(note_id, ids)

    def test_agent_cannot_delete_supervisor_can(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        created = self._create(scope="workspace")
        nid = created.data["id"]
        self.assertEqual(
            self.client.delete(reverse("itsm-canned-note-detail", args=[nid])).status_code, 403)
        sup = APIClient()
        sup.force_authenticate(self.sup)
        self.assertEqual(
            sup.delete(reverse("itsm-canned-note-detail", args=[nid])).status_code, 204)


class PortalRequestDetailApiTests(TestCase):
    """The portal request-detail returns the ticket plus its portal_visible field
    layout + resolved values; non-portal fields never reach the requestor, and a
    user_picker is resolved to a name (never a bare id)."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.proj = _project("IT", "incident")
        self.requestor = User.objects.create_user(
            username="req", password="x", full_name="Req User")
        RoleAssignment.objects.create(
            user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.client = APIClient()
        self.client.force_authenticate(self.requestor)
        self.ticket = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="Need laptop", description_html="<p>Broke</p>",
            priority="p2", requestor=self.requestor, apply_routing=False)

    def _add_field(self, key, name, field_type, portal_visible):
        from apps.itsm_core.models import FieldDefinition, FieldLayout, FieldLayoutItem

        fd = FieldDefinition.objects.create(
            project=self.proj, key=key, name=name, field_type=field_type)
        layout = FieldLayout.objects.get(project=self.proj, ticket_type__isnull=True)
        FieldLayoutItem.objects.create(
            layout=layout, field=fd, sort_order=900, is_mandatory=False, is_hidden=False,
            portal_visible=portal_visible, section="Details", region="main", width="full")
        return fd

    def _detail(self):
        from django.urls import reverse

        return self.client.get(reverse("itsm-portal-request-detail", args=[self.ticket.ticket_number]))

    def test_portal_visible_custom_field_value_shown(self):
        from apps.itsm_core.services import fields as field_service

        self._add_field("extra", "Extra Info", "text", True)
        field_service.set_values(self.ticket, {"extra": "hello"})
        resp = self._detail()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["field_values"].get("extra"), "hello")
        self.assertEqual(resp.data["ticket_type_name"], self.ticket.ticket_type.name)
        keys = {it["field_key"] for it in resp.data["layout"]["items"]}
        self.assertIn("extra", keys)
        # A portal-visible standard column carries the ticket's value…
        self.assertEqual(resp.data["field_values"].get("summary"), "Need laptop")
        # …but Priority is agent-only on Incidents, so it is not exposed to the portal.
        self.assertNotIn("priority", resp.data["field_values"])

    def test_non_portal_visible_field_hidden(self):
        from apps.itsm_core.services import fields as field_service

        self._add_field("secret", "Secret", "text", False)
        field_service.set_values(self.ticket, {"secret": "shh"})
        resp = self._detail()
        keys = {it["field_key"] for it in resp.data["layout"]["items"]}
        self.assertNotIn("secret", keys)
        self.assertNotIn("secret", resp.data["field_values"])
        # The field definitions payload must not leak non-portal-visible field metadata.
        self.assertNotIn("secret", {f["key"] for f in resp.data["fields"]})

    def test_user_picker_resolves_to_name_not_id(self):
        from apps.itsm_core.services import fields as field_service

        approver = User.objects.create_user(
            username="appr", password="x", full_name="Ann Approver")
        self._add_field("approver", "Approver", "user_picker", True)
        field_service.set_values(self.ticket, {"approver": approver.id})
        resp = self._detail()
        self.assertEqual(resp.data["field_values"].get("approver"), "Ann Approver")

    def test_internal_columns_not_leaked(self):
        resp = self._detail()
        keys = {it["field_key"] for it in resp.data["layout"]["items"]}
        for hidden in ("assignee", "assigned_group", "requestor", "source"):
            self.assertNotIn(hidden, keys)
            self.assertNotIn(hidden, resp.data["field_values"])

    def test_other_users_ticket_404(self):
        from django.urls import reverse

        other = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="Theirs", priority="p4", apply_routing=False)
        self.assertEqual(
            self.client.get(
                reverse("itsm-portal-request-detail", args=[other.ticket_number])).status_code, 404)


class PortalAllowedSeedTests(TestCase):
    """The Reopen transitions are seeded ``portal_allowed`` (and only those)."""

    def setUp(self):
        _seed_min()

    def _wf(self, name):
        from apps.itsm_workflows.models import Workflow
        return Workflow.objects.get(name=name)

    def test_incident_reopen_is_portal_allowed(self):
        reopen = Transition.objects.get(workflow=self._wf("Default Incident Workflow"), name="Reopen")
        self.assertTrue(reopen.portal_allowed)

    def test_request_reopen_seeded_and_portal_allowed(self):
        reopen = Transition.objects.get(workflow=self._wf("Default Request Workflow"), name="Reopen")
        self.assertTrue(reopen.portal_allowed)
        self.assertEqual(reopen.from_status.key, "fulfilled")
        self.assertEqual(reopen.to_status.key, "in_progress")

    def test_only_reopen_is_portal_allowed(self):
        self.assertFalse(Transition.objects.exclude(name="Reopen").filter(portal_allowed=True).exists())

    def test_seed_is_idempotent(self):
        before = Transition.objects.count()
        seed_workflows()
        self.assertEqual(Transition.objects.count(), before)
        self.assertEqual(Transition.objects.filter(name="Reopen", portal_allowed=True).count(), 2)

    def test_reopen_prompts_optional_reason(self):
        reopen = Transition.objects.get(workflow=self._wf("Default Incident Workflow"), name="Reopen")
        self.assertTrue(reopen.note_prompt)
        self.assertFalse(reopen.note_required)
        self.assertEqual(reopen.note_heading, "Reason to reopen")


class EngineAvailableTransitionsPortalTests(TestCase):
    """engine.available_transitions(..., portal_only=True) narrows to portal_allowed."""

    def setUp(self):
        _seed_min()
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        inc = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=inc, ticket_type=inc.ticket_types.get(key="incident"),
            summary="T", priority="p2", user=self.agent, apply_routing=False,
        )
        for name in ("Assign", "Start Progress", "Resolve"):
            tr = Transition.objects.get(workflow=self.ticket.workflow, name=name)
            engine.transition(self.ticket, tr, self.agent, fields={"resolution": "x"}, comment="done")
        self.ticket.refresh_from_db()

    def test_portal_only_returns_reopen_only(self):
        items = engine.available_transitions(self.ticket, self.agent, portal_only=True)
        self.assertEqual([t.name for t in items], ["Reopen"])

    def test_default_includes_agent_transitions(self):
        names = {t.name for t in engine.available_transitions(self.ticket, self.agent)}
        # From "resolved": Close + Reopen are both available to the agent.
        self.assertIn("Close", names)
        self.assertIn("Reopen", names)


class PortalTransitionWatcherAttachmentApiTests(TestCase):
    """Portal reopen + watcher (by email) + attachment endpoints, ownership-clamped."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.inc = _project("IT", "incident")
        self.requestor = User.objects.create_user(username="req", password="x", email="req@ex.com")
        RoleAssignment.objects.create(user=self.requestor, role=SystemRole.objects.get(code="requestor"))
        self.colleague = User.objects.create_user(
            username="cole", password="x", email="cole@ex.com", full_name="Cole League")
        self.agent = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        self.client = APIClient()
        self.client.force_authenticate(self.requestor)

    def _resolved_ticket(self):
        t = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="Printer down", priority="p2", requestor=self.requestor,
            user=self.requestor, apply_routing=False,
        )
        for name in ("Assign", "Start Progress", "Resolve"):
            tr = Transition.objects.get(workflow=t.workflow, name=name)
            engine.transition(t, tr, self.agent, fields={"resolution": "x"}, comment="done")
        t.refresh_from_db()
        return t

    # ── transitions ──────────────────────────────────────────────────────────
    def test_portal_available_transitions_only_portal_allowed(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        resp = self.client.get(
            reverse("itsm-portal-request-available-transitions", args=[t.ticket_number]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([x["name"] for x in resp.data], ["Reopen"])

    def test_portal_reopen_happy_path(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        reopen = Transition.objects.get(workflow=t.workflow, name="Reopen")
        resp = self.client.post(
            reverse("itsm-portal-request-transition", args=[t.ticket_number]),
            {"transition_id": str(reopen.id), "comment": "still broken"}, format="json")
        self.assertEqual(resp.status_code, 200)
        t.refresh_from_db()
        self.assertEqual(t.status.key, "in_progress")
        self.assertEqual(t.reopen_count, 1)
        # the note landed as a PUBLIC comment, never private
        self.assertTrue(t.comments.filter(visibility="public").exists())
        self.assertFalse(t.comments.filter(visibility="private").exists())

    def test_portal_transition_rejects_non_portal_transition(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        close = Transition.objects.get(workflow=t.workflow, name="Close")
        resp = self.client.post(
            reverse("itsm-portal-request-transition", args=[t.ticket_number]),
            {"transition_id": str(close.id)}, format="json")
        self.assertEqual(resp.status_code, 404)
        t.refresh_from_db()
        self.assertEqual(t.status.key, "resolved")  # unchanged

    def test_portal_transition_cross_owner_404(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        t = self._resolved_ticket()
        other = User.objects.create_user(username="req2", password="x", email="r2@ex.com")
        RoleAssignment.objects.create(user=other, role=SystemRole.objects.get(code="requestor"))
        c = APIClient()
        c.force_authenticate(other)
        reopen = Transition.objects.get(workflow=t.workflow, name="Reopen")
        resp = c.post(reverse("itsm-portal-request-transition", args=[t.ticket_number]),
                      {"transition_id": str(reopen.id)}, format="json")
        self.assertEqual(resp.status_code, 404)

    # ── watchers ─────────────────────────────────────────────────────────────
    def test_portal_add_watcher_by_email(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        resp = self.client.post(
            reverse("itsm-portal-request-watchers", args=[t.ticket_number]),
            {"email": "cole@ex.com"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["name"], "Cole League")
        self.assertNotIn("email", resp.data)  # never leak the email back
        self.assertTrue(t.watchers.filter(user=self.colleague).exists())

    def test_portal_add_watcher_unknown_email_404_no_create(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        resp = self.client.post(
            reverse("itsm-portal-request-watchers", args=[t.ticket_number]),
            {"email": "nobody@nowhere.com"}, format="json")
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(User.objects.filter(email="nobody@nowhere.com").exists())

    def test_portal_add_watcher_idempotent(self):
        from django.urls import reverse

        t = self._resolved_ticket()
        url = reverse("itsm-portal-request-watchers", args=[t.ticket_number])
        self.client.post(url, {"email": "cole@ex.com"}, format="json")
        self.client.post(url, {"email": "cole@ex.com"}, format="json")
        self.assertEqual(t.watchers.filter(user=self.colleague).count(), 1)

    def test_portal_watcher_list_hides_email(self):
        from django.urls import reverse

        from .models import Watcher

        t = self._resolved_ticket()
        Watcher.objects.create(ticket=t, user=self.colleague)
        resp = self.client.get(reverse("itsm-portal-request-watchers", args=[t.ticket_number]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["name"], "Cole League")
        self.assertNotIn("email", resp.data[0])

    def test_portal_remove_watcher_via_post(self):
        from django.urls import reverse

        from .models import Watcher

        t = self._resolved_ticket()
        w = Watcher.objects.create(ticket=t, user=self.colleague)
        resp = self.client.post(
            reverse("itsm-portal-request-remove-watcher", args=[t.ticket_number]),
            {"watcher_id": str(w.id)}, format="json")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(t.watchers.filter(pk=w.id).exists())

    # ── attachments ──────────────────────────────────────────────────────────
    def test_portal_retrieve_includes_attachments_and_watchers(self):
        from django.urls import reverse

        from .models import TicketAttachment, Watcher

        t = self._resolved_ticket()
        TicketAttachment.objects.create(
            ticket=t, file="itsm_attachments/ticket/x/a.png", original_name="a.png",
            size_bytes=3, content_type="image/png")
        Watcher.objects.create(ticket=t, user=self.colleague)
        resp = self.client.get(reverse("itsm-portal-request-detail", args=[t.ticket_number]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["attachments"]), 1)
        self.assertEqual(resp.data["attachments"][0]["original_name"], "a.png")
        self.assertEqual(len(resp.data["watchers"]), 1)
        self.assertEqual(resp.data["watchers"][0]["name"], "Cole League")


class AgentWatcherApiTests(TestCase):
    """Agent watcher endpoints (self-toggle + add-arbitrary + list) still work."""

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.inc = _project("IT", "incident")
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.other = User.objects.create_user(username="o", password="x", full_name="Other Person")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.t = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.first(),
            summary="T", priority="p3", apply_routing=False)

    def test_self_watch_toggle(self):
        from django.urls import reverse

        url = reverse("itsm-ticket-watch", args=[self.t.ticket_number])
        self.assertEqual(self.client.post(url).status_code, 201)
        self.assertEqual(self.t.watchers.count(), 1)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(self.t.watchers.count(), 0)

    def test_add_arbitrary_watcher_then_list(self):
        from django.urls import reverse

        resp = self.client.post(reverse("itsm-watcher-list"),
                                {"ticket": str(self.t.id), "user_id": self.other.id}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["user"]["full_name"], "Other Person")
        lst = self.client.get(reverse("itsm-ticket-watchers", args=[self.t.ticket_number]))
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.data), 1)

    def test_remove_arbitrary_watcher_by_id(self):
        from django.urls import reverse

        from .models import Watcher

        w = Watcher.objects.create(ticket=self.t, user=self.other)
        resp = self.client.delete(reverse("itsm-watcher-detail", args=[str(w.id)]))
        self.assertIn(resp.status_code, (204, 200))
        self.assertFalse(self.t.watchers.filter(pk=w.id).exists())


class TicketLinkApiTests(TestCase):
    """Ticket linking via /tickets/{id}/links/: add/view/remove, inverse display on
    the far end (incident↔request too), cross-helpdesk 403, audit events, idempotent
    re-link, and helpdesk scoping on the raw /ticket-links/ list."""

    def setUp(self):
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership

        _seed_min()
        self.it_inc = _project("IT", "incident")
        self.it_req = _project("IT", "service_request")
        self.hr_inc = _project("HR", "incident")
        # agentA staffs IT only (member + project access on both IT projects, so
        # they can open and cross-link IT incidents and requests); agentC staffs HR.
        self.agent = User.objects.create_user(username="agentA", password="x")
        RoleAssignment.objects.create(user=self.agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.it_inc.helpdesk_id, user=self.agent)
        for p in (self.it_inc, self.it_req):
            ProjectMembership.objects.create(project=p, user=self.agent)
        self.agent_c = User.objects.create_user(username="agentC", password="x")
        RoleAssignment.objects.create(user=self.agent_c, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.hr_inc.helpdesk_id, user=self.agent_c)
        self.client = APIClient()
        self.client.force_authenticate(self.agent)

    def _mk(self, project, **kw):
        kw.setdefault("priority", "p3")
        return ticket_service.create_ticket(
            project=project, ticket_type=project.ticket_types.first(),
            summary=kw.pop("summary", "T"), apply_routing=False, user=self.agent, **kw,
        )

    def _links_url(self, ticket):
        from django.urls import reverse
        return reverse("itsm-ticket-links", args=[str(ticket.id)])

    def _unlink_url(self, ticket):
        from django.urls import reverse
        return reverse("itsm-ticket-unlink", args=[str(ticket.id)])

    def test_add_link_incident_to_request_returns_normalized_row(self):
        a, b = self._mk(self.it_inc), self._mk(self.it_req)
        resp = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "blocks"}, format="json")
        self.assertEqual(resp.status_code, 201, getattr(resp, "data", None))
        self.assertEqual(resp.data["direction"], "out")
        self.assertEqual(resp.data["link_type"], "blocks")
        self.assertEqual(resp.data["other_id"], str(b.id))
        self.assertEqual(resp.data["other_number"], b.ticket_number)

    def test_link_shows_inverse_on_target(self):
        a, b = self._mk(self.it_inc), self._mk(self.it_req)
        self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "blocks"}, format="json")
        rows_a = self.client.get(self._links_url(a)).data
        self.assertEqual(len(rows_a), 1)
        self.assertEqual((rows_a[0]["direction"], rows_a[0]["link_type"]), ("out", "blocks"))
        # The same single row renders on the target as the inverse relationship.
        rows_b = self.client.get(self._links_url(b)).data
        self.assertEqual(len(rows_b), 1)
        self.assertEqual(rows_b[0]["direction"], "in")
        self.assertEqual(rows_b[0]["link_type"], "blocked_by")
        self.assertEqual(rows_b[0]["link_type_display"], "is blocked by")
        self.assertEqual(rows_b[0]["other_number"], a.ticket_number)

    def test_add_link_writes_audit_event(self):
        from apps.itsm_core.models import AuditEvent
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(
                self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
        ev = AuditEvent.objects.get(ticket=a, action="link_added")
        self.assertEqual(ev.payload["target_number"], b.ticket_number)
        self.assertEqual(ev.payload["link_type"], "relates_to")

    def test_remove_link_deletes_and_audits(self):
        from apps.itsm_core.models import AuditEvent

        from .models import TicketLink
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        created = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post(self._unlink_url(a), {"link_id": created.data["id"]}, format="json")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TicketLink.objects.filter(pk=created.data["id"]).exists())
        self.assertTrue(AuditEvent.objects.filter(ticket=a, action="link_removed").exists())
        self.assertEqual(self.client.get(self._links_url(a)).data, [])

    def test_remove_link_from_target_end(self):
        from .models import TicketLink
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        created = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "blocks"}, format="json")
        resp = self.client.post(self._unlink_url(b), {"link_id": created.data["id"]}, format="json")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TicketLink.objects.filter(pk=created.data["id"]).exists())

    def test_self_link_rejected(self):
        a = self._mk(self.it_inc)
        resp = self.client.post(
            self._links_url(a), {"target_ticket": str(a.id), "link_type": "relates_to"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_invalid_link_type_rejected(self):
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        resp = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "bogus"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_cross_helpdesk_target_is_403(self):
        a, hr = self._mk(self.it_inc), self._mk(self.hr_inc)
        resp = self.client.post(
            self._links_url(a), {"target_ticket": str(hr.id), "link_type": "relates_to"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_relink_is_idempotent(self):
        from apps.itsm_core.models import AuditEvent

        from .models import TicketLink
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        with self.captureOnCommitCallbacks(execute=True):
            r1 = self.client.post(
                self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
            r2 = self.client.post(
                self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
        self.assertEqual(r1.data["id"], r2.data["id"])
        self.assertEqual(TicketLink.objects.filter(source_ticket=a, target_ticket=b).count(), 1)
        self.assertEqual(AuditEvent.objects.filter(ticket=a, action="link_added").count(), 1)

    def test_relink_after_removal_resurrects(self):
        from .models import TicketLink
        a, b = self._mk(self.it_inc), self._mk(self.it_inc)
        r1 = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
        self.client.post(self._unlink_url(a), {"link_id": r1.data["id"]}, format="json")
        r2 = self.client.post(
            self._links_url(a), {"target_ticket": str(b.id), "link_type": "relates_to"}, format="json")
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(TicketLink.objects.filter(source_ticket=a, target_ticket=b).count(), 1)

    def test_raw_viewset_list_is_helpdesk_scoped(self):
        from django.urls import reverse
        from rest_framework.test import APIClient

        # Two HR tickets linked together; agentA (IT only) must not see the link.
        hr_a, hr_b = self._mk(self.hr_inc), self._mk(self.hr_inc)
        ticket_service.link_tickets(source=hr_a, target=hr_b, link_type="relates_to", user=self.agent_c)
        mine = _list_items(self.client.get(reverse("itsm-ticket-link-list")))
        self.assertEqual([row["id"] for row in mine], [])
        other = APIClient()
        other.force_authenticate(self.agent_c)  # staffs HR → sees it
        theirs = _list_items(other.get(reverse("itsm-ticket-link-list")))
        self.assertEqual(len(theirs), 1)


# ── ITIL: Impact Assessment, Priority Matrix, Resolution Details ──────────────

class ITILPriorityMatrixTests(TestCase):
    """compute_priority + auto-calc (overridable) in ticket_service."""

    def setUp(self):
        _seed_min()
        self.user = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.user, role=SystemRole.objects.get(code="agent"))
        self.inc = _project("IT", "incident")

    def _mk(self, **kw):
        return ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="T", user=self.user, apply_routing=False, **kw,
        )

    def test_compute_priority_default_matrix(self):
        from .services.priority import compute_priority
        self.assertEqual(compute_priority(self.inc, "high", "high"), "p1")
        self.assertEqual(compute_priority(self.inc, "high", "medium"), "p2")
        self.assertEqual(compute_priority(self.inc, "medium", "medium"), "p3")
        self.assertEqual(compute_priority(self.inc, "low", "low"), "p4")

    def test_compute_priority_blank_returns_none(self):
        from .services.priority import compute_priority
        self.assertIsNone(compute_priority(self.inc, "", "high"))
        self.assertIsNone(compute_priority(self.inc, "high", ""))

    def test_compute_priority_custom_matrix(self):
        from .services.priority import compute_priority
        self.inc.priority_matrix = {"low": {"low": "p1"}}
        self.inc.save(update_fields=["priority_matrix"])
        self.assertEqual(compute_priority(self.inc, "low", "low"), "p1")
        # unspecified cell falls back to the stored matrix's own value (None here)
        # — the ticket keeps its current priority in that case.

    def test_update_recomputes_priority_on_impact_urgency(self):
        t = self._mk(priority="p4")
        ticket_service.update_ticket(ticket=t, user=self.user, impact="high")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p4")  # urgency still blank → no recompute
        ticket_service.update_ticket(ticket=t, user=self.user, urgency="high")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p1")  # high × high

    def test_explicit_priority_override_respected(self):
        t = self._mk(priority="p4", impact="high", urgency="high")
        # Change impact but ALSO pass an explicit priority in the same edit → override wins.
        ticket_service.update_ticket(ticket=t, user=self.user, impact="medium", priority="p4")
        t.refresh_from_db()
        self.assertEqual(t.priority, "p4")

    def test_create_stores_impact_assessment_columns(self):
        t = self._mk(business_impact="Site down", users_affected=50,
                     service_downtime=True, major_incident=True)
        t.refresh_from_db()
        self.assertEqual(t.business_impact, "Site down")
        self.assertEqual(t.users_affected, 50)
        self.assertTrue(t.service_downtime)
        self.assertTrue(t.major_incident)


class ITILResolutionTests(TestCase):
    """Resolve screen capture via the workflow engine."""

    def setUp(self):
        _seed_min()
        self.user = User.objects.create_user(username="ag", password="x")
        RoleAssignment.objects.create(user=self.user, role=SystemRole.objects.get(code="agent"))
        self.inc = _project("IT", "incident")
        self.ticket = ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="T", user=self.user, apply_routing=False,
        )
        self.wf = self.ticket.workflow

    def _advance_to_in_progress(self):
        for name in ("Assign", "Start Progress"):
            engine.transition(self.ticket, Transition.objects.get(workflow=self.wf, name=name), self.user)

    def test_seeded_resolve_has_resolution_screen(self):
        resolve = Transition.objects.get(workflow=self.wf, name="Resolve")
        self.assertIsNotNone(resolve.screen_id)
        self.assertEqual(resolve.screen.name, "Resolution Details")
        keys = set(resolve.screen.fields.values_list("field_key", flat=True))
        self.assertEqual(keys, {"resolution_code", "root_cause",
                                "workaround_provided", "resolution_notes"})
        self.assertTrue(any(pf.get("type") == "set_resolution_details"
                            for pf in resolve.post_functions))

    def test_resolve_captures_resolution_details(self):
        self._advance_to_in_progress()
        resolve = Transition.objects.get(workflow=self.wf, name="Resolve")
        engine.transition(self.ticket, resolve, self.user, comment="done", fields={
            "resolution": "Fixed", "resolution_code": "fixed", "root_cause": "bad cable",
            "workaround_provided": True, "resolution_notes": "Replaced cable",
        })
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.resolution_code, "fixed")
        self.assertEqual(self.ticket.root_cause, "bad cable")
        self.assertTrue(self.ticket.workaround_provided)
        self.assertEqual(self.ticket.resolution_notes, "Replaced cable")

    def test_mandatory_screen_field_blocks_resolve(self):
        from apps.itsm_workflows.models import TransitionScreenField
        resolve = Transition.objects.get(workflow=self.wf, name="Resolve")
        TransitionScreenField.objects.filter(
            screen=resolve.screen, field_key="resolution_code"
        ).update(is_mandatory=True)
        self._advance_to_in_progress()
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(self.ticket, resolve, self.user, comment="done", fields={})
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("resolution_code", ctx.exception.errors)

    def test_reopen_clears_resolution_details(self):
        self._advance_to_in_progress()
        engine.transition(self.ticket, Transition.objects.get(workflow=self.wf, name="Resolve"),
                          self.user, comment="done", fields={"resolution_code": "fixed",
                                                             "root_cause": "x"})
        engine.transition(self.ticket, Transition.objects.get(workflow=self.wf, name="Reopen"),
                          self.user, comment="reopen")
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.resolution_code, "")
        self.assertEqual(self.ticket.root_cause, "")


class ITILLayoutSeedTests(TestCase):
    """ensure_project_layout places the ITIL sections on Incident layouts only."""

    def setUp(self):
        _seed_min()

    def test_incident_layout_has_impact_assessment_and_resolution(self):
        from apps.itsm_core.models import FieldLayout
        inc = _project("IT", "incident")
        layout = FieldLayout.objects.get(project=inc, ticket_type__isnull=True)
        sections = set(layout.items.values_list("section", flat=True))
        self.assertIn("Impact Assessment", sections)
        self.assertIn("Resolution Details", sections)
        ia = layout.items.filter(section="Impact Assessment")
        self.assertTrue(all(not it.portal_visible for it in ia))  # agent-only
        self.assertTrue(all(not it.is_mandatory for it in ia))     # non-mandatory
        ia_keys = set(ia.values_list("field__key", flat=True))
        self.assertTrue({"impact", "urgency", "priority", "users_affected",
                         "service_downtime", "major_incident", "business_impact"} <= ia_keys)

    def test_priority_relocated_not_duplicated(self):
        from apps.itsm_core.models import FieldLayout
        inc = _project("IT", "incident")
        layout = FieldLayout.objects.get(project=inc, ticket_type__isnull=True)
        pri = layout.items.filter(field__key="priority")
        self.assertEqual(pri.count(), 1)
        self.assertEqual(pri.first().section, "Impact Assessment")

    def test_request_layout_has_no_impact_assessment(self):
        from apps.itsm_core.models import FieldLayout
        req = _project("IT", "service_request")
        layout = FieldLayout.objects.get(project=req, ticket_type__isnull=True)
        sections = set(layout.items.values_list("section", flat=True))
        self.assertNotIn("Impact Assessment", sections)
        self.assertNotIn("Resolution Details", sections)

    def test_ensure_project_layout_idempotent(self):
        from apps.itsm_core.models import FieldLayout, FieldLayoutItem
        from apps.itsm_core.seed import ensure_project_layout
        inc = _project("IT", "incident")
        layout = FieldLayout.objects.get(project=inc, ticket_type__isnull=True)
        before = FieldLayoutItem.objects.filter(layout=layout).count()
        ensure_project_layout(inc)
        after = FieldLayoutItem.objects.filter(layout=layout).count()
        self.assertEqual(before, after)


class ITILResolveApiTests(TestCase):
    """available-transitions carries resolved screen fields; inline PATCH recomputes."""

    def setUp(self):
        from rest_framework.test import APIClient
        _seed_min()
        self.proj = _project("IT", "incident")
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.ticket = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.get(key="incident"),
            summary="T", user=self.admin, apply_routing=False,
        )
        for name in ("Assign", "Start Progress"):
            engine.transition(self.ticket, Transition.objects.get(
                workflow=self.ticket.workflow, name=name), self.admin)

    def test_available_transitions_include_resolve_screen_fields(self):
        from django.urls import reverse
        url = reverse("itsm-ticket-available-transitions", args=[str(self.ticket.id)])
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        resolve = next(t for t in resp.data if t["name"] == "Resolve")
        sf = {f["field_key"]: f for f in resolve["screen_fields"]}
        self.assertEqual(set(sf), {"resolution_code", "root_cause",
                                   "workaround_provided", "resolution_notes"})
        self.assertEqual(sf["resolution_code"]["field_type"], "dropdown")
        self.assertEqual(sf["resolution_code"]["name"], "Resolution Code")
        self.assertTrue(any(o["value"] == "fixed" for o in sf["resolution_code"]["options"]))

    def test_patch_impact_urgency_recomputes_priority(self):
        from django.urls import reverse
        url = reverse("itsm-ticket-detail", args=[str(self.ticket.id)])
        self.client.patch(url, {"impact": "high"}, format="json")
        resp = self.client.patch(url, {"urgency": "high"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["priority"], "p1")

    def test_patch_explicit_priority_override(self):
        from django.urls import reverse
        url = reverse("itsm-ticket-detail", args=[str(self.ticket.id)])
        self.client.patch(url, {"impact": "high"}, format="json")
        self.client.patch(url, {"urgency": "high"}, format="json")
        resp = self.client.patch(url, {"priority": "p4"}, format="json")
        self.assertEqual(resp.data["priority"], "p4")


class ITILMigrationBackfillTests(TestCase):
    """The itsm_core 0006 data migration backfills the ITIL sections onto an
    EXISTING Incident project (the real-tenant `migrate_schemas --tenant` path,
    where projects already exist before the migration runs)."""

    def setUp(self):
        _seed_min()

    def test_migration_forward_backfills_existing_incident_layout(self):
        from importlib import import_module

        from django.apps import apps as global_apps

        from apps.itsm_core.models import FieldLayout, FieldLayoutItem

        inc = _project("IT", "incident")
        layout = FieldLayout.objects.get(project=inc, ticket_type__isnull=True)
        itil_keys = [
            "impact", "urgency", "business_impact", "users_affected", "service_downtime",
            "major_incident", "resolution_code", "root_cause", "workaround_provided", "resolution_notes",
        ]
        # Simulate a pre-upgrade layout: drop the ITIL items and restore priority to the sidebar.
        FieldLayoutItem.objects.filter(layout=layout, field__key__in=itil_keys).delete()
        FieldLayoutItem.objects.filter(layout=layout, field__key="priority").update(
            section="Details", region="sidebar", width="full", portal_visible=True, is_mandatory=True)

        mod = import_module("apps.itsm_core.migrations.0006_itil_incident_fields")
        mod.forward(global_apps, None)  # forward doesn't use schema_editor

        sections = set(layout.items.values_list("section", flat=True))
        self.assertIn("Impact Assessment", sections)
        self.assertIn("Resolution Details", sections)
        pri = layout.items.filter(field__key="priority")
        self.assertEqual(pri.count(), 1)
        self.assertEqual(pri.first().section, "Impact Assessment")
        self.assertFalse(pri.first().portal_visible)
        # Idempotent: a second run adds nothing.
        before = layout.items.count()
        mod.forward(global_apps, None)
        self.assertEqual(layout.items.count(), before)


class ITILFieldCatalogScopingTests(TestCase):
    """The ITIL Incident fields are hidden from non-Incident projects' Fields catalog
    (config.incident_only + FieldDefinitionViewSet.get_queryset), while global standard
    fields like `priority` stay visible everywhere."""

    def setUp(self):
        from rest_framework.test import APIClient
        _seed_min()
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _keys(self, project):
        from django.urls import reverse
        resp = self.client.get(reverse("itsm-field-definition-list"), {"project": str(project.id)})
        self.assertEqual(resp.status_code, 200)
        rows = resp.data["results"] if isinstance(resp.data, dict) and "results" in resp.data else resp.data
        return {f["key"] for f in rows}

    def test_itil_fields_hidden_on_request_project(self):
        itil = {"impact", "urgency", "business_impact", "users_affected", "service_downtime",
                "major_incident", "resolution_code", "root_cause", "workaround_provided",
                "resolution_notes"}
        inc_keys = self._keys(_project("IT", "incident"))
        req_keys = self._keys(_project("IT", "service_request"))
        # Incident project's catalog exposes the ITIL fields…
        self.assertTrue(itil <= inc_keys, f"missing on incident: {itil - inc_keys}")
        # …the Request project's catalog does not.
        self.assertEqual(itil & req_keys, set(), f"leaked to request: {itil & req_keys}")
        # Global standard fields stay visible on both.
        self.assertIn("priority", inc_keys)
        self.assertIn("priority", req_keys)
        self.assertIn("summary", req_keys)


def _wf_status(project, category=None):
    """A status in the project's default workflow (optionally by category key)."""
    from apps.itsm_workflows.models import Status

    qs = Status.objects.filter(workflow=project.default_workflow, is_deleted=False)
    if category:
        qs = qs.filter(category__key=category)
    return qs.order_by("sort_order").first()


class TicketMoveServiceTests(TestCase):
    """Service-level: re-home a ticket to another project in the same helpdesk."""

    def setUp(self):
        _seed_min()
        self.user = User.objects.create_user(username="mover", password="x")
        RoleAssignment.objects.create(user=self.user, role=SystemRole.objects.get(code="supervisor"))
        self.src = _project("IT", "incident")
        self.dst = _project("IT", "service_request")
        self.ticket = ticket_service.create_ticket(
            project=self.src, ticket_type=self.src.ticket_types.first(),
            summary="Wrong project", priority="p2", apply_routing=False, user=self.user,
        )

    def _move(self, **kw):
        params = dict(
            ticket=self.ticket, target_project=self.dst,
            target_ticket_type=self.dst.ticket_types.first(),
            target_status=_wf_status(self.dst), user=self.user,
        )
        params.update(kw)
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.move_ticket(**params)

    def test_rekey_and_repoint(self):
        old = self.ticket.ticket_number
        moved = self._move()
        moved.refresh_from_db()
        self.assertEqual(moved.project_id, self.dst.id)
        self.assertNotEqual(moved.ticket_number, old)
        self.assertTrue(moved.ticket_number.startswith(self.dst.key))
        self.assertEqual(moved.workflow_id, self.dst.default_workflow_id)
        self.assertEqual(moved.ticket_type.project_id, self.dst.id)
        from apps.itsm_tickets.models import TicketSequence
        # Source sequence is never touched — the vacated number is never reissued.
        self.assertEqual(TicketSequence.objects.get(project=self.src).last_number, 1)

    def test_writes_alias(self):
        old = self.ticket.ticket_number
        moved = self._move()
        from apps.itsm_tickets.models import TicketNumberAlias
        alias = TicketNumberAlias.objects.get(old_number=old)
        self.assertEqual(alias.ticket_id, moved.id)
        self.assertEqual(alias.new_number, moved.ticket_number)
        self.assertEqual(alias.old_project_id, self.src.id)

    def test_logs_move_event(self):
        from apps.itsm_core.models import AuditEvent
        moved = self._move()
        ev = AuditEvent.objects.filter(ticket=moved, action="ticket_moved").first()
        self.assertIsNotNone(ev)
        self.assertEqual(ev.payload["to_project_key"], self.dst.key)
        self.assertEqual(ev.payload["old_number"], self.ticket.ticket_number)

    def test_same_project_rejected(self):
        with self.assertRaises(ValueError):
            with self.captureOnCommitCallbacks(execute=True):
                ticket_service.move_ticket(
                    ticket=self.ticket, target_project=self.src,
                    target_ticket_type=self.src.ticket_types.first(),
                    target_status=_wf_status(self.src), user=self.user)

    def test_cross_helpdesk_rejected(self):
        other = Project.objects.exclude(helpdesk_id=self.src.helpdesk_id).first()
        with self.assertRaises(ValueError):
            with self.captureOnCommitCallbacks(execute=True):
                ticket_service.move_ticket(
                    ticket=self.ticket, target_project=other,
                    target_ticket_type=other.ticket_types.first(),
                    target_status=_wf_status(other), user=self.user)

    def test_project_field_remapped_and_dropped(self):
        from apps.itsm_core.models import FieldDefinition, FieldOption, FieldValue
        from apps.itsm_core.services import fields as field_service
        for proj in (self.src, self.dst):
            fd = FieldDefinition.objects.create(project=proj, key="location", name="Location",
                                                field_type="dropdown")
            for i, v in enumerate(["delhi", "mumbai"]):
                FieldOption.objects.create(field=fd, value=v, label=v.title(), sort_order=i)
        FieldDefinition.objects.create(project=self.src, key="vendor", name="Vendor", field_type="text")
        field_service.set_values(self.ticket, {"location": "delhi", "vendor": "Acme"}, self.user)
        moved = self._move()
        vals = field_service.get_values(moved)
        self.assertEqual(vals.get("location"), "delhi")   # remapped onto dst's field
        self.assertNotIn("vendor", vals)                  # dropped (no target)
        loc = FieldValue.objects.get(ticket=moved, field__key="location", is_deleted=False)
        self.assertEqual(loc.field.project_id, self.dst.id)

    def test_incompatible_options_dropped(self):
        from apps.itsm_core.models import FieldDefinition, FieldOption
        from apps.itsm_core.services import fields as field_service
        fs = FieldDefinition.objects.create(project=self.src, key="loc", name="Loc", field_type="dropdown")
        FieldOption.objects.create(field=fs, value="delhi", label="Delhi")
        fd = FieldDefinition.objects.create(project=self.dst, key="loc", name="Loc", field_type="dropdown")
        FieldOption.objects.create(field=fd, value="pune", label="Pune")  # different option set
        field_service.set_values(self.ticket, {"loc": "delhi"}, self.user)
        moved = self._move()
        self.assertNotIn("loc", field_service.get_values(moved))  # value invalid in target → dropped

    def test_global_field_untouched(self):
        from apps.itsm_core.models import FieldDefinition
        from apps.itsm_core.services import fields as field_service
        FieldDefinition.objects.create(project=None, key="region", name="Region", field_type="text")
        field_service.set_values(self.ticket, {"region": "APAC"}, self.user)
        moved = self._move()
        self.assertEqual(field_service.get_values(moved).get("region"), "APAC")

    def test_target_category_applied(self):
        from apps.itsm_core.services import fields as field_service
        moved = self._move(target_category=["hardware"])
        self.assertEqual(field_service.get_values(moved).get("category"), ["hardware"])

    def test_priority_recomputed_from_target_matrix(self):
        self.ticket.impact = "high"
        self.ticket.urgency = "high"
        self.ticket.priority = "p4"
        self.ticket.save(update_fields=["impact", "urgency", "priority"])
        self.dst.priority_matrix = {"high": {"high": "p1"}}
        self.dst.save(update_fields=["priority_matrix"])
        moved = self._move()
        moved.refresh_from_db()
        self.assertEqual(moved.priority, "p1")

    def test_group_not_allowed_resets_and_clears_assignee(self):
        import uuid as _uuid
        from apps.itsm_groups.models import Group
        g2 = Group.objects.create(name="Team Two", key="team-two", helpdesk_id=self.src.helpdesk_id)
        self.ticket.assigned_group = g2
        self.ticket.assignee = self.user
        self.ticket.save(update_fields=["assigned_group", "assignee"])
        self.dst.allowed_group_ids = [str(_uuid.uuid4())]  # whitelist that excludes g2
        self.dst.save(update_fields=["allowed_group_ids"])
        moved = self._move()
        moved.refresh_from_db()
        self.assertNotEqual(moved.assigned_group_id, g2.id)
        self.assertIsNone(moved.assignee_id)

    def test_pending_approval_allows_move_cancels_and_starts(self):
        from apps.itsm_approvals.models import ApprovalRequest, ApprovalWorkflow
        aw = ApprovalWorkflow.objects.create(name="Std", project=self.src)
        req = ApprovalRequest.objects.create(ticket=self.ticket, workflow=aw, status="pending")
        # Pass a done status; the pending approval forces the target START status instead.
        moved = self._move(target_status=_wf_status(self.dst, category="done"))
        moved.refresh_from_db()
        self.assertTrue(moved.status.is_initial)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")

    def test_resolved_ticket_does_not_reopen(self):
        self.ticket.status = _wf_status(self.src, category="done")
        self.ticket.resolved_at = timezone.now()
        self.ticket.save(update_fields=["status", "resolved_at"])
        before = self.ticket.reopen_count
        moved = self._move(target_status=_wf_status(self.dst, category="done"))
        moved.refresh_from_db()
        self.assertIsNotNone(moved.resolved_at)
        self.assertEqual(moved.reopen_count, before)

    def test_move_to_non_done_clears_resolved(self):
        self.ticket.status = _wf_status(self.src, category="done")
        self.ticket.resolved_at = timezone.now()
        self.ticket.closed_at = timezone.now()
        self.ticket.save(update_fields=["status", "resolved_at", "closed_at"])
        moved = self._move(target_status=_wf_status(self.dst, category="todo"))
        moved.refresh_from_db()
        self.assertIsNone(moved.resolved_at)
        self.assertIsNone(moved.closed_at)

    def test_sla_trackers_untouched(self):
        from apps.itsm_sla.models import SLAMetric, SLAPolicy, SLATracker
        policy = SLAPolicy.objects.create(name="P", project=self.src, is_default=True)
        metric = SLAMetric.objects.create(policy=policy, kind="resolution", name="Res")
        tr = SLATracker.objects.create(
            ticket=self.ticket, metric=metric, target_minutes=60,
            started_at=timezone.now(), due_at=timezone.now() + timedelta(hours=1),
        )
        moved = self._move()
        tr.refresh_from_db()
        self.assertFalse(tr.is_deleted)                                  # not voided
        self.assertEqual(SLATracker.objects.filter(ticket=moved).count(), 1)  # no new clock

    def test_retention_comments_watchers_history(self):
        from apps.itsm_tickets.models import Watcher
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=self.ticket, author=self.user, body_html="<p>hi</p>")
        Watcher.objects.create(ticket=self.ticket, user=self.user)
        moved = self._move()
        self.assertEqual(moved.comments.count(), 1)
        self.assertEqual(moved.watchers.count(), 1)
        self.assertTrue(moved.activity.filter(action="ticket_moved").exists())

    def test_multi_move_alias_chain(self):
        first = self._move()
        with self.captureOnCommitCallbacks(execute=True):
            second = ticket_service.move_ticket(
                ticket=first, target_project=self.src,
                target_ticket_type=self.src.ticket_types.first(),
                target_status=_wf_status(self.src), user=self.user)
        from apps.itsm_tickets.models import TicketNumberAlias
        self.assertEqual(TicketNumberAlias.objects.filter(ticket=second).count(), 2)


class TicketMoveApiTests(TestCase):
    """Endpoint-level: move-options proposal, move execution, gating, alias redirect."""

    def setUp(self):
        from rest_framework.test import APIClient
        _seed_min()
        self.src = _project("IT", "incident")
        self.dst = _project("IT", "service_request")
        self.other = Project.objects.exclude(helpdesk_id=self.src.helpdesk_id).first()
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, project=None):
        p = project or self.src
        return ticket_service.create_ticket(
            project=p, ticket_type=p.ticket_types.first(), summary="T",
            apply_routing=False, priority="p3")

    def _body(self, project):
        return {"target_project": str(project.id),
                "target_ticket_type": str(project.ticket_types.first().id),
                "target_status": str(_wf_status(project).id)}

    def _scoped_agent(self, *projects):
        import uuid as _uuid
        from rest_framework.test import APIClient
        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership
        agent = User.objects.create_user(username="ag_%s" % _uuid.uuid4().hex[:8], password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.src.helpdesk_id, user=agent)
        for p in projects:
            ProjectMembership.objects.create(project=p, user=agent)
        c = APIClient()
        c.force_authenticate(agent)
        return c

    def test_move_options(self):
        from django.urls import reverse
        t = self._mk()
        resp = self.client.get(reverse("itsm-ticket-move-options", args=[t.ticket_number]),
                               {"target_project": str(self.dst.id)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["target_project"]["key"], self.dst.key)
        self.assertGreaterEqual(len(resp.data["target_statuses"]), 1)
        self.assertGreaterEqual(len(resp.data["target_types"]), 1)
        self.assertIn("suggested_status_id", resp.data)

    def test_move_happy_path(self):
        from django.urls import reverse
        t = self._mk()
        old = t.ticket_number
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post(reverse("itsm-ticket-move", args=[t.ticket_number]),
                                    self._body(self.dst), format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertNotEqual(resp.data["ticket_number"], old)
        self.assertEqual(resp.data["project_key"], self.dst.key)
        self.assertEqual(resp.data["helpdesk_key"], self.dst.helpdesk.key)

    def test_old_number_redirects_via_alias(self):
        from django.urls import reverse
        t = self._mk()
        old = t.ticket_number
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("itsm-ticket-move", args=[t.ticket_number]),
                             self._body(self.dst), format="json")
        resp = self.client.get(reverse("itsm-ticket-detail", args=[old]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], str(t.id))
        self.assertNotEqual(resp.data["ticket_number"], old)   # canonical new number

    def test_move_options_cross_helpdesk_400_for_admin(self):
        from django.urls import reverse
        t = self._mk()
        resp = self.client.get(reverse("itsm-ticket-move-options", args=[t.ticket_number]),
                               {"target_project": str(self.other.id)})
        self.assertEqual(resp.status_code, 400)

    def test_cross_helpdesk_move_403_for_scoped_agent(self):
        from django.urls import reverse
        client = self._scoped_agent(self.src)
        t = self._mk()
        resp = client.post(reverse("itsm-ticket-move", args=[t.ticket_number]),
                           self._body(self.other), format="json")
        self.assertEqual(resp.status_code, 403)

    def test_agent_role_can_move(self):
        from django.urls import reverse
        client = self._scoped_agent(self.src, self.dst)
        t = self._mk()
        with self.captureOnCommitCallbacks(execute=True):
            resp = client.post(reverse("itsm-ticket-move", args=[t.ticket_number]),
                               self._body(self.dst), format="json")
        self.assertEqual(resp.status_code, 200)

    def test_move_denied_without_permission(self):
        from django.urls import reverse
        from rest_framework.test import APIClient
        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership
        from apps.itsm_rbac.models import Module, RoleModulePermission
        role = SystemRole.objects.create(code="viewer", name="Viewer", is_system=False)
        tickets_mod = Module.objects.get(code="itsm.tickets")
        RoleModulePermission.objects.create(role=role, module=tickets_mod, can_read=True)
        viewer = User.objects.create_user(username="view", password="x")
        RoleAssignment.objects.create(user=viewer, role=role)
        HelpdeskMembership.objects.create(helpdesk_id=self.src.helpdesk_id, user=viewer)
        ProjectMembership.objects.create(project=self.src, user=viewer)
        client = APIClient()
        client.force_authenticate(viewer)
        t = self._mk()
        resp = client.post(reverse("itsm-ticket-move", args=[t.ticket_number]),
                           self._body(self.dst), format="json")
        self.assertEqual(resp.status_code, 403)


class FilterFieldRegistryScopingTests(TestCase):
    """The queue filter registry lists only the fields actually PRESENT in scope.

    `FieldDefinition` has no helpdesk FK — a `project=null` field is global to the
    whole tenant — so the registry must condition on what each project is configured
    with: the `incident_only` ITIL defs belong to Incident projects only, and a
    column-backed global that duplicates a built-in filter is not offered twice.
    """

    ITIL_KEYS = {
        "cf:impact", "cf:urgency", "cf:business_impact", "cf:major_incident",
        "cf:users_affected", "cf:service_downtime", "cf:resolution_code",
        "cf:root_cause", "cf:workaround_provided", "cf:resolution_notes",
    }
    # Column-backed globals whose key is already a built-in filter.
    DUPE_KEYS = {
        "cf:priority", "cf:requestor", "cf:assignee", "cf:assigned_group",
        "cf:source", "cf:summary",
    }

    def setUp(self):
        from rest_framework.test import APIClient

        _seed_min()
        self.inc = _project("IT", "incident")          # ITINC
        self.req = _project("IT", "service_request")   # ITREQ (non-Incident)
        self.hr = _project("HR", "incident")           # different helpdesk
        self.admin = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _keys(self, **params):
        from django.urls import reverse
        resp = self.client.get(reverse("itsm-ticket-filter-fields"), params)
        self.assertEqual(resp.status_code, 200)
        return {f["key"] for f in resp.data["fields"]}

    def test_itil_fields_hidden_from_non_incident_project(self):
        """ITREQ is a service_request → the incident_only globals aren't its fields."""
        keys = self._keys(project=str(self.req.pk))
        self.assertFalse(self.ITIL_KEYS & keys, f"ITIL leaked: {self.ITIL_KEYS & keys}")

    def test_itil_fields_shown_on_incident_project(self):
        keys = self._keys(project=str(self.inc.pk))
        self.assertTrue(self.ITIL_KEYS.issubset(keys), f"missing: {self.ITIL_KEYS - keys}")

    def test_builtin_duplicates_not_listed_as_custom_fields(self):
        """Priority/Requestor/... stay available as the STANDARD (working) filters —
        they must not also appear under Custom fields via their maps_to global."""
        keys = self._keys(project=str(self.inc.pk))
        self.assertFalse(self.DUPE_KEYS & keys, f"duplicates: {self.DUPE_KEYS & keys}")
        for builtin in ("priority", "requestor", "assignee", "assigned_group",
                        "source", "summary", "created_at", "created_by"):
            self.assertIn(builtin, keys)

    def test_value_backed_project_fields_are_listed(self):
        """The project's own fields + applicable globals are still offered."""
        from apps.itsm_core.models import FieldDefinition

        FieldDefinition.objects.create(
            project=self.req, key="region", name="Region", field_type="text")
        keys = self._keys(project=str(self.req.pk))
        self.assertIn("cf:region", keys)      # project-scoped
        self.assertIn("cf:mode", keys)        # value-backed global → applies everywhere
        self.assertIn("cf:description", keys)  # maps_to but no builtin twin → kept

    def test_combined_union_includes_itil_only_when_an_incident_project_is_in_scope(self):
        # IT has ITINC (incident) → the ITIL set is configured somewhere in scope.
        keys = self._keys(helpdesk="IT")
        self.assertTrue(self.ITIL_KEYS.issubset(keys))
        self.assertFalse(self.DUPE_KEYS & keys)

        # A scope of only non-Incident projects must not surface them.
        from apps.itsm_tickets.services.filter_fields import filter_fields_payload_multi
        only_req = {f["key"] for f in filter_fields_payload_multi([self.req])["fields"]}
        self.assertFalse(self.ITIL_KEYS & only_req)

    def test_project_branch_rejects_an_inaccessible_project(self):
        """?project=<foreign uuid> must not disclose another helpdesk's field metadata."""
        from django.urls import reverse

        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership

        agent = User.objects.create_user(username="ag1", password="x")
        RoleAssignment.objects.create(user=agent, role=SystemRole.objects.get(code="agent"))
        HelpdeskMembership.objects.create(helpdesk_id=self.inc.helpdesk_id, user=agent)
        ProjectMembership.objects.create(project=self.inc, user=agent)
        client = APIClient()
        client.force_authenticate(agent)

        ok = client.get(reverse("itsm-ticket-filter-fields"), {"project": str(self.inc.pk)})
        self.assertEqual(ok.status_code, 200)
        forbidden = client.get(reverse("itsm-ticket-filter-fields"), {"project": str(self.hr.pk)})
        self.assertEqual(forbidden.status_code, 403)


class MappedColumnFilterCompileTests(TestCase):
    """A `cf:` condition on a column-backed (`config.maps_to`) field must compile
    against the Ticket COLUMN — it has no FieldValue row, so the old FieldValue-based
    compile silently matched nothing."""

    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "incident")
        self.user = User.objects.create_user(username="ag", password="x")

    def _mk(self, **cols):
        t = ticket_service.create_ticket(
            project=self.proj, ticket_type=self.proj.ticket_types.first(),
            summary="T", priority=cols.pop("priority", "p3"), apply_routing=False,
        )
        if cols:
            from apps.itsm_tickets.models import Ticket
            Ticket.objects.filter(pk=t.pk).update(**cols)
        return t

    def _run(self, spec):
        from apps.itsm_tickets.models import Ticket
        from apps.itsm_tickets.services import query_builder
        return set(Ticket.objects.filter(
            query_builder.build_q(spec, user=self.user)
        ).distinct().values_list("pk", flat=True))

    def _cf(self, field, op, value=None):
        cond = {"field": field, "op": op}
        if value is not None:
            cond["value"] = value
        return self._run({"conditions": [cond]})

    def test_choice_column_impact(self):
        hi = self._mk(impact="high")
        self._mk(impact="low")
        self.assertEqual(self._cf("cf:impact", "eq", "high"), {hi.pk})

    def test_boolean_column_major_incident(self):
        major = self._mk(major_incident=True)
        normal = self._mk(major_incident=False)
        self.assertEqual(self._cf("cf:major_incident", "is_true"), {major.pk})
        self.assertEqual(self._cf("cf:major_incident", "is_false"), {normal.pk})

    def test_number_column_users_affected(self):
        big = self._mk(users_affected=42)
        small = self._mk(users_affected=3)
        self.assertEqual(self._cf("cf:users_affected", "gt", 10), {big.pk})
        self.assertEqual(self._cf("cf:users_affected", "between", [1, 5]), {small.pk})

    def test_text_column_description(self):
        match = self._mk(description_html="<p>disk failure on node 7</p>")
        self._mk(description_html="<p>printer jam</p>")
        self.assertEqual(self._cf("cf:description", "contains", "disk failure"), {match.pk})

    def test_legacy_cf_key_for_a_builtin_behaves_like_the_builtin(self):
        """A SavedFilter created before the registry stopped offering cf:priority must
        now behave exactly like the Standard `priority` filter (it matched nothing)."""
        crit = self._mk(priority="p1")
        self._mk(priority="p4")
        self.assertEqual(self._cf("cf:priority", "eq", "p1"), {crit.pk})
        self.assertEqual(
            self._cf("cf:priority", "eq", "p1"),
            self._run({"conditions": [{"field": "priority", "op": "eq", "value": "p1"}]}),
        )


class ProblemFieldScopingTests(TestCase):
    """`config.applies_to` scoping for the Problem field set: shared ITIL fields
    (impact/urgency/root_cause/resolution set) surface on BOTH Incident and
    Problem projects; problem-only fields (workaround_notes/investigation_reason)
    on Problem only; incident-only ones (major_incident/…) never on Problem; and
    Request/custom projects see none of the tagged set (regression)."""

    PROBLEM_ONLY = {"cf:workaround_notes", "cf:investigation_reason"}
    INCIDENT_ONLY = {"cf:major_incident", "cf:users_affected", "cf:service_downtime"}
    SHARED = {"cf:impact", "cf:urgency", "cf:business_impact", "cf:resolution_code",
              "cf:root_cause", "cf:workaround_provided", "cf:resolution_notes"}

    def setUp(self):
        from rest_framework.test import APIClient

        from apps.itsm_helpdesks.models import Helpdesk
        from apps.itsm_projects.standard_projects import (
            TEMPLATES_BY_KEY,
            ensure_standard_project,
        )

        _seed_min()
        self.prb, _ = ensure_standard_project(
            Helpdesk.objects.get(key="IT"), TEMPLATES_BY_KEY["problem"]
        )
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.admin = User.objects.create_superuser(username="root2", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _keys(self, **params):
        from django.urls import reverse
        resp = self.client.get(reverse("itsm-ticket-filter-fields"), params)
        self.assertEqual(resp.status_code, 200)
        return {f["key"] for f in resp.data["fields"]}

    def test_problem_project_field_set(self):
        keys = self._keys(project=str(self.prb.pk))
        self.assertTrue(self.SHARED.issubset(keys), f"missing: {self.SHARED - keys}")
        self.assertTrue(self.PROBLEM_ONLY.issubset(keys), f"missing: {self.PROBLEM_ONLY - keys}")
        self.assertFalse(self.INCIDENT_ONLY & keys, f"leaked: {self.INCIDENT_ONLY & keys}")

    def test_incident_project_has_no_problem_only_fields(self):
        keys = self._keys(project=str(self.inc.pk))
        self.assertTrue(self.SHARED.issubset(keys))
        self.assertTrue(self.INCIDENT_ONLY.issubset(keys))
        self.assertFalse(self.PROBLEM_ONLY & keys, f"leaked: {self.PROBLEM_ONLY & keys}")

    def test_request_project_sees_none_of_the_tagged_set(self):
        keys = self._keys(project=str(self.req.pk))
        tagged = self.SHARED | self.PROBLEM_ONLY | self.INCIDENT_ONLY
        self.assertFalse(tagged & keys, f"leaked: {tagged & keys}")
        # …but still sees the untagged globals (JSON-trap regression).
        self.assertIn("cf:mode", keys)
        self.assertIn("cf:description", keys)

    def test_combined_union_conditions_on_problem_presence(self):
        # IT now has ITINC + ITPRB → shared + problem-only + incident-only all in scope.
        keys = self._keys(helpdesk="IT")
        self.assertTrue(self.PROBLEM_ONLY.issubset(keys))
        # HR has no Problem project → its union must not offer problem-only fields.
        hr_keys = self._keys(helpdesk="HR")
        self.assertFalse(self.PROBLEM_ONLY & hr_keys, f"leaked: {self.PROBLEM_ONLY & hr_keys}")

    def test_new_resolution_code_options_present(self):
        from apps.itsm_core.models import FieldOption

        values = set(FieldOption.objects.filter(
            field__project__isnull=True, field__key="resolution_code",
        ).values_list("value", flat=True))
        self.assertIn("risk_accepted", values)
        self.assertIn("wont_fix", values)


class ProblemColumnFilterCompileTests(TestCase):
    """The new Problem `maps_to` columns compile against the Ticket column
    (offered ⇒ it works), and problem priority auto-derives from the matrix."""

    def setUp(self):
        from apps.itsm_helpdesks.models import Helpdesk
        from apps.itsm_projects.standard_projects import (
            TEMPLATES_BY_KEY,
            ensure_standard_project,
        )

        _seed_min()
        self.prb, _ = ensure_standard_project(
            Helpdesk.objects.get(key="IT"), TEMPLATES_BY_KEY["problem"]
        )
        self.user = User.objects.create_user(username="agx", password="x")

    def _mk(self, **cols):
        t = ticket_service.create_ticket(
            project=self.prb, ticket_type=self.prb.ticket_types.get(key="problem"),
            summary="P", priority=cols.pop("priority", "p3"), apply_routing=False,
        )
        if cols:
            from apps.itsm_tickets.models import Ticket
            Ticket.objects.filter(pk=t.pk).update(**cols)
        return t

    def _cf(self, field, op, value=None):
        from apps.itsm_tickets.models import Ticket
        from apps.itsm_tickets.services import query_builder
        cond = {"field": field, "op": op}
        if value is not None:
            cond["value"] = value
        return set(Ticket.objects.filter(
            query_builder.build_q({"conditions": [cond]}, user=self.user)
        ).distinct().values_list("pk", flat=True))

    def test_text_column_workaround_notes(self):
        hit = self._mk(workaround_notes="reboot the switch")
        self._mk(workaround_notes="")
        self.assertEqual(
            self._cf("cf:workaround_notes", "contains", "switch"), {hit.pk})

    def test_choice_column_investigation_reason(self):
        hit = self._mk(investigation_reason="recurring_incidents")
        self._mk(investigation_reason="other")
        self.assertEqual(
            self._cf("cf:investigation_reason", "eq", "recurring_incidents"), {hit.pk})

    def test_priority_derives_from_matrix_on_problem(self):
        t = self._mk()
        updated = ticket_service.update_ticket(
            ticket=t, user=self.user, impact="critical", urgency="high")
        self.assertEqual(updated.priority, "p1")

    def test_choice_column_is_empty_matches_blank_char(self):
        # Char-backed choice columns store "" (never NULL): "is empty" must match
        # the unset ticket and "is not empty" the set one — not the reverse.
        unset = self._mk()
        set_ = self._mk(investigation_reason="other")
        self.assertEqual(self._cf("cf:investigation_reason", "is_empty"), {unset.pk})
        self.assertEqual(self._cf("cf:investigation_reason", "is_not_empty"), {set_.pk})

    def test_problem_columns_flow_through_ticket_api(self):
        # Create → detail → PATCH round-trip for the two Problem columns (they
        # were engine/filter-only before; the API must read AND write them).
        from django.urls import reverse
        from rest_framework.test import APIClient

        boss = User.objects.create_superuser(username="rootp", password="x")
        client = APIClient()
        client.force_authenticate(boss)
        resp = client.post(reverse("itsm-ticket-list"), {
            "project": str(self.prb.pk),
            "ticket_type": str(self.prb.ticket_types.get(key="problem").pk),
            "summary": "Recurring auth failures",
            "workaround_notes": "Restart the auth pod",
            "investigation_reason": "recurring_incidents",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["workaround_notes"], "Restart the auth pod")
        self.assertEqual(body["investigation_reason"], "recurring_incidents")
        tid = body["id"]
        patch = client.patch(reverse("itsm-ticket-detail", args=[tid]), {
            "workaround_notes": "Permanent workaround documented",
            "investigation_reason": "trend_analysis",
        }, format="json")
        self.assertEqual(patch.status_code, 200, patch.content)
        got = patch.json()
        self.assertEqual(got["workaround_notes"], "Permanent workaround documented")
        self.assertEqual(got["investigation_reason"], "trend_analysis")
        # Invalid reason rejected; new resolution codes accepted.
        bad = client.patch(reverse("itsm-ticket-detail", args=[tid]),
                           {"investigation_reason": "nope"}, format="json")
        self.assertEqual(bad.status_code, 400, bad.content)
        ok = client.patch(reverse("itsm-ticket-detail", args=[tid]),
                          {"resolution_code": "risk_accepted"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["resolution_code"], "risk_accepted")
