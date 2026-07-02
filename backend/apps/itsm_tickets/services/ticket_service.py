"""Ticket lifecycle service — create / assign / comment. Single write sites that
log activity and fan out SLA + notification events (post-commit)."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.itsm_core.services import hooks, log_event
from apps.itsm_core.services.html import html_to_text, sanitize_html

from .numbering import generate_ticket_number


def _user_label(user_id):
    """Display name for a user id, captured at the time of the change so the audit
    feed stays self-describing (and correct even if the user is later renamed).
    Returns ``None`` for a null/empty id."""
    if not user_id:
        return None
    from apps.accounts.models import User

    user = User.objects.filter(pk=user_id).only("full_name", "username").first()
    return (user.full_name or user.username) if user else None


def _group_label(group_id):
    """Display name for a group id, captured at change time. ``None`` if unset/missing."""
    if not group_id:
        return None
    from apps.itsm_groups.models import Group

    group = Group.objects.filter(pk=group_id).only("name").first()
    return group.name if group else None


def ensure_assignee_in_group(group_id, assignee_id):
    """Strict assignment rule: a ticket's assignee must be an active member of its
    assigned group. Raises ``ValueError`` (surfaced as 400 by the API) otherwise.

    A no-op when there is no assignee. Choosing an assignee with no group set is
    rejected — a group must be picked first so its member list is the candidate
    pool (this mirrors the agent UI, which sources the picker from the group).

    Enforced on the agent write paths — ``update_ticket`` (inline detail edits)
    and the view-layer create / assign / bulk-assign actions. The lower-level
    ``create_ticket`` / ``assign`` services stay permissive so programmatic
    callers (routing, SLA escalation, portal/catalog/email, fixtures) are not
    constrained by it."""
    if not assignee_id:
        return
    if not group_id:
        raise ValueError("Assign a group before choosing an assignee.")
    from apps.itsm_groups.models import Group
    from apps.itsm_groups.services import active_member_ids

    group = Group.objects.filter(pk=group_id).first()
    members = {str(m) for m in (active_member_ids(group) if group else [])}
    if str(assignee_id) not in members:
        raise ValueError("Assignee must be a member of the assigned group.")


def ensure_group_allowed(project, group_id):
    """Whitelist rule: a ticket's assigned group must be one of the project's
    allowed groups. Raises ``ValueError`` (surfaced as 400 by the API) otherwise.

    A no-op when there is no group, or when the project doesn't restrict groups
    (empty ``allowed_group_ids`` ⇒ all groups allowed — the default). The project
    default group is always allowed (folded in by ``allowed_group_ids_for``).

    Enforced on the agent write paths — the view-layer create / assign /
    bulk-assign and ``update_ticket`` (inline detail edit). The low-level
    ``create_ticket`` / ``assign`` services stay permissive so routing,
    portal/catalog/email and fixtures aren't constrained by it."""
    if not group_id or project is None:
        return
    from apps.itsm_groups.services import allowed_group_ids_for

    allowed = allowed_group_ids_for(project)
    if allowed is not None and str(group_id) not in allowed:
        raise ValueError("This group is not allowed for this project.")


@transaction.atomic
def create_ticket(*, project, ticket_type, summary, description_html="", requestor=None,
                  priority="medium", assigned_group=None, assignee=None, source="agent",
                  impact="", urgency="", business_impact="", users_affected=None,
                  service_downtime=None, major_incident=False,
                  user=None, apply_routing=True, custom_fields=None):
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
        business_impact=business_impact or "", users_affected=users_affected,
        service_downtime=service_downtime, major_incident=bool(major_incident),
        created_by=user if (user and getattr(user, "pk", None)) else None,
    )

    # Create-time routing fires only when the caller left ownership unset — an
    # explicitly-chosen group/assignee is always respected. A rule may route on a
    # custom field (e.g. Location = Delhi → IT Delhi), so the create payload's
    # custom_fields are passed in (they aren't persisted until after save).
    if apply_routing and assignee is None and assigned_group is None:
        rgroup, rassignee = resolve_group_and_assignee(ticket, custom_fields=custom_fields)
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
        changes["group"] = {"old": str(locked.assigned_group_id), "new": str(group_id),
                            "old_label": _group_label(locked.assigned_group_id),
                            "new_label": _group_label(group_id)}
        locked.assigned_group_id = group_id
    if assignee_id != locked.assignee_id:
        changes["assignee"] = {"old": str(locked.assignee_id), "new": str(assignee_id),
                               "old_label": _user_label(locked.assignee_id),
                               "new_label": _user_label(assignee_id)}
        locked.assignee_id = assignee_id
        if assignee_id and not locked.assigned_at:
            locked.assigned_at = timezone.now()
    locked.updated_by = user if (user and getattr(user, "pk", None)) else None
    locked.save(update_fields=["assigned_group", "assignee", "assigned_at", "updated_by", "updated_at"])

    def _after():
        if "group" in changes:
            log_event(locked, user, "group_changed", payload=changes["group"])
        if "assignee" in changes:
            log_event(locked, user, "assigned", payload=changes["assignee"])
            hooks.emit_event("Assigned", locked, actor=user)

    transaction.on_commit(_after)
    return locked


@transaction.atomic
def update_ticket(*, ticket, user=None, **changes):
    """Single write site for inline field edits from the ticket detail view.

    Updates the editable standard fields — ``priority``, ``requestor_id``,
    ``assignee_id``, ``group_id`` (assigned_group), ``summary``,
    ``description_html``, ``impact``/``urgency`` and the ITIL Impact-Assessment /
    Resolution-Detail fields (``business_impact``, ``users_affected``,
    ``service_downtime``, ``major_incident``, ``resolution_code``, ``root_cause``,
    ``workaround_provided``, ``resolution_notes``) — touching only the keys present
    in ``changes``. Changing ``impact``/``urgency`` auto-derives ``priority`` from
    the project's matrix unless ``priority`` is set in the same call (overridable).
    Each real change is logged (so the activity feed and
    audit trail stay accurate) and an assignee change re-emits ``Assigned`` so the
    notification fan-out fires. The description is sanitised exactly like
    ``create_ticket`` (XSS-safe + mirrored ``description_text``).

    Status changes are NOT handled here — they go through the workflow engine
    (``transition``); ``ticket_type``/``workflow`` are structural and stay
    read-only. Returns the updated (row-locked) ticket.
    """
    from apps.itsm_tickets.models import Ticket

    locked = Ticket.objects.select_for_update().get(pk=ticket.pk)
    fields_to_save: set[str] = set()
    events: list[tuple[str, dict, str | None]] = []  # (action, payload, emit_event|None)

    if "priority" in changes and changes["priority"] != locked.priority:
        events.append(("priority_changed", {"old": locked.priority, "new": changes["priority"]}, None))
        locked.priority = changes["priority"]
        fields_to_save.add("priority")

    if "summary" in changes and changes["summary"] != locked.summary:
        events.append(("summary_changed", {"old": locked.summary, "new": changes["summary"]}, None))
        locked.summary = changes["summary"]
        fields_to_save.add("summary")

    if "description_html" in changes:
        new_html = sanitize_html(changes["description_html"] or "")
        if new_html != locked.description_html:
            locked.description_html = new_html
            locked.description_text = html_to_text(new_html)
            fields_to_save.update({"description_html", "description_text"})
            events.append(("description_changed", {}, None))

    # Text-like ITIL fields (blank-coerced). resolution_code is a choice CharField.
    for attr in ("impact", "urgency", "business_impact", "root_cause",
                 "resolution_notes", "resolution_code"):
        if attr in changes and (changes[attr] or "") != getattr(locked, attr):
            setattr(locked, attr, changes[attr] or "")
            fields_to_save.add(attr)

    # Nullable number/boolean ITIL fields (None means "not assessed").
    for attr in ("users_affected", "service_downtime", "workaround_provided"):
        if attr in changes and changes[attr] != getattr(locked, attr):
            setattr(locked, attr, changes[attr])
            fields_to_save.add(attr)

    if "major_incident" in changes and bool(changes["major_incident"]) != locked.major_incident:
        locked.major_incident = bool(changes["major_incident"])
        fields_to_save.add("major_incident")

    # Auto-derive Priority from the project's matrix when Impact/Urgency changed and
    # the caller did not explicitly set priority in the same edit — "auto-calc,
    # overridable" (a deliberate priority PATCH is always respected).
    if ({"impact", "urgency"} & fields_to_save) and "priority" not in changes:
        from apps.itsm_tickets.services.priority import compute_priority

        derived = compute_priority(locked.project, locked.impact, locked.urgency)
        if derived and derived != locked.priority:
            events.append(("priority_changed", {"old": locked.priority, "new": derived}, None))
            locked.priority = derived
            fields_to_save.add("priority")

    if "requestor_id" in changes and changes["requestor_id"] != locked.requestor_id:
        events.append(("requestor_changed",
                       {"old": str(locked.requestor_id), "new": str(changes["requestor_id"]),
                        "old_label": _user_label(locked.requestor_id),
                        "new_label": _user_label(changes["requestor_id"])}, None))
        locked.requestor_id = changes["requestor_id"]
        fields_to_save.add("requestor")

    if "group_id" in changes and changes["group_id"] != locked.assigned_group_id:
        events.append(("group_changed",
                       {"old": str(locked.assigned_group_id), "new": str(changes["group_id"]),
                        "old_label": _group_label(locked.assigned_group_id),
                        "new_label": _group_label(changes["group_id"])}, None))
        locked.assigned_group_id = changes["group_id"]
        fields_to_save.add("assigned_group")

    if "assignee_id" in changes and changes["assignee_id"] != locked.assignee_id:
        events.append(("assigned",
                       {"old": str(locked.assignee_id), "new": str(changes["assignee_id"]),
                        "old_label": _user_label(locked.assignee_id),
                        "new_label": _user_label(changes["assignee_id"])}, "Assigned"))
        locked.assignee_id = changes["assignee_id"]
        fields_to_save.add("assignee")
        if changes["assignee_id"] and not locked.assigned_at:
            locked.assigned_at = timezone.now()
            fields_to_save.add("assigned_at")

    # A newly-chosen group must be on the project's whitelist (if it has one).
    if "assigned_group" in fields_to_save:
        ensure_group_allowed(locked.project, locked.assigned_group_id)

    # If the assignment changed in any way, the resulting (group, assignee)
    # pairing must satisfy the strict membership rule before we persist.
    if fields_to_save & {"assignee", "assigned_group"}:
        ensure_assignee_in_group(locked.assigned_group_id, locked.assignee_id)

    if fields_to_save:
        locked.updated_by = user if (user and getattr(user, "pk", None)) else None
        fields_to_save.update({"updated_by", "updated_at"})
        locked.save(update_fields=list(fields_to_save))

    def _after():
        for action, payload, emit in events:
            log_event(locked, user, action, payload=payload)
            if emit:
                hooks.emit_event(emit, locked, actor=user)

    transaction.on_commit(_after)
    return locked


@transaction.atomic
def add_comment(*, ticket, author, body_html, visibility="public", mention_user_ids=None,
                attachment_ids=None):
    from apps.itsm_tickets.models import Comment, CommentAttachment, MentionRecord, Ticket

    comment = Comment.objects.create(
        ticket=ticket, author=author if getattr(author, "pk", None) else None,
        visibility=visibility,
        body_html=sanitize_html(body_html), body_text=html_to_text(body_html),
    )
    for uid in set(mention_user_ids or []):
        MentionRecord.objects.get_or_create(comment=comment, mentioned_user_id=uid)

    # Attach the pre-uploaded inline images / files to this reply. Clamped to the
    # same ticket and still-unattached rows so a forged id can't hijack another
    # comment's attachment or pull one in from a different ticket.
    if attachment_ids:
        CommentAttachment.objects.filter(
            id__in=list(attachment_ids), ticket=ticket, comment__isnull=True, is_deleted=False,
        ).update(comment=comment)

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


@transaction.atomic
def link_tickets(*, source, target, link_type, user=None):
    """Create (idempotently) a directed link ``source → target`` and audit it.

    Single write site for links (rules 4 & 5). Uses ``all_objects`` for the lookup
    because the ``uniq_ticket_link`` DB constraint spans soft-deleted rows — a plain
    ``objects.get_or_create`` would miss a soft-deleted pair and then hit the
    constraint. Re-linking a previously-removed pair resurrects that row and re-logs.
    """
    from apps.itsm_tickets.models import TicketLink

    link, created = TicketLink.all_objects.get_or_create(
        source_ticket=source, target_ticket=target, link_type=link_type,
    )
    if not created and link.is_deleted:
        link.is_deleted = False
        link.deleted_at = None
        link.deleted_by = None
        link.save(update_fields=["is_deleted", "deleted_at", "deleted_by"])
        created = True

    if created:
        def _after():
            log_event(source, user, "link_added",
                      payload={"link_id": str(link.id), "target_id": str(target.id),
                               "target_number": target.ticket_number,
                               "target_summary": target.summary, "link_type": link_type})
        transaction.on_commit(_after)
    return link


@transaction.atomic
def unlink_tickets(*, ticket, link, user=None):
    """Soft-delete a link and audit the removal against ``ticket`` (the viewed one)."""
    payload = {"link_id": str(link.id), "link_type": link.link_type,
               "source_id": str(link.source_ticket_id),
               "target_id": str(link.target_ticket_id)}
    link.soft_delete(user=user)

    def _after():
        log_event(ticket, user, "link_removed", payload=payload)

    transaction.on_commit(_after)
    return link
