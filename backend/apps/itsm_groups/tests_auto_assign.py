"""B17c (2026-10-18): auto-assignment never overwrites an existing assignee."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import Group, GroupAssignmentState, GroupMembership
from .services import pick_assignee_if_unassigned

User = get_user_model()


class PickAssigneeIfUnassignedTests(TestCase):
    def setUp(self):
        self.group = Group.objects.create(name="G", key="g")
        self.a = User.objects.create_user(username="a", password="x")
        self.b = User.objects.create_user(username="b", password="x")
        for u in (self.a, self.b):
            GroupMembership.objects.create(group=self.group, user=u)

    def test_assigned_ticket_gets_no_pick_and_cursor_stays(self):
        self.assertIsNone(pick_assignee_if_unassigned(self.a.id, "round_robin", self.group))
        self.assertFalse(GroupAssignmentState.objects.filter(group=self.group).exists())

    def test_unassigned_ticket_round_robins(self):
        first = pick_assignee_if_unassigned(None, "round_robin", self.group)
        second = pick_assignee_if_unassigned(None, "round_robin", self.group)
        self.assertEqual({first, second}, {self.a.id, self.b.id})

    def test_fixed_user_and_keep_current(self):
        self.assertEqual(pick_assignee_if_unassigned(None, "fixed_user", None, self.b.id), self.b.id)
        self.assertIsNone(pick_assignee_if_unassigned(self.a.id, "fixed_user", None, self.b.id))
        self.assertIsNone(pick_assignee_if_unassigned(None, "keep_current", self.group))
