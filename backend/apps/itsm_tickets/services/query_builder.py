"""Translate a SavedFilter `query_spec` (JSON) into a Django Q over Ticket.

query_spec shape (all keys optional):
{
  "project": "<uuid>", "ticket_type": "<uuid>",
  "status": ["<uuid>", ...], "status_category": ["todo","in_progress","done"],
  "priority": ["high","critical"],
  "assignee": "<uuid>" | "me" | null, "assignee_isnull": true,
  "assigned_group": "<uuid>",
  "text": "free text",
  "created_after": "ISO", "created_before": "ISO",
  "custom_fields": {"<field_key>": "<value>"}
}
"""

from __future__ import annotations

from django.db.models import Q


def build_q(query_spec: dict, *, user=None, accessible_helpdesk_ids=None) -> Q:
    """Compile a query_spec to a Q over Ticket.

    ``accessible_helpdesk_ids`` is the helpdesk-scope clamp (see
    ``apps.itsm_helpdesks.services``): ``None`` ⇒ unrestricted (superuser / internal),
    a list ⇒ restrict to ``project__helpdesk_id__in`` (possibly empty ⇒ nothing).
    Every ticket-facing caller (saved-filter results, widget data, bulk, the queue)
    MUST pass this so no shared path can leak across helpdesks.
    """
    spec = query_spec or {}
    q = Q(is_deleted=False)

    if accessible_helpdesk_ids is not None:
        q &= Q(project__helpdesk_id__in=accessible_helpdesk_ids)

    if spec.get("project"):
        q &= Q(project_id=spec["project"])
    if spec.get("ticket_type"):
        q &= Q(ticket_type_id=spec["ticket_type"])
    if spec.get("status"):
        q &= Q(status_id__in=spec["status"])
    if spec.get("status_category"):
        q &= Q(status__category__key__in=spec["status_category"])
    if spec.get("priority"):
        q &= Q(priority__in=spec["priority"])
    if spec.get("assigned_group"):
        q &= Q(assigned_group_id=spec["assigned_group"])

    if spec.get("assignee_isnull"):
        q &= Q(assignee__isnull=True)
    elif spec.get("assignee"):
        if spec["assignee"] == "me" and user is not None and user.is_authenticated:
            q &= Q(assignee_id=user.id)
        else:
            q &= Q(assignee_id=spec["assignee"])

    if spec.get("text"):
        t = spec["text"]
        q &= (Q(summary__icontains=t) | Q(ticket_number__icontains=t)
              | Q(description_text__icontains=t))

    if spec.get("created_after"):
        q &= Q(created_at__gte=spec["created_after"])
    if spec.get("created_before"):
        q &= Q(created_at__lte=spec["created_before"])

    # Custom-field filters via the FieldValue join.
    for fkey, val in (spec.get("custom_fields") or {}).items():
        q &= Q(field_values__field__key=fkey, field_values__value_text=str(val))

    return q


def filtered_tickets(query_spec: dict, *, user=None, accessible_helpdesk_ids=None):
    from apps.itsm_tickets.models import Ticket

    return Ticket.objects.filter(
        build_q(query_spec, user=user, accessible_helpdesk_ids=accessible_helpdesk_ids)
    ).distinct()
