"""Per-user project access-scoping primitives (the strict-whitelist boundary).

Parallel to ``apps.itsm_helpdesks.services`` but one level finer: a user only sees
a project (its workspace tab, queue, tickets, reports) when they hold an active
``ProjectMembership`` for it — UNLESS an override applies. The sentinel **`None`
means "unrestricted"** (superusers + project admins); callers must treat `None` as
"apply no project filter", NOT "no access". A scoped user with no grants gets `[]`
(sees nothing), exactly like the helpdesk layer.

Overrides (a user sees a project even without an explicit membership):
- they are a **helpdesk lead** of the project's helpdesk → all that helpdesk's
  active projects (a lead manages the whole desk);
- they are the project's own ``lead``.

Empty assignment in a *member* helpdesk yields **no** projects there (strict
whitelist — the deliberate product choice). Existing data is preserved by the
backfill data migration + the ``seed_project_memberships`` seed step.
"""

from __future__ import annotations


def accessible_project_ids(user, request=None):
    """Project ids the user may access, or ``None`` (unrestricted).

    ``None`` ⇒ superuser or project admin (``itsm.projects:update``). Otherwise the
    set of active project ids granted by the rules above, scoped to the user's
    accessible helpdesks. ``[]`` ⇒ a scoped user with no reachable project.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return []
    if getattr(user, "is_superuser", False):
        return None

    from apps.itsm_rbac.services import check_permission

    # Project admins (Supervisors) configure projects → they see them all.
    if check_permission(user, "itsm.projects", "update"):
        return None

    from apps.itsm_helpdesks.models import HelpdeskMembership
    from apps.itsm_helpdesks.services import (
        accessible_helpdesk_ids,
        accessible_helpdesk_ids_cached,
    )

    from .models import Project, ProjectMembership

    accessible_hd = (
        accessible_helpdesk_ids_cached(request)
        if request is not None
        else accessible_helpdesk_ids(user)
    )
    if accessible_hd is None:  # defensive — superuser already returned above
        return None
    if not accessible_hd:
        return []

    # Helpdesks the user LEADS → every active project there (manage-the-desk).
    lead_hd_ids = set(
        HelpdeskMembership.objects.filter(
            user=user, is_active=True, is_deleted=False,
            role_in_helpdesk="lead", helpdesk_id__in=accessible_hd,
        ).values_list("helpdesk_id", flat=True)
    )

    pids: set = set()
    if lead_hd_ids:
        pids.update(
            Project.objects.filter(
                is_deleted=False, status="active", helpdesk_id__in=lead_hd_ids,
            ).values_list("id", flat=True)
        )

    # Member (non-lead) helpdesks → only explicitly-assigned active projects.
    member_hd_ids = [h for h in accessible_hd if h not in lead_hd_ids]
    if member_hd_ids:
        pids.update(
            ProjectMembership.objects.filter(
                user=user, is_active=True, is_deleted=False,
                project__is_deleted=False, project__status="active",
                project__helpdesk_id__in=member_hd_ids,
            ).values_list("project_id", flat=True)
        )

    # A user always sees a project they LEAD (within their accessible helpdesks).
    pids.update(
        Project.objects.filter(
            is_deleted=False, status="active",
            lead=user, helpdesk_id__in=accessible_hd,
        ).values_list("id", flat=True)
    )
    return list(pids)


def accessible_project_ids_cached(request):
    """`accessible_project_ids` memoised on the request (one computation/request)."""
    cached = getattr(request, "_itsm_accessible_project_ids", "__unset__")
    if cached == "__unset__":
        cached = accessible_project_ids(request.user, request=request)
        request._itsm_accessible_project_ids = cached
    return cached


def scope_ticket_queryset_by_project(qs, project_ids):
    """AND a project filter onto a Ticket queryset. ``None`` ⇒ unchanged."""
    if project_ids is None:
        return qs
    return qs.filter(project_id__in=project_ids)
