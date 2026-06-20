"""Ticket lifecycle service — create / assign / comment. Single write sites that
log activity and fan out SLA + notification events (post-commit)."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event
from apps.itsm_core.services.html import html_to_text, sanitize_html

from .numbering import generate_ticket_number


@transaction.atomic
def create_ticket(*, project, ticket_type, summary, description_html="", requestor=None,
                  priority="medium", assigned_group=None, assignee=None, source="agent",
                  impact="", urgency="", user=None, apply_routing=True, custom_fields=None):
    from apps.itsm_groups.services import resolve_group_and_assignee
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.models import Status

    workflow = project.default_workflow
    if workflow is None:
        raise ValueError("Project has no default workflow configured.")
    initial = Status.objects.filter(workflow=workflow, is_initial=True).first() \
        or Status.objects.filter(workflow=workflow).order_by("sort_order").first()
    if initial is None:
        raise ValueError("Workflow has no statuses.")

    group = assigned_group or project.default_group
    ticket = Ticket(
        ticket_number=generate_ticket_number(project),
        project=project, ticket_type=ticket_type, summary=summary,
        description_html=sanitize_html(description_html),
        description_text=html_to_text(description_html),
        requestor=requestor, assigned_group=group, assignee=assignee,
        status=initial, workflow=workflow, priority=priority,
        impact=impact or "", urgency=urgency or "", source=source,
        created_by=user if (user and getattr(user, "pk", None)) else None,
    )

    if apply_routing and assignee is None:
        rgroup, rassignee = resolve_group_and_assignee(ticket)
        if rgroup is not None:
            ticket.assigned_group = rgroup
        if rassignee is not None:
            ticket.assignee_id = rassignee

    if ticket.assignee_id:
        ticket.assigned_at = timezone.now()
    ticket.save()

    if custom_fields:
        from apps.itsm_core.services import fields as field_service
        field_service.set_values(ticket, custom_fields, user)

    def _after():
        log_event(ticket, user, "ticket_created",
                  payload={"summary": ticket.summary, "priority": ticket.priority})
        hooks.sla_start_for_ticket(ticket)
        hooks.emit_event("TicketCreated", ticket, actor=user)
        if ticket.assignee_id:
            hooks.emit_event("Assigned", ticket, actor=user)

    transaction.on_commit(_after)
    return ticket


@transaction.atomic
def assign(*, ticket, assignee_id=None, group_id=None, user=None):
    from apps.itsm_tickets.models import Ticket

    locked = Ticket.objects.select_for_update().get(pk=ticket.pk)
    changes = {}
    if group_id is not None and group_id != locked.assigned_group_id:
        changes["group"] = {"old": str(locked.assigned_group_id), "new": str(group_id)}
        locked.assigned_group_id = group_id
    if assignee_id != locked.assignee_id:
        changes["assignee"] = {"old": str(locked.assignee_id), "new": str(assignee_id)}
        locked.assignee_id = assignee_id
        if assignee_id and not locked.assigned_at:
            locked.assigned_at = timezone.now()
    locked.save(update_fields=["assigned_group", "assignee", "assigned_at", "updated_at"])

    def _after():
        if "group" in changes:
            log_event(locked, user, "group_changed", payload=changes["group"])
        if "assignee" in changes:
            log_event(locked, user, "assigned", payload=changes["assignee"])
            hooks.emit_event("Assigned", locked, actor=user)

    transaction.on_commit(_after)
    return locked


@transaction.atomic
def add_comment(*, ticket, author, body_html, visibility="public", mention_user_ids=None):
    from apps.itsm_tickets.models import Comment, MentionRecord, Ticket

    comment = Comment.objects.create(
        ticket=ticket, author=author if getattr(author, "pk", None) else None,
        visibility=visibility,
        body_html=sanitize_html(body_html), body_text=html_to_text(body_html),
    )
    for uid in set(mention_user_ids or []):
        MentionRecord.objects.get_or_create(comment=comment, mentioned_user_id=uid)

    # First public reply stamps first_responded_at (drives the SLA first-response metric).
    is_first_public = visibility == "public" and ticket.first_responded_at is None
    if is_first_public:
        Ticket.objects.filter(pk=ticket.pk, first_responded_at__isnull=True).update(
            first_responded_at=timezone.now()
        )
        ticket.first_responded_at = timezone.now()

    def _after():
        log_event(ticket, author, "comment_added",
                  payload={"comment_id": str(comment.id), "visibility": visibility,
                           "preview": comment.body_text[:140]})
        if is_first_public:
            hooks.sla_stop(ticket, "first_response")
        event = "CommentAddedPrivate" if visibility == "private" else "CommentAdded"
        hooks.emit_event(event, ticket, actor=author, context={"comment_id": str(comment.id)})
        if mention_user_ids:
            hooks.emit_event("Mentioned", ticket, actor=author,
                             context={"comment_id": str(comment.id),
                                      "user_ids": [str(u) for u in mention_user_ids]})

    transaction.on_commit(_after)
    return comment
