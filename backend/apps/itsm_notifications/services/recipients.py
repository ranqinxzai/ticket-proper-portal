"""Resolve a rule's recipient selectors to a deduped set of users, then clamp the
audience for internal events (``restrict_audience``)."""

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
    ("approvers", "Approvers"),
    ("added_watcher", "Added watcher"),
]
NAMED_SELECTOR_KEYS = frozenset(k for k, _ in NAMED_SELECTORS)

# Selectors that only mean something for some events. The settings UI shows these
# chips only on those events (an already-selected chip stays visible so it can be
# removed). Resolution itself is not restricted.
SELECTOR_EVENTS = {
    "added_watcher": ["WatcherAdded"],
}

# Events whose content is internal (agent-only): internal notes and SLA alerts.
# Whatever the rule's selectors say, these only reach agents on the ticket's
# helpdesk — a requestor-added colleague watching the ticket must never be told
# an internal note exists (S3, 2026-10-18).
INTERNAL_EVENTS = frozenset({"CommentAddedPrivate", "SLAWarning", "SLABreach"})
# Internal-NOTE events additionally need read access to internal comments.
_NOTE_EVENTS = frozenset({"CommentAddedPrivate"})


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
            # One filter() call so both conditions apply to the SAME Watcher row —
            # a removed (soft-deleted) watcher is no longer notified.
            users.update(User.objects.filter(watched_tickets__ticket=ticket,
                                             watched_tickets__is_deleted=False))
        elif sel == "mentioned":
            ids = (context or {}).get("user_ids", [])
            users.update(User.objects.filter(pk__in=ids))
        elif sel == "approvers":
            ids = pending_approver_ids(ticket, (context or {}).get("stage"))
            if ids:
                users.update(User.objects.filter(pk__in=ids, is_active=True))
        elif sel == "added_watcher":
            uid = (context or {}).get("watcher_user_id")
            if uid:
                _add(users, uid)
    return users


def _add(users: set, user_id):
    u = User.objects.filter(pk=user_id).first()
    if u:
        users.add(u)


# ── approvers ────────────────────────────────────────────────────────────────

def pending_approver_ids(ticket, stage=None) -> set:
    """User ids who can still act on the ticket's pending approval stage(s).

    Prefers the approvals engine's ``pending_approver_users(ticket, stage=None)``;
    falls back to resolving each pending request's current stage minus the people
    who already acted there. Empty when itsm_approvals isn't installed."""
    try:
        from apps.itsm_approvals.services import engine as approval_engine
    except ImportError:
        return set()
    fn = getattr(approval_engine, "pending_approver_users", None)
    if fn is not None:
        try:
            result = fn(ticket, stage=stage) if stage else fn(ticket)
        except TypeError:
            result = fn(ticket)
        return {getattr(u, "pk", u) for u in (result or [])}

    from apps.itsm_approvals.models import ApprovalAction, ApprovalRequest

    ids: set = set()
    reqs = ApprovalRequest.objects.filter(
        ticket=ticket, status="pending", is_deleted=False
    ).select_related("current_stage")
    for req in reqs:
        st = req.current_stage
        if st is None:
            continue
        acted = set(ApprovalAction.objects.filter(approval_request=req, stage=st)
                    .values_list("approver_id", flat=True))
        ids |= approval_engine.resolve_approver_ids(st, ticket) - acted
    return ids


# ── audience ─────────────────────────────────────────────────────────────────

def is_helpdesk_agent(user, ticket, cache: dict | None = None) -> bool:
    """True when ``user`` works the ticket's helpdesk: a superuser, or an active
    member of the ticket's (active) helpdesk. The same scope primitive every
    ticket query uses (``accessible_helpdesk_ids``). ``cache`` memoises the
    membership lookup per user id across one emit / one serializer pass."""
    if user is None:
        return False
    from apps.itsm_helpdesks.services import accessible_helpdesk_ids

    key = getattr(user, "pk", None)
    if cache is not None and key in cache:
        ids = cache[key]
    else:
        ids = accessible_helpdesk_ids(user)
        if cache is not None:
            cache[key] = ids
    if ids is None:
        return True
    try:
        return ticket.project.helpdesk_id in ids
    except Exception:  # noqa: BLE001 — a broken project link means "not an agent"
        return False


def _is_private_comment(context) -> bool:
    cid = (context or {}).get("comment_id")
    if not cid:
        return False
    try:
        from apps.itsm_tickets.models import Comment
        return Comment.objects.filter(pk=cid, visibility="private").exists()
    except Exception:  # noqa: BLE001 — treat an unreadable comment as internal
        return True


def is_internal_event(event_type, context) -> bool:
    if event_type in INTERNAL_EVENTS:
        return True
    return event_type == "Mentioned" and _is_private_comment(context)


def restrict_audience(users, event_type, ticket, context, cache: dict | None = None) -> set:
    """Drop recipients who must not hear about this event. For internal events
    only agents on the ticket's helpdesk stay; for internal notes (incl. an
    @mention inside one) they must also be able to read internal comments."""
    if not is_internal_event(event_type, context):
        return set(users)
    from apps.itsm_rbac.services import check_permission

    needs_note_read = event_type in _NOTE_EVENTS or event_type == "Mentioned"
    kept = set()
    for u in users:
        if not is_helpdesk_agent(u, ticket, cache):
            continue
        if needs_note_read and not check_permission(u, "itsm.tickets.comments_private", "read"):
            continue
        kept.add(u)
    return kept
