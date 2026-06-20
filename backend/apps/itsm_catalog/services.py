"""Catalog → ticket choke-point. Raising from a catalog item reuses
``ticket_service.create_ticket`` and starts an approval when the item requires one."""

from __future__ import annotations

from django.db import transaction


def _default_ticket_type(item):
    if item.ticket_type_id:
        return item.ticket_type
    from apps.itsm_projects.models import TicketType
    return (
        TicketType.objects.filter(project=item.project, is_default=True, is_deleted=False).first()
        or TicketType.objects.filter(project=item.project, is_deleted=False).first()
    )


@transaction.atomic
def raise_from_catalog(item, requestor, *, field_values=None, summary_override=None,
                       user=None, source="portal"):
    from apps.itsm_tickets.services import ticket_service

    from .models import CatalogRequest

    ticket_type = _default_ticket_type(item)
    if ticket_type is None:
        raise ValueError("Catalog item's project has no ticket type configured.")

    summary = (summary_override or item.summary_template or item.name).strip()
    ticket = ticket_service.create_ticket(
        project=item.project,
        ticket_type=ticket_type,
        summary=summary,
        description_html=item.description_html or "",
        requestor=requestor,
        priority=item.default_priority or "medium",
        assigned_group=item.default_group,
        assignee=item.default_assignee,
        source=source,
        user=user,
        custom_fields={**(item.field_defaults or {}), **(field_values or {})},
    )

    CatalogRequest.objects.create(item=item, ticket=ticket, requestor=requestor)

    if item.requires_approval and item.approval_workflow_id:
        from apps.itsm_approvals.services import engine as approval_engine
        approval_engine.start_approval(ticket, item.approval_workflow, user=user)

    return ticket
