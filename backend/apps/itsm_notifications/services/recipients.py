"""Resolve a rule's recipient selectors to a deduped set of users."""

from __future__ import annotations

from django.contrib.auth import get_user_model

User = get_user_model()

# The named (dynamic) recipient selectors the UI offers, in (value, label) form.
# These resolve against the ticket at emit time. Dict selectors ({"users": [...]}
# or {"role": "code"}) are also supported by resolve() but are not surfaced in the
# v1 settings UI. This list is the single source of truth for serializer validation
# and the notification-scheme metadata endpoint.
NAMED_SELECTORS = [
    ("requestor", "Requestor"),
    ("assignee", "Assignee"),
    ("assigned_group", "Assigned group"),
    ("group_lead", "Group lead"),
    ("watchers", "Watchers"),
    ("mentioned", "Mentioned users"),
]
NAMED_SELECTOR_KEYS = frozenset(k for k, _ in NAMED_SELECTORS)


def resolve(rule, ticket, context) -> set:
    users = set()
    for sel in (rule.recipients or []):
        if isinstance(sel, dict):
            if sel.get("users"):
                users.update(User.objects.filter(pk__in=sel["users"]))
            if sel.get("role"):
                users.update(
                    User.objects.filter(itsm_role_assignment__role__code=sel["role"])
                )
            continue
        if sel == "requestor" and ticket.requestor_id:
            _add(users, ticket.requestor_id)
        elif sel == "assignee" and ticket.assignee_id:
            _add(users, ticket.assignee_id)
        elif sel == "assigned_group" and ticket.assigned_group_id:
            users.update(
                User.objects.filter(itsm_group_memberships__group_id=ticket.assigned_group_id,
                                    itsm_group_memberships__is_active=True)
            )
        elif sel == "group_lead" and ticket.assigned_group_id and ticket.assigned_group.lead_id:
            _add(users, ticket.assigned_group.lead_id)
        elif sel == "watchers":
            users.update(User.objects.filter(watched_tickets__ticket=ticket))
        elif sel == "mentioned":
            ids = (context or {}).get("user_ids", [])
            users.update(User.objects.filter(pk__in=ids))
    return users


def _add(users: set, user_id):
    u = User.objects.filter(pk=user_id).first()
    if u:
        users.add(u)
