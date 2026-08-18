"""Per-transition approval wiring: the `requires_approval` serializer toggle (which
syncs the `approval_granted` gate condition) and the engine gate behaviour."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_approvals.models import ApprovalWorkflow
from apps.itsm_approvals.services import engine as approval_engine
from apps.itsm_projects.models import Project
from apps.itsm_tickets.services import ticket_service
from apps.itsm_workflows.models import Transition, Workflow
from apps.itsm_workflows.services import engine
from apps.itsm_workflows.services.starter import create_starter_workflow
from apps.itsm_workflows.validators import validate_workflow_graph

User = get_user_model()


def _seed_all():
    from apps.itsm_approvals.seed import run as seed_approvals
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
    seed_approvals()  # gates Request "→ approved" transitions + sample approval policy


def _request_project():
    return Project.objects.get(helpdesk__key="IT", project_type="service_request")


def _incident_project():
    return Project.objects.get(helpdesk__key="IT", project_type="incident")


class RequiresApprovalToggleTests(TestCase):
    """PATCH /transitions/{id}/ with `requires_approval` syncs the gate condition."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        # "Start Fulfilment" (approved → in_progress) has real post_functions we must not lose.
        self.tr = Transition.objects.get(
            workflow=_request_project().default_workflow, name="Start Fulfilment"
        )
        self.url = reverse("itsm-transition-detail", args=[self.tr.id])

    def _gate_qs(self):
        return self.tr.conditions.filter(condition_type="approval_granted")

    def test_enable_creates_gate_condition(self):
        self.assertFalse(self._gate_qs().exists())
        resp = self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._gate_qs().count(), 1)

    def test_enable_is_idempotent(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.assertEqual(self._gate_qs().count(), 1)

    def test_disable_removes_gate_condition(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        self.client.patch(self.url, {"requires_approval": False}, format="json")
        self.assertFalse(self._gate_qs().exists())

    def test_omitting_flag_leaves_conditions_untouched(self):
        self.client.patch(self.url, {"requires_approval": True}, format="json")
        # An unrelated edit (note prompt) must not wipe the gate.
        self.client.patch(self.url, {"note_prompt": True, "note_heading": "Why"}, format="json")
        self.assertEqual(self._gate_qs().count(), 1)

    def test_post_functions_passthrough_preserved(self):
        # The client merges the request_approval entry; the serializer just stores the array.
        awf = ApprovalWorkflow.objects.get(name="Standard Procurement Approval")
        merged = [pf for pf in self.tr.post_functions if pf["type"] != "request_approval"]
        merged.append({"type": "request_approval", "config": {"workflow_id": str(awf.id)}})
        resp = self.client.patch(self.url, {"post_functions": merged}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.tr.refresh_from_db()
        types = {pf["type"] for pf in self.tr.post_functions}
        self.assertIn("auto_assign", types)        # original survives
        self.assertIn("request_approval", types)   # new one added


class ApprovalGateEngineTests(TestCase):
    """The `approval_granted` condition hides a gated transition until sign-off."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        proj = _request_project()
        self.ticket = ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary="Need a laptop", priority="p3", user=self.root,
            apply_routing=False,
        )
        # Seeded gate: "Approve" (new → approved) carries the approval_granted condition.
        self.approve = Transition.objects.get(workflow=proj.default_workflow, name="Approve")
        self.awf = ApprovalWorkflow.objects.get(name="Standard Procurement Approval")

    def _approve_names(self):
        return {t.name for t in engine.available_transitions(self.ticket, self.root)}

    def test_gate_present_on_seeded_approve(self):
        self.assertTrue(
            self.approve.conditions.filter(condition_type="approval_granted").exists()
        )

    def test_approve_blocked_while_pending_then_allowed_after_grant(self):
        # No approval started yet → gate passes (backward compatible).
        self.assertIn("Approve", self._approve_names())

        # Start the approval → now pending → Approve is hidden.
        req = approval_engine.start_approval(self.ticket, self.awf, user=self.root)
        self.assertNotIn("Approve", self._approve_names())

        # Drive both sequential stages (superuser may decide any stage).
        approval_engine.decide(req, self.root, "approved")  # L1 → advances
        approval_engine.decide(req, self.root, "approved")  # L2 → granted
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        self.assertIn("Approve", self._approve_names())


class PendingApprovalFreezesStatusTests(TestCase):
    """The reported bug: while an approval is pending, an admin could still move the
    ticket to the next state through an *ungated* transition. A pending approval must
    now freeze the status across ALL transitions (UI hidden + engine 403), for everyone,
    until the approval is decided."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        proj = _request_project()
        self.wf = proj.default_workflow
        self.awf = ApprovalWorkflow.objects.get(name="Standard Procurement Approval")
        self.ticket = ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary="Need a laptop", priority="p3", user=self.root,
            apply_routing=False,
        )
        # Advance new → approved (no approval pending yet) so the next transition is the
        # ungated "Start Fulfilment" (approved → in_progress) — the one from the report.
        engine.transition(self.ticket, Transition.objects.get(workflow=self.wf, name="Approve"),
                          self.root)
        self.ticket.refresh_from_db()
        self.start_fulfilment = Transition.objects.get(workflow=self.wf, name="Start Fulfilment")

    def _names(self):
        return {t.name for t in engine.available_transitions(self.ticket, self.root)}

    def test_start_fulfilment_carries_no_gate(self):
        # Sanity: the transition the admin used is not itself gated — the freeze must
        # come from the central pending-approval guard, not a per-transition condition.
        self.assertFalse(
            self.start_fulfilment.conditions.filter(condition_type="approval_granted").exists()
        )

    def test_pending_approval_hides_all_and_blocks_engine(self):
        self.assertIn("Start Fulfilment", self._names())  # movable before any approval

        approval_engine.start_approval(self.ticket, self.awf, user=self.root)

        # UI: no transition buttons while sign-off is outstanding.
        self.assertEqual(engine.available_transitions(self.ticket, self.root), [])

        # Engine: a forged/racing POST is rejected 403 — superuser included.
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(self.ticket, self.start_fulfilment, self.root)
        self.assertEqual(ctx.exception.status_code, 403)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "approved")  # never moved

    def test_status_unfreezes_after_grant(self):
        req = approval_engine.start_approval(self.ticket, self.awf, user=self.root)
        approval_engine.decide(req, self.root, "approved")  # L1 → advances
        approval_engine.decide(req, self.root, "approved")  # L2 → granted

        self.assertIn("Start Fulfilment", self._names())
        engine.transition(self.ticket, self.start_fulfilment, self.root)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status.key, "in_progress")

    def test_reject_also_unfreezes(self):
        req = approval_engine.start_approval(self.ticket, self.awf, user=self.root)
        approval_engine.decide(req, self.root, "rejected")  # request no longer pending
        # Status is no longer frozen; movement is a workflow decision again.
        self.assertIn("Start Fulfilment", self._names())


class StatusPausesSlaSerializerTests(TestCase):
    """`pauses_sla` ("Exclude from SLA") round-trips through the Status serializer."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.workflow = Project.objects.get(
            helpdesk__key="IT", project_type="incident"
        ).default_workflow
        from apps.itsm_workflows.models import StatusCategory
        self.category = StatusCategory.objects.get(key="in_progress")

    def test_create_defaults_false_and_accepts_true(self):
        url = reverse("itsm-status-list")
        resp = self.client.post(url, {
            "workflow": str(self.workflow.id), "name": "Working", "key": "working_x",
            "category": str(self.category.id),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertFalse(resp.json()["pauses_sla"])  # default when omitted

        resp = self.client.post(url, {
            "workflow": str(self.workflow.id), "name": "Hold", "key": "hold_x",
            "category": str(self.category.id), "pauses_sla": True,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json()["pauses_sla"])

    def test_patch_toggles_pauses_sla(self):
        from apps.itsm_workflows.models import Status
        st = Status.objects.create(workflow=self.workflow, name="Hold2", key="hold2_x",
                                   category=self.category)
        url = reverse("itsm-status-detail", args=[st.id])
        resp = self.client.patch(url, {"pauses_sla": True}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        st.refresh_from_db()
        self.assertTrue(st.pauses_sla)


class TransitionScreenConfigTests(TestCase):
    """Admin-configurable capture fields on a transition: the `screen_fields`
    serializer sync (PATCH /transitions/{id}/) + generic engine persistence."""

    def setUp(self):
        _seed_all()
        from apps.itsm_core.models import FieldDefinition, FieldOption

        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.inc = _incident_project()
        self.wf = self.inc.default_workflow
        # A project-scoped value-backed custom field (not a maps_to column).
        self.field = FieldDefinition.objects.create(
            project=self.inc, key="resolution_type", name="Resolution type",
            field_type="dropdown", is_system=False)
        FieldOption.objects.create(field=self.field, value="permanent", label="Permanent")
        # "Start Progress" ships without a screen — a clean slate to configure.
        self.start = Transition.objects.get(workflow=self.wf, name="Start Progress")
        self.url = reverse("itsm-transition-detail", args=[self.start.id])

    def _mk_ticket(self):
        return ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="T", user=self.root, apply_routing=False)

    def _advance(self, ticket, *names):
        for n in names:
            engine.transition(ticket, Transition.objects.get(workflow=self.wf, name=n), self.root)

    def _attach(self, *, field_key, mandatory=False):
        from apps.itsm_workflows.models import TransitionScreen, TransitionScreenField
        screen = TransitionScreen.objects.create(workflow=self.wf, name="Capture")
        TransitionScreenField.objects.create(
            screen=screen, field_key=field_key, is_mandatory=mandatory)
        self.start.screen = screen
        self.start.save(update_fields=["screen"])

    # ── serializer sync ────────────────────────────────────────────────────
    def test_patch_creates_screen_and_reads_back(self):
        resp = self.client.patch(
            self.url,
            {"screen_fields": [{"field_key": "resolution_type", "is_mandatory": True}]},
            format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.start.refresh_from_db()
        self.assertIsNotNone(self.start.screen_id)
        self.assertEqual(
            list(self.start.screen.fields.values_list("field_key", flat=True)),
            ["resolution_type"])
        got = self.client.get(self.url).json()
        self.assertEqual(
            got["screen_fields"],
            [{"field_key": "resolution_type", "is_mandatory": True, "sort_order": 0}])

    def test_patch_replaces_and_reorders(self):
        self._attach(field_key="resolution_type")
        # Replace with two ordered fields (root_cause first).
        resp = self.client.patch(self.url, {"screen_fields": [
            {"field_key": "root_cause", "is_mandatory": False, "sort_order": 0},
            {"field_key": "resolution_type", "is_mandatory": True, "sort_order": 1},
        ]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.start.refresh_from_db()
        self.assertEqual(
            list(self.start.screen.fields.order_by("sort_order").values_list("field_key", flat=True)),
            ["root_cause", "resolution_type"])

    def test_empty_list_detaches_screen(self):
        self._attach(field_key="resolution_type")
        resp = self.client.patch(self.url, {"screen_fields": []}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.start.refresh_from_db()
        self.assertIsNone(self.start.screen_id)

    def test_unknown_field_key_rejected(self):
        resp = self.client.patch(
            self.url, {"screen_fields": [{"field_key": "does_not_exist_xyz"}]}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    # ── engine persistence ─────────────────────────────────────────────────
    def test_value_backed_field_persisted(self):
        from apps.itsm_core.models import FieldValue
        self._attach(field_key="resolution_type")
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        engine.transition(ticket, self.start, self.root, fields={"resolution_type": "permanent"})
        fv = FieldValue.objects.get(ticket=ticket, field=self.field)
        self.assertEqual(fv.value_text, "permanent")

    def test_mandatory_custom_field_blocks_transition(self):
        self._attach(field_key="resolution_type", mandatory=True)
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(ticket, self.start, self.root, fields={})
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("resolution_type", ctx.exception.errors)

    def test_column_backed_field_persisted_generically(self):
        # A `maps_to` (column) field on a transition with NO set_resolution_details
        # post-function must still persist, via the engine's generic column path.
        from apps.itsm_core.models import FieldDefinition
        rc = FieldDefinition.objects.filter(
            key="root_cause", project__isnull=True, is_deleted=False).first()
        if rc is None or not (rc.config or {}).get("maps_to"):
            self.skipTest("root_cause maps_to global field not seeded in this build")
        self._attach(field_key="root_cause")
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        engine.transition(ticket, self.start, self.root, fields={"root_cause": "loose cable"})
        ticket.refresh_from_db()
        self.assertEqual(ticket.root_cause, "loose cable")


class FieldConditionValidatorTests(TestCase):
    """Per-transition field-condition validators (Transition.field_conditions): the
    serializer normalisation/validation on PATCH /transitions/{id}/ and the engine's
    block-with-message enforcement. Unlike `conditions` (which HIDE a transition), a failed
    field condition keeps the button VISIBLE and refuses the RUN with the admin's message."""

    def setUp(self):
        _seed_all()
        from apps.itsm_core.models import FieldDefinition, FieldOption

        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.inc = _incident_project()
        self.wf = self.inc.default_workflow
        # A project-scoped value-backed dropdown (not a maps_to column) to exercise the
        # FieldValue read path + equals comparison.
        self.field = FieldDefinition.objects.create(
            project=self.inc, key="resolution_type", name="Resolution type",
            field_type="dropdown", is_system=False)
        FieldOption.objects.create(field=self.field, value="permanent", label="Permanent")
        FieldOption.objects.create(field=self.field, value="temporary", label="Temporary")
        # "Start Progress" (assigned → in_progress) ships without a screen or conditions —
        # a clean transition to attach field conditions to. `assignee` is the global
        # column-backed system field (config.maps_to = "assignee").
        self.start = Transition.objects.get(workflow=self.wf, name="Start Progress")
        self.url = reverse("itsm-transition-detail", args=[self.start.id])

    def _mk_ticket(self):
        return ticket_service.create_ticket(
            project=self.inc, ticket_type=self.inc.ticket_types.get(key="incident"),
            summary="T", user=self.root, apply_routing=False)

    def _advance(self, ticket, *names):
        for n in names:
            engine.transition(ticket, Transition.objects.get(workflow=self.wf, name=n), self.root)

    def _set_conditions(self, rules):
        self.start.field_conditions = rules
        self.start.save(update_fields=["field_conditions"])

    def _set_assignee(self, ticket, user):
        # Force the column deterministically (a preceding "Assign" may auto-assign).
        from apps.itsm_tickets.models import Ticket
        Ticket.objects.filter(pk=ticket.pk).update(assignee=user)

    # ── engine enforcement ─────────────────────────────────────────────────
    def test_is_not_empty_blocks_then_allows(self):
        self._set_conditions([{"field_key": "assignee", "operator": "is_not_empty",
                               "message": "Assign someone first."}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        self._set_assignee(ticket, None)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(ticket, self.start, self.root)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.message, "Assign someone first.")
        self.assertIn("assignee", ctx.exception.errors)
        # Set the assignee → the SAME transition now runs (button was never hidden).
        self._set_assignee(ticket, self.root)
        engine.transition(ticket, self.start, self.root)
        ticket.refresh_from_db()
        self.assertEqual(ticket.status_id, self.start.to_status_id)

    def test_provided_screen_value_overrides_current(self):
        # A value-backed field required by the rule, with no stored value → blocked;
        # supplying it via `fields` (the transition-screen overlay) satisfies the rule.
        self._set_conditions([{"field_key": "resolution_type", "operator": "is_not_empty",
                               "message": "Pick a resolution type."}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        with self.assertRaises(engine.TransitionError):
            engine.transition(ticket, self.start, self.root)
        engine.transition(ticket, self.start, self.root, fields={"resolution_type": "permanent"})
        ticket.refresh_from_db()
        self.assertEqual(ticket.status_id, self.start.to_status_id)

    def test_equals_value_backed_field(self):
        from apps.itsm_core.services import fields as field_service
        self._set_conditions([{"field_key": "resolution_type", "operator": "equals",
                               "value": "permanent", "message": "Must be permanent."}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        field_service.set_values(ticket, {"resolution_type": "temporary"}, self.root)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(ticket, self.start, self.root)
        self.assertEqual(ctx.exception.status_code, 422)
        field_service.set_values(ticket, {"resolution_type": "permanent"}, self.root)
        engine.transition(ticket, self.start, self.root)
        ticket.refresh_from_db()
        self.assertEqual(ticket.status_id, self.start.to_status_id)

    def test_available_transitions_still_lists_it(self):
        self._set_conditions([{"field_key": "assignee", "operator": "is_not_empty",
                               "message": "Assign first."}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        self._set_assignee(ticket, None)
        ticket.refresh_from_db()
        names = {t.name for t in engine.available_transitions(ticket, self.root)}
        self.assertIn("Start Progress", names)

    def test_unknown_operator_fails_open(self):
        # A corrupt/forward-incompatible rule must not permanently brick a workflow.
        self._set_conditions([{"field_key": "assignee", "operator": "weird", "message": "x"}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        self._set_assignee(ticket, None)
        engine.transition(ticket, self.start, self.root)  # no raise
        ticket.refresh_from_db()
        self.assertEqual(ticket.status_id, self.start.to_status_id)

    # ── serializer validation / round-trip ─────────────────────────────────
    def test_patch_sets_and_reads_back(self):
        resp = self.client.patch(self.url, {"field_conditions": [
            {"field_key": "assignee", "operator": "is_not_empty", "message": "  Set assignee  "},
        ]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        expected = [{"field_key": "assignee", "operator": "is_not_empty", "message": "Set assignee"}]
        self.start.refresh_from_db()
        self.assertEqual(self.start.field_conditions, expected)  # trimmed/normalised
        self.assertEqual(self.client.get(self.url).json()["field_conditions"], expected)

    def test_unknown_field_key_rejected(self):
        resp = self.client.patch(self.url, {"field_conditions": [
            {"field_key": "does_not_exist_xyz", "operator": "is_not_empty", "message": "x"},
        ]}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_bad_operator_rejected(self):
        resp = self.client.patch(self.url, {"field_conditions": [
            {"field_key": "assignee", "operator": "weird", "message": "x"},
        ]}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_equals_requires_value(self):
        resp = self.client.patch(self.url, {"field_conditions": [
            {"field_key": "resolution_type", "operator": "equals", "message": "x"},
        ]}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_attachment_field_rejected(self):
        from apps.itsm_core.models import FieldDefinition
        FieldDefinition.objects.create(
            project=self.inc, key="screenshot", name="Screenshot",
            field_type="attachment", is_system=False)
        resp = self.client.patch(self.url, {"field_conditions": [
            {"field_key": "screenshot", "operator": "is_not_empty", "message": "x"},
        ]}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_field_conditions_survive_reseed(self):
        from apps.itsm_workflows.seed import run as seed_workflows
        rules = [{"field_key": "assignee", "operator": "is_not_empty", "message": "keep me"}]
        self._set_conditions(rules)
        seed_workflows()  # update_or_create defaults must not touch field_conditions
        self.start.refresh_from_db()
        self.assertEqual(self.start.field_conditions, rules)

    def test_custom_message_is_detail_via_endpoint(self):
        # Locks the toast contract: a blocked run returns the admin's message as `detail`.
        self._set_conditions([{"field_key": "assignee", "operator": "is_not_empty",
                               "message": "Assign someone first."}])
        ticket = self._mk_ticket()
        self._advance(ticket, "Assign")
        self._set_assignee(ticket, None)
        resp = self.client.post(
            reverse("itsm-ticket-transition", args=[str(ticket.pk)]),
            {"transition_id": str(self.start.id)}, format="json")
        self.assertEqual(resp.status_code, 422, resp.content)
        body = resp.json()
        self.assertEqual(body["detail"], "Assign someone first.")
        self.assertIn("assignee", body.get("errors", {}))


class CreateStarterWorkflowTests(TestCase):
    """POST /workflows/create_starter/ builds a NEW, valid, unlinked starter workflow."""

    def setUp(self):
        _seed_all()
        self.root = User.objects.create_superuser(username="root", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.root)
        self.url = reverse("itsm-workflow-create-starter")

    def test_creates_valid_starter_graph(self):
        resp = self.client.post(self.url, {"name": "Change Management"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(data["name"], "Change Management")
        self.assertFalse(data["is_default"])
        self.assertEqual(data["status_count"], 3)

        wf = Workflow.objects.get(id=data["id"])
        # Exactly one initial + at least one Done-category status.
        self.assertEqual(wf.statuses.filter(is_initial=True).count(), 1)
        self.assertTrue(wf.statuses.filter(category__key="done").exists())
        # A create transition (from_status is null).
        self.assertTrue(wf.transitions.filter(from_status__isnull=True).exists())
        # And the graph validates.
        self.assertTrue(validate_workflow_graph(wf)["valid"])

    def test_blank_name_is_rejected(self):
        resp = self.client.post(self.url, {"name": "   "}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_unknown_base_type_coerced_to_custom(self):
        resp = self.client.post(self.url, {"name": "X", "base_type": "bogus"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["base_type"], "custom")

    def test_new_workflow_is_usable_for_ticket_creation(self):
        wf = create_starter_workflow("Usable WF")
        proj = _incident_project()
        proj.default_workflow = wf
        proj.save(update_fields=["default_workflow"])
        ticket = ticket_service.create_ticket(
            project=proj, ticket_type=proj.ticket_types.first(),
            summary="Runs on the new starter", priority="p3", user=self.root,
            apply_routing=False,
        )
        # Initial status resolved from the new workflow (no ValueError).
        self.assertEqual(ticket.workflow_id, wf.id)
        self.assertTrue(ticket.status.is_initial)

    def test_requires_permission(self):
        # A signed-in user with no ITSM role has no create grant → 403.
        nobody = User.objects.create_user(username="nobody", password="x")
        client = APIClient()
        client.force_authenticate(nobody)
        resp = client.post(self.url, {"name": "Denied"}, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(Workflow.objects.filter(name="Denied").exists())


class ProblemWorkflowSeedTests(TestCase):
    """The seeded Default Problem Workflow: graph validity, Known-Error capture
    screens, portal gating, engine behaviour, and the ensure_problem_workflow
    self-heal used by the standard-project import."""

    def setUp(self):
        _seed_all()
        from apps.itsm_projects.standard_projects import (
            TEMPLATES_BY_KEY,
            ensure_standard_project,
        )
        from apps.itsm_helpdesks.models import Helpdesk

        self.root = User.objects.create_superuser(username="root", password="x")
        self.wf = Workflow.objects.get(base_type="problem", is_default=True)
        self.prb, _ = ensure_standard_project(
            Helpdesk.objects.get(key="IT"), TEMPLATES_BY_KEY["problem"]
        )

    def _mk_ticket(self):
        return ticket_service.create_ticket(
            project=self.prb, ticket_type=self.prb.ticket_types.get(key="problem"),
            summary="Recurring outage", user=self.root, apply_routing=False)

    def _t(self, name):
        return Transition.objects.get(workflow=self.wf, name=name)

    # ── seeded graph ─────────────────────────────────────────────────────────
    def test_graph_is_valid(self):
        result = validate_workflow_graph(self.wf)
        self.assertTrue(result["valid"], result)

    def test_statuses_and_categories(self):
        by_key = {s.key: s for s in self.wf.statuses.all()}
        self.assertEqual(
            set(by_key),
            {"new", "under_investigation", "pending", "known_error", "resolved", "closed"},
        )
        self.assertTrue(by_key["new"].is_initial)
        self.assertEqual(by_key["known_error"].category.key, "in_progress")
        self.assertEqual(by_key["resolved"].category.key, "done")
        self.assertEqual(by_key["closed"].category.key, "done")

    def test_known_error_screen_wired(self):
        record = self._t("Record Known Error")
        self.assertIsNotNone(record.screen_id)
        self.assertEqual(record.screen.name, "Root Cause & Workaround")
        fields = {f.field_key: f.is_mandatory for f in record.screen.fields.all()}
        self.assertEqual(
            fields,
            {"root_cause": True, "workaround_notes": False, "workaround_provided": False},
        )

    def test_resolution_screen_shared_by_both_resolves(self):
        resolve, fix = self._t("Resolve"), self._t("Implement Fix")
        self.assertIsNotNone(resolve.screen_id)
        self.assertEqual(resolve.screen_id, fix.screen_id)
        self.assertEqual(resolve.screen.name, "Resolution Details")

    def test_problem_reopen_not_portal_allowed(self):
        self.assertFalse(self._t("Reopen").portal_allowed)
        incident_wf = Workflow.objects.get(base_type="incident", is_default=True)
        self.assertTrue(
            Transition.objects.get(workflow=incident_wf, name="Reopen").portal_allowed
        )

    # ── engine behaviour ─────────────────────────────────────────────────────
    def test_record_known_error_requires_root_cause(self):
        ticket = self._mk_ticket()
        engine.transition(ticket, self._t("Start Investigation"), self.root)
        with self.assertRaises(engine.TransitionError) as ctx:
            engine.transition(ticket, self._t("Record Known Error"), self.root, fields={})
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("root_cause", ctx.exception.errors)

    def test_known_error_capture_persists_columns(self):
        ticket = self._mk_ticket()
        engine.transition(ticket, self._t("Start Investigation"), self.root)
        engine.transition(
            ticket, self._t("Record Known Error"), self.root,
            fields={"root_cause": "Faulty switch firmware",
                    "workaround_notes": "Reboot the edge switch",
                    "workaround_provided": True},
        )
        ticket.refresh_from_db()
        self.assertEqual(ticket.status.key, "known_error")
        self.assertEqual(ticket.root_cause, "Faulty switch firmware")
        self.assertEqual(ticket.workaround_notes, "Reboot the edge switch")
        self.assertTrue(ticket.workaround_provided)

    def test_reopen_clears_resolution_keeps_workaround(self):
        ticket = self._mk_ticket()
        engine.transition(ticket, self._t("Start Investigation"), self.root)
        engine.transition(
            ticket, self._t("Record Known Error"), self.root,
            fields={"root_cause": "RC", "workaround_notes": "WK"})
        engine.transition(
            ticket, self._t("Implement Fix"), self.root,
            fields={"resolution_code": "fixed", "resolution_notes": "patched"},
            comment="Fixed in firmware 1.2")
        ticket.refresh_from_db()
        self.assertEqual(ticket.status.key, "resolved")
        self.assertEqual(ticket.resolution_code, "fixed")
        engine.transition(ticket, self._t("Reopen"), self.root)
        ticket.refresh_from_db()
        self.assertEqual(ticket.status.key, "under_investigation")
        self.assertEqual(ticket.resolution_code, "")   # resolution cleared
        self.assertEqual(ticket.resolution_notes, "")
        # KEDB payload captured at Record Known Error survives the reopen.
        self.assertEqual(ticket.root_cause, "RC")
        self.assertEqual(ticket.workaround_notes, "WK")

    # ── self-heal + starter ──────────────────────────────────────────────────
    def test_ensure_problem_workflow_self_heals(self):
        from apps.itsm_workflows.seed import ensure_problem_workflow

        # Idempotent when present…
        self.assertEqual(ensure_problem_workflow().id, self.wf.id)
        # …and recreates a valid graph when absent (tenant seeded pre-Problem).
        self.wf.is_default = False
        self.wf.save(update_fields=["is_default"])
        wf2 = ensure_problem_workflow()
        self.assertTrue(wf2.is_default)
        self.assertTrue(validate_workflow_graph(wf2)["valid"])

    def test_starter_accepts_problem_base_type(self):
        wf = create_starter_workflow("PRB custom flow", base_type="problem")
        self.assertEqual(wf.base_type, "problem")
        self.assertFalse(wf.is_default)
