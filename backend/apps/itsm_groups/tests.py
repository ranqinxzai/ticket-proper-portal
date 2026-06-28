"""Routing engine (create-time auto-routing) + assignment-group whitelist."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.itsm_projects.models import Project

from .models import Group, RoutingRule
from .services import allowed_group_ids_for, resolve_group_and_assignee

User = get_user_model()


def _seed_min():
    from apps.itsm_rbac.registry import seed_rbac
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


class RoutingResolverTests(TestCase):
    """Unit-level: resolve_group_and_assignee against a constructed (unsaved) ticket."""

    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "incident")
        self.tt = self.proj.ticket_types.get(key="incident")
        self.delhi = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="IT Delhi", key="it-delhi", type="custom",
        )
        self.mumbai = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="IT Mumbai", key="it-mumbai", type="custom",
        )

    def _ticket(self, **kw):
        from apps.itsm_tickets.models import Ticket
        kw.setdefault("priority", "medium")
        return Ticket(project=self.proj, ticket_type=self.tt, **kw)

    def test_custom_field_condition_routes(self):
        RoutingRule.objects.create(
            project=self.proj, name="Delhi → IT Delhi", priority=0,
            match_spec={"match": "all", "conditions": [
                {"field": "location", "operator": "eq", "value": "delhi"}]},
            target_group=self.delhi,
        )
        g, a = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "delhi"})
        self.assertEqual(g, self.delhi)
        # A non-matching value falls through to no rule.
        g2, _ = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "pune"})
        self.assertIsNone(g2)

    def test_first_match_wins_by_priority(self):
        RoutingRule.objects.create(
            project=self.proj, name="low pri", priority=10,
            match_spec={"conditions": [{"field": "location", "operator": "eq", "value": "delhi"}]},
            target_group=self.mumbai,
        )
        RoutingRule.objects.create(
            project=self.proj, name="high pri", priority=1,
            match_spec={"conditions": [{"field": "location", "operator": "eq", "value": "delhi"}]},
            target_group=self.delhi,
        )
        g, _ = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "delhi"})
        self.assertEqual(g, self.delhi)  # priority=1 beats priority=10

    def test_match_all_requires_every_condition(self):
        RoutingRule.objects.create(
            project=self.proj, name="delhi + high", priority=0,
            match_spec={"match": "all", "conditions": [
                {"field": "location", "operator": "eq", "value": "delhi"},
                {"field": "priority", "operator": "eq", "value": "high"}]},
            target_group=self.delhi,
        )
        # location matches but priority doesn't → no match.
        g, _ = resolve_group_and_assignee(
            self._ticket(priority="low"), custom_fields={"location": "delhi"})
        self.assertIsNone(g)
        g2, _ = resolve_group_and_assignee(
            self._ticket(priority="high"), custom_fields={"location": "delhi"})
        self.assertEqual(g2, self.delhi)

    def test_match_any(self):
        RoutingRule.objects.create(
            project=self.proj, name="delhi OR high", priority=0,
            match_spec={"match": "any", "conditions": [
                {"field": "location", "operator": "eq", "value": "delhi"},
                {"field": "priority", "operator": "eq", "value": "high"}]},
            target_group=self.delhi,
        )
        g, _ = resolve_group_and_assignee(
            self._ticket(priority="high"), custom_fields={"location": "pune"})
        self.assertEqual(g, self.delhi)  # priority matched even though location didn't

    def test_neq_operator(self):
        RoutingRule.objects.create(
            project=self.proj, name="not delhi", priority=0,
            match_spec={"conditions": [{"field": "location", "operator": "neq", "value": "delhi"}]},
            target_group=self.mumbai,
        )
        g, _ = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "mumbai"})
        self.assertEqual(g, self.mumbai)
        g2, _ = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "delhi"})
        self.assertIsNone(g2)

    def test_legacy_flat_spec_still_matches(self):
        RoutingRule.objects.create(
            project=self.proj, name="legacy high", priority=0,
            match_spec={"priority": "high"}, target_group=self.delhi,
        )
        g, _ = resolve_group_and_assignee(self._ticket(priority="high"))
        self.assertEqual(g, self.delhi)
        g2, _ = resolve_group_and_assignee(self._ticket(priority="low"))
        self.assertIsNone(g2)

    def test_inactive_rule_skipped(self):
        RoutingRule.objects.create(
            project=self.proj, name="off", priority=0, is_active=False,
            match_spec={"conditions": [{"field": "location", "operator": "eq", "value": "delhi"}]},
            target_group=self.delhi,
        )
        g, _ = resolve_group_and_assignee(self._ticket(), custom_fields={"location": "delhi"})
        self.assertIsNone(g)


class CreateTimeRoutingTests(TestCase):
    """End-to-end: create_ticket applies routing (only when no group was chosen)."""

    def setUp(self):
        _seed_min()
        from apps.itsm_core.models.fields import FieldDefinition, FieldOption
        self.proj = _project("IT", "incident")
        self.tt = self.proj.ticket_types.get(key="incident")
        self.delhi = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="IT Delhi", key="it-delhi", type="custom",
        )
        loc = FieldDefinition.objects.create(
            project=self.proj, key="location", name="Location", field_type="dropdown",
        )
        FieldOption.objects.create(field=loc, value="delhi", label="Delhi", sort_order=0)
        RoutingRule.objects.create(
            project=self.proj, name="Delhi → IT Delhi", priority=0,
            match_spec={"conditions": [{"field": "location", "operator": "eq", "value": "delhi"}]},
            target_group=self.delhi,
        )

    def _create(self, **kw):
        from apps.itsm_tickets.services import ticket_service
        return ticket_service.create_ticket(
            project=self.proj, ticket_type=self.tt, summary="T", **kw)

    def test_routing_sets_group_from_custom_field(self):
        t = self._create(custom_fields={"location": "delhi"})
        self.assertEqual(t.assigned_group_id, self.delhi.id)

    def test_explicit_group_is_respected(self):
        # When the caller picks a group, routing must not override it.
        t = self._create(assigned_group=self.proj.default_group,
                         custom_fields={"location": "delhi"})
        self.assertEqual(t.assigned_group_id, self.proj.default_group_id)

    def test_no_match_falls_back_to_default_group(self):
        t = self._create(custom_fields={"location": "pune"})
        self.assertEqual(t.assigned_group_id, self.proj.default_group_id)


class GroupWhitelistTests(TestCase):
    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "incident")
        self.a = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="Team A", key="team-a", type="custom")
        self.b = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="Team B", key="team-b", type="custom")

    def test_empty_whitelist_is_unrestricted(self):
        self.assertEqual(self.proj.allowed_group_ids, [])
        self.assertIsNone(allowed_group_ids_for(self.proj))

    def test_restricted_set_includes_default_group(self):
        self.proj.allowed_group_ids = [str(self.a.id)]
        self.proj.save(update_fields=["allowed_group_ids"])
        allowed = allowed_group_ids_for(self.proj)
        self.assertIn(str(self.a.id), allowed)
        self.assertIn(str(self.proj.default_group_id), allowed)  # always folded in
        self.assertNotIn(str(self.b.id), allowed)

    def test_ensure_group_allowed(self):
        from apps.itsm_tickets.services.ticket_service import ensure_group_allowed
        # Unrestricted: any group passes.
        ensure_group_allowed(self.proj, self.b.id)
        # Restrict to A (+ default, folded in).
        self.proj.allowed_group_ids = [str(self.a.id)]
        self.proj.save(update_fields=["allowed_group_ids"])
        ensure_group_allowed(self.proj, self.a.id)  # ok
        ensure_group_allowed(self.proj, self.proj.default_group_id)  # ok (default)
        ensure_group_allowed(self.proj, None)  # no-op
        with self.assertRaises(ValueError):
            ensure_group_allowed(self.proj, self.b.id)


class AllowedGroupIdsSerializerTests(TestCase):
    """ProjectWriteSerializer.validate_allowed_group_ids drops junk + foreign ids."""

    def setUp(self):
        _seed_min()
        self.proj = _project("IT", "incident")
        self.it_group = Group.objects.create(
            helpdesk=self.proj.helpdesk, name="IT Team", key="it-team", type="custom")
        hr = Project.objects.exclude(helpdesk_id=self.proj.helpdesk_id).first()
        self.hr_group = Group.objects.create(
            helpdesk=hr.helpdesk, name="HR Team", key="hr-team", type="custom")

    def test_validate_keeps_only_real_local_or_shared_ids(self):
        from apps.itsm_projects.serializers import ProjectWriteSerializer
        ser = ProjectWriteSerializer(instance=self.proj)
        cleaned = ser.validate_allowed_group_ids([
            str(self.it_group.id),          # kept (this helpdesk)
            str(self.hr_group.id),          # dropped (other helpdesk)
            str(self.it_group.id),          # dup dropped
            "not-a-uuid",                   # dropped
        ])
        self.assertEqual(cleaned, [str(self.it_group.id)])

    def test_shared_global_group_is_allowed(self):
        from apps.itsm_projects.serializers import ProjectWriteSerializer
        shared = Group.objects.filter(helpdesk__isnull=True).first()
        ser = ProjectWriteSerializer(instance=self.proj)
        cleaned = ser.validate_allowed_group_ids([str(shared.id)])
        self.assertEqual(cleaned, [str(shared.id)])
