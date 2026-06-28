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


def _routing_actual_value(field, ticket, custom_fields):
    """Resolve the live value of `field` for a routing condition. Built-in
    attributes (ticket_type / priority / impact / urgency / source) come off the
    (unsaved) ticket; everything else is looked up in the create-time
    ``custom_fields`` dict by field key — e.g. a "location" dropdown, or mode."""
    if field == "ticket_type":
        return str(ticket.ticket_type_id) if ticket.ticket_type_id else None
    if field in ("priority", "impact", "urgency", "source"):
        return getattr(ticket, field, None) or None
    return (custom_fields or {}).get(field)


def _value_matches(actual, expected, op):
    """Compare a (possibly multi-value) actual against the rule's expected value.
    Multi-value actuals (multiselect / cascade path) match on membership."""
    expected = "" if expected is None else str(expected)
    if isinstance(actual, (list, tuple)):
        present = expected in {str(x) for x in actual}
    else:
        present = ("" if actual is None else str(actual)) == expected
    return present if op == "eq" else (not present)


def _spec_matches(spec, ticket, custom_fields):
    """Does a RoutingRule.match_spec match this (about-to-be-created) ticket?

    Supports two shapes (a rule may mix them):
      • legacy flat keys ``{"ticket_type": <id>, "priority": <p>}`` (AND);
      • a condition list ``{"match": "all"|"any",
        "conditions": [{"field", "operator": "eq"|"neq", "value"}]}`` where
        ``field`` is a built-in attribute (priority/ticket_type/…) or a custom
        field key. An empty spec matches every ticket.
    """
    if "ticket_type" in spec and str(spec["ticket_type"]) != str(ticket.ticket_type_id):
        return False
    if "priority" in spec and spec["priority"] != ticket.priority:
        return False

    conditions = spec.get("conditions") or []
    if conditions:
        results = [
            _value_matches(
                _routing_actual_value(c.get("field"), ticket, custom_fields),
                c.get("value"),
                c.get("operator", "eq"),
            )
            for c in conditions
            if c.get("field")
        ]
        if spec.get("match") == "any":
            return any(results)
        return all(results)
    return True


def resolve_group_and_assignee(ticket, custom_fields=None):
    """Apply the first matching RoutingRule for create-time ownership.
    Returns (group, assignee_id) or (None, None).

    ``custom_fields`` is the create payload's value dict (keyed by field key) so a
    rule can route on a custom field — e.g. *Location = Delhi → IT Delhi* — even
    though the FieldValues aren't persisted until after the ticket is saved."""
    from .models import RoutingRule

    rules = RoutingRule.objects.filter(is_active=True).filter(
        Q(project=ticket.project) | Q(project__isnull=True)
    ).order_by("priority")
    for rule in rules:
        if _spec_matches(rule.match_spec or {}, ticket, custom_fields):
            return rule.target_group, rule.target_assignee_id
    return None, None


def allowed_group_ids_for(project):
    """Effective whitelist of group ids assignable on ``project``'s tickets.

    Returns ``None`` when **unrestricted** (the default: an empty
    ``Project.allowed_group_ids`` ⇒ every group is allowed). Otherwise returns a
    set of id strings — the configured ids plus the project's own ``default_group``
    (always implicitly allowed, since it's the create-time landing group)."""
    ids = list(getattr(project, "allowed_group_ids", None) or [])
    if not ids:
        return None
    allowed = {str(i) for i in ids}
    if project.default_group_id:
        allowed.add(str(project.default_group_id))
    return allowed
