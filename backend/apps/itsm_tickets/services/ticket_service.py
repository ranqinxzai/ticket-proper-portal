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
                  priority="p3", assigned_group=None, assignee=None, source="agent",
                  impact="", urgency="", business_impact="", users_affected=None,
                  service_downtime=None, major_incident=False,
                  workaround_notes="", investigation_reason="",
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
        workaround_notes=workaround_notes or "",
        investigation_reason=investigation_reason or "",
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
            # `changed_at` marks this as a fresh occurrence in the outbox dedupe
            # key — without it, re-assigning back to a previous assignee never
            # emailed them again (their first "Assigned" row owned the key).
            hooks.emit_event("Assigned", locked, actor=user,
                             context={"changed_at": locked.updated_at.isoformat()})

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

    # Text-like ITIL fields (blank-coerced). resolution_code / investigation_reason
    # are choice CharFields (validated in the view).
    for attr in ("impact", "urgency", "business_impact", "root_cause",
                 "resolution_notes", "resolution_code",
                 "workaround_notes", "investigation_reason"):
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
                # `changed_at` = fresh dedupe occurrence (see assign_ticket).
                hooks.emit_event(emit, locked, actor=user,
                                 context={"changed_at": locked.updated_at.isoformat()})

    transaction.on_commit(_after)
    return locked


def _initial_status(workflow):
    """The workflow's start status (``is_initial``, else lowest ``sort_order``)."""
    from apps.itsm_workflows.models import Status

    return (Status.objects.filter(workflow=workflow, is_initial=True, is_deleted=False).first()
            or Status.objects.filter(workflow=workflow, is_deleted=False).order_by("sort_order").first())


def _values_compatible(source_field, value, target_field):
    """True if a stored custom value can be re-homed onto ``target_field`` without
    becoming invalid/unlabelled. Same type is required (checked by the caller); for
    option/cascade types every stored option value must exist in the target field's
    active options (else the cell would render a bare code). Other types always fit."""
    from apps.itsm_core.models.fields import OPTION_TYPES

    if source_field.field_type not in OPTION_TYPES:
        return True
    vals = value if isinstance(value, list) else ([value] if value not in (None, "") else [])
    if not vals:
        return True
    active = set(
        target_field.options.filter(is_active=True, is_deleted=False).values_list("value", flat=True)
    )
    return all(str(v) in active for v in vals)


def _resolve_target_field(source_field, value, target_defs, mapped_key, dropped):
    """Pick the target ``FieldDefinition`` for a source project-scoped field.

    Precedence: an explicit ``dropped`` request → None; an explicit ``mapped_key``
    override (validated for type + option compatibility) → that field or None;
    else auto-match by key + type + option-value compatibility. ``target_defs`` is
    ``{key: FieldDefinition}`` of the TARGET project's own (non-global) fields."""
    if dropped:
        return None
    if mapped_key:
        tf = target_defs.get(mapped_key)
        if tf is None or tf.field_type != source_field.field_type or not _values_compatible(source_field, value, tf):
            return None
        return tf
    tf = target_defs.get(source_field.key)
    if tf is None or tf.field_type != source_field.field_type or not _values_compatible(source_field, value, tf):
        return None
    return tf


@transaction.atomic
def move_ticket(*, ticket, target_project, target_ticket_type, target_status,
                field_mapping=None, drop_field_keys=None, target_category=None, user=None):
    """Structurally re-home a ticket into another project **in the same helpdesk**.

    Re-keys the ticket number (fresh from the target project's sequence), re-points
    ``project``/``ticket_type``/``workflow``/``status``, remaps or drops value-backed
    custom fields, re-validates assignment against the target's group whitelist,
    writes a ``TicketNumberAlias`` so the old number auto-redirects, and logs a
    single ``ticket_moved`` audit event. Comments/attachments/watchers/links/history
    ride the ticket UUID and are untouched. SLA clocks are intentionally left as-is
    (product decision: keep existing clocks). If the ticket has a pending approval
    the move is allowed — the approval is cancelled and the ticket lands on the
    target workflow's **initial** status (so it isn't frozen in the new project).

    Raises ``ValueError`` (→ 400 at the view) for any invalid target. Returns the
    row-locked, moved ticket.
    """
    from apps.itsm_core.models import FieldValue
    from apps.itsm_core.services import fields as field_service
    from apps.itsm_tickets.models import Ticket, TicketNumberAlias
    from apps.itsm_tickets.services.priority import compute_priority
    from apps.itsm_workflows.services.engine import has_pending_approval

    locked = Ticket.objects.select_for_update().get(pk=ticket.pk)
    source_project = locked.project
    old_number = locked.ticket_number
    from_status = locked.status
    from_type = locked.ticket_type

    # ── Validate the target ─────────────────────────────────────────────────────
    if target_project.id == source_project.id:
        raise ValueError("Ticket is already in this project.")
    if target_project.helpdesk_id != source_project.helpdesk_id:
        raise ValueError("A ticket can only be moved within the same helpdesk.")
    if getattr(target_project, "status", None) != "active" or target_project.is_deleted:
        raise ValueError("The target project is not active.")
    target_workflow = target_project.default_workflow
    if target_workflow is None:
        raise ValueError("The target project has no default workflow configured.")
    if (target_ticket_type is None or target_ticket_type.project_id != target_project.id
            or not target_ticket_type.is_active):
        raise ValueError("Choose a ticket type that belongs to the target project.")

    # ── Pending approval → allow, cancel it, land on the target start status ────
    cancelled_approvals = 0
    if has_pending_approval(locked):
        from apps.itsm_approvals.services import engine as approval_engine

        cancelled_approvals = approval_engine.cancel_pending(locked, user=user)
        landing = _initial_status(target_workflow)
        if landing is None:
            raise ValueError("The target workflow has no statuses.")
    else:
        landing = target_status
        if landing is None or landing.workflow_id != target_workflow.id or landing.is_deleted:
            raise ValueError("Choose a status that belongs to the target project's workflow.")

    # ── Reconcile custom fields (snapshot BEFORE re-point) ──────────────────────
    src_values = field_service.get_values(locked)  # {key: serialized}
    src_rows = list(
        FieldValue.objects.filter(ticket=locked, is_deleted=False).select_related("field")
    )
    target_defs = {
        f.key: f for f in field_service.get_field_definitions(target_project)
        if f.project_id == target_project.id
    }
    field_mapping = field_mapping or {}
    drop_keys = set(drop_field_keys or [])

    dropped_fields: list[dict] = []   # [{key, name}]
    remapped_fields: list[dict] = []  # [{from_key, to_key}]
    remap_writes: dict = {}           # {target_key: value}
    for fv in src_rows:
        if fv.field.project_id is None:
            continue  # global field — its definition is shared, so it carries over as-is
        key = fv.field.key
        value = src_values.get(key)
        # `category` is per-project (its option tree differs) — always dropped here;
        # the caller re-selects it via `target_category` below.
        if key == "category":
            fv.soft_delete(user=user)
            if not target_category:
                dropped_fields.append({"key": key, "name": fv.field.name})
            continue
        target_field = _resolve_target_field(
            fv.field, value, target_defs, field_mapping.get(key), key in drop_keys
        )
        fv.soft_delete(user=user)  # free the source (ticket, field) slot either way
        if target_field is not None and value not in (None, "", []):
            remap_writes[target_field.key] = value
            remapped_fields.append({"from_key": key, "to_key": target_field.key})
        else:
            dropped_fields.append({"key": key, "name": fv.field.name})

    # ── Re-key + re-point ───────────────────────────────────────────────────────
    new_number = generate_ticket_number(target_project)
    locked.ticket_number = new_number
    locked.project = target_project
    locked.ticket_type = target_ticket_type
    locked.workflow = target_workflow
    locked.status = landing
    fields_to_save = {"ticket_number", "project", "ticket_type", "workflow", "status"}

    # ── Assignment: re-validate against the target project's group whitelist ────
    from apps.itsm_groups.services import allowed_group_ids_for

    group_reset = False
    assignee_cleared = False
    allowed = allowed_group_ids_for(target_project)
    if locked.assigned_group_id and allowed is not None and str(locked.assigned_group_id) not in allowed:
        locked.assigned_group = target_project.default_group
        fields_to_save.add("assigned_group")
        group_reset = True
    if locked.assignee_id:
        try:
            ensure_assignee_in_group(locked.assigned_group_id, locked.assignee_id)
        except ValueError:
            locked.assignee_id = None
            fields_to_save.add("assignee")
            assignee_cleared = True

    # ── Priority: re-derive from the target project's matrix (overridable auto) ─
    priority_change = None
    derived = compute_priority(target_project, locked.impact, locked.urgency)
    if derived and derived != locked.priority:
        priority_change = {"old": locked.priority, "new": derived}
        locked.priority = derived
        fields_to_save.add("priority")

    # ── Keep resolved/closed stamps consistent with the landing status category ─
    landing_done = landing.category.key == "done"
    if not landing_done and (locked.resolved_at or locked.closed_at):
        locked.resolved_at = None
        locked.closed_at = None
        fields_to_save.update({"resolved_at", "closed_at"})
    elif landing_done and locked.resolved_at is None:
        locked.resolved_at = timezone.now()
        fields_to_save.add("resolved_at")

    locked.updated_by = user if (user and getattr(user, "pk", None)) else None
    fields_to_save.update({"updated_by", "updated_at"})
    locked.save(update_fields=list(fields_to_save))

    # ── Alias (redirect) + re-write the remapped custom values ──────────────────
    TicketNumberAlias.objects.create(
        ticket=locked, old_number=old_number, old_project=source_project,
        new_number=new_number, moved_by=user if (user and getattr(user, "pk", None)) else None,
    )
    if target_category:
        remap_writes["category"] = target_category
    if remap_writes:
        field_service.set_values(locked, remap_writes, user)

    move_payload = {
        "from_project_id": str(source_project.id), "to_project_id": str(target_project.id),
        "from_project_key": source_project.key, "to_project_key": target_project.key,
        "from": source_project.name, "to": target_project.name,
        "old_number": old_number, "new_number": new_number,
        "from_status": from_status.name, "to_status": landing.name,
        "from_ticket_type": from_type.name if from_type else None,
        "to_ticket_type": target_ticket_type.name,
        "dropped_fields": dropped_fields, "remapped_fields": remapped_fields,
        "group_reset": group_reset, "assignee_cleared": assignee_cleared,
        "priority": priority_change, "cancelled_approvals": cancelled_approvals,
    }

    def _after():
        log_event(locked, user, "ticket_moved", payload=move_payload)
        if cancelled_approvals:
            log_event(locked, user, "approval_cancelled",
                      payload={"count": cancelled_approvals, "reason": "ticket moved to another project"})
        # Resolves the TARGET project's scheme at emit time; a no-op until a
        # ``TicketMoved`` notification rule is configured. SLA is intentionally NOT
        # restarted (keep-existing-clocks decision).
        hooks.emit_event("TicketMoved", locked, actor=user,
                         context={"old_number": old_number, "new_number": new_number})

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
