"""Group membership helpers + auto-assignment strategies + create-time routing."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Q


def active_member_ids(group) -> list:
    return list(
        group.memberships.filter(is_active=True).order_by("user_id").values_list("user_id", flat=True)
    )


def round_robin_pick(group):
    """Next active member after the stored cursor (locked). Returns a user id or None."""
    from .models import GroupAssignmentState

    members = active_member_ids(group)
    if not members:
        return None
    with transaction.atomic():
        state, _ = GroupAssignmentState.objects.select_for_update().get_or_create(group=group)
        last = state.last_assigned_user_id
        if last in members:
            idx = (members.index(last) + 1) % len(members)
        else:
            idx = 0
        picked = members[idx]
        state.last_assigned_user_id = picked
        state.save(update_fields=["last_assigned_user", "updated_at"])
    return picked


def least_loaded_pick(group):
    """Active member with the fewest open (non-done) assigned tickets."""
    from apps.itsm_tickets.models import Ticket

    members = active_member_ids(group)
    if not members:
        return None
    counts = dict(
        Ticket.objects.filter(assignee_id__in=members)
        .exclude(status__category__key="done")
        .values_list("assignee_id")
        .annotate(n=Count("id"))
    )
    return min(members, key=lambda uid: (counts.get(uid, 0), str(uid)))


def resolve_assignee(strategy: str, group, fixed_user_id=None):
    """Return a user id for the given auto-assignment strategy, or None."""
    if group is None and strategy != "fixed_user":
        return None
    if strategy == "round_robin":
        return round_robin_pick(group)
    if strategy == "least_loaded":
        return least_loaded_pick(group)
    if strategy == "group_lead":
        return group.lead_id if group else None
    if strategy == "fixed_user":
        return fixed_user_id
    return None  # keep_current


def resolve_group_and_assignee(ticket):
    """Apply the first matching RoutingRule for create-time ownership.
    Returns (group, assignee_id) or (None, None)."""
    from .models import RoutingRule

    rules = RoutingRule.objects.filter(is_active=True).filter(
        Q(project=ticket.project) | Q(project__isnull=True)
    ).order_by("priority")
    for rule in rules:
        spec = rule.match_spec or {}
        if "ticket_type" in spec and str(spec["ticket_type"]) != str(ticket.ticket_type_id):
            continue
        if "priority" in spec and spec["priority"] != ticket.priority:
            continue
        return rule.target_group, rule.target_assignee_id
    return None, None
