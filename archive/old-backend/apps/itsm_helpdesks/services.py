"""Helpdesk access-scoping primitives.

Every ticket-facing query is clamped to the set of helpdesks the requesting user
may access. The sentinel **`None` means "unrestricted"** (superusers) — callers
must treat `None` as "apply no helpdesk filter", NOT as "no access". A regular
user with no memberships gets `[]`, which correctly hides everything.

The selected helpdesk arrives as an advisory `?helpdesk=<id|key>` query param and
is always intersected with the server-computed accessible set, so a forged/foreign
value can never widen scope (it is a *view scope*, never an authz boundary).
"""

from __future__ import annotations

import uuid

from django.db.models import Q


def accessible_helpdesk_ids(user):
    """Helpdesk ids the user may access.

    Returns ``None`` (unrestricted) for superusers; otherwise the list of helpdesk
    ids the user is an active member of, restricted to active helpdesks. Returns
    ``[]`` for an unauthenticated user or a member of no active helpdesk.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return []
    if getattr(user, "is_superuser", False):
        return None
    from .models import HelpdeskMembership

    return list(
        HelpdeskMembership.objects.filter(
            user=user, is_active=True, is_deleted=False,
            helpdesk__status="active", helpdesk__is_deleted=False,
        ).values_list("helpdesk_id", flat=True)
    )


def accessible_helpdesk_ids_cached(request):
    """`accessible_helpdesk_ids` memoised on the request object (one query/request)."""
    cached = getattr(request, "_itsm_accessible_helpdesk_ids", "__unset__")
    if cached == "__unset__":
        cached = accessible_helpdesk_ids(request.user)
        request._itsm_accessible_helpdesk_ids = cached
    return cached


def _resolve_helpdesk_id(value):
    """Resolve a `?helpdesk=` param (UUID id or short key) to a helpdesk id, or None."""
    if not value:
        return None
    from .models import Helpdesk

    try:
        uuid.UUID(str(value))
        q = Q(pk=value)
    except (ValueError, AttributeError, TypeError):
        q = Q(key=str(value).upper())
    hd = Helpdesk.objects.filter(is_deleted=False).filter(q).first()
    return hd.id if hd else None


def resolve_helpdesk_scope(user, requested=None, *, request=None):
    """The helpdesk ids to scope this request to.

    ``None`` ⇒ unrestricted. ``requested`` is the advisory ``?helpdesk=`` param:
    when it resolves to a helpdesk the user may access, scope narrows to just it;
    otherwise it is ignored (never widens scope, never 403s).
    """
    accessible = accessible_helpdesk_ids_cached(request) if request is not None \
        else accessible_helpdesk_ids(user)
    hd_id = _resolve_helpdesk_id(requested)
    if hd_id is None:
        return accessible
    if accessible is None:  # superuser may narrow to any helpdesk
        return [hd_id]
    return [hd_id] if hd_id in accessible else accessible


def scope_ticket_queryset(qs, scope_ids):
    """AND a helpdesk filter onto a Ticket queryset. ``None`` ⇒ unchanged."""
    if scope_ids is None:
        return qs
    return qs.filter(project__helpdesk_id__in=scope_ids)


def is_project_accessible(user, project_id, *, request=None) -> bool:
    """True if `project_id` belongs to a helpdesk the user may access."""
    accessible = accessible_helpdesk_ids_cached(request) if request is not None \
        else accessible_helpdesk_ids(user)
    if accessible is None:
        return True
    from apps.itsm_projects.models import Project

    return Project.objects.filter(pk=project_id, helpdesk_id__in=accessible).exists()


def helpdesk_member_ids(helpdesk_id):
    """Active member user ids of a helpdesk (used to gate cross-helpdesk @mentions)."""
    from .models import HelpdeskMembership

    return set(
        HelpdeskMembership.objects.filter(
            helpdesk_id=helpdesk_id, is_active=True, is_deleted=False
        ).values_list("user_id", flat=True)
    )


def build_helpdesk_membership(user):
    """`[{id,key,name,icon,color}]` for the `auth/me` payload (superuser ⇒ all active)."""
    from .models import Helpdesk

    if getattr(user, "is_superuser", False):
        qs = Helpdesk.objects.filter(is_deleted=False, status="active")
    else:
        ids = accessible_helpdesk_ids(user) or []
        qs = Helpdesk.objects.filter(pk__in=ids, is_deleted=False)
    return [
        {"id": str(h.id), "key": h.key, "name": h.name, "icon": h.icon, "color": h.color}
        for h in qs.order_by("name")
    ]
