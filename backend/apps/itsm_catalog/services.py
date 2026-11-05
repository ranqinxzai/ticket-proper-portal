"""Catalog → ticket choke-point. Raising from a catalog item reuses
``ticket_service.create_ticket`` and starts an approval when the item requires one.

B4 (2026-10-18): an item that **requires** approval never raises a ticket without
one. If its approval workflow is missing, deleted or inactive — or an approver can't
be resolved for this requestor (e.g. no manager) — the raise is refused with a 400
``ApprovalStartError`` and, because everything runs in one transaction, no ticket is
created."""

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

    approval_wf = None
    if item.requires_approval:
        from apps.itsm_approvals.services.engine import ApprovalStartError

        approval_wf = item.approval_workflow  # FK descriptor also returns soft-deleted rows
        if approval_wf is None or approval_wf.is_deleted or not approval_wf.is_active:
            raise ApprovalStartError(
                "This request can't be submitted because its approval isn't set up. "
                "Please contact your service desk."
            )

    summary = (summary_override or item.summary_template or item.name).strip()
    ticket = ticket_service.create_ticket(
        project=item.project,
        ticket_type=ticket_type,
        summary=summary,
        description_html=item.description_html or "",
        requestor=requestor,
        priority=item.default_priority or "p3",
        assigned_group=item.default_group,
        assignee=item.default_assignee,
        source=source,
        user=user,
        custom_fields={**(item.field_defaults or {}), **(field_values or {})},
    )

    CatalogRequest.objects.create(item=item, ticket=ticket, requestor=requestor)

    if approval_wf is not None:
        from apps.itsm_approvals.services import engine as approval_engine
        # Validates every stage for THIS ticket's requestor; a refusal rolls back
        # the whole raise (no ticket, no half-made request).
        approval_engine.start_approval(ticket, approval_wf, user=user)

    return ticket
