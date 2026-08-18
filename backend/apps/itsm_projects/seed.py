"""Seed each active helpdesk's default Incident + Request projects.

Every helpdesk gets its OWN Incident and Request project (IT's Incident is a
different row than HR's). Project keys are prefixed with the helpdesk code so they
stay globally unique and become the ticket-number prefix (helpdesk `IT` → `ITINC`
→ tickets `ITINC-1`). Workflows are shared globally (by base_type); the default
group is the helpdesk's own Service Desk team. Run after helpdesks + workflows +
groups seeds.

The template specs live in the standard-project catalog
(`standard_projects.STANDARD_PROJECT_TEMPLATES`) — only the `auto_seed` entries
(Incident + Request) are seeded here; **Problem is import-only** (Settings →
Projects → Import standard project)."""

from __future__ import annotations


def run():
    from apps.itsm_helpdesks.models import Helpdesk

    from .standard_projects import STANDARD_PROJECT_TEMPLATES, ensure_standard_project

    specs = [s for s in STANDARD_PROJECT_TEMPLATES if s.get("auto_seed")]
    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    created = 0
    for hd in helpdesks:
        for spec in specs:
            _, was_created = ensure_standard_project(hd, spec)
            created += int(was_created)
    return {"helpdesks": len(helpdesks),
            "projects": len(helpdesks) * len(specs), "created": created}


def ensure_default_ticket_type(project):
    """Guarantee `project` has at least one active, default TicketType.

    Custom projects created via the API/UI (`ProjectViewSet.perform_create`) ship
    with none — only seeded Incident/Request projects get starter types — which
    hard-blocks the ticket create form ("This project has no ticket type
    configured"). Idempotent: a no-op when the project already has any ticket type.
    """
    from .models import TicketType

    if TicketType.objects.filter(project=project, is_deleted=False).exists():
        return None
    if project.project_type == "service_request":
        name, key, base_cat = "Service Request", "service_request", "service_request"
    elif project.project_type == "incident":
        name, key, base_cat = "Incident", "incident", "incident"
    elif project.project_type == "problem":
        name, key, base_cat = "Problem", "problem", "problem"
    else:  # custom
        name, key, base_cat = "General", "general", "incident"
    return TicketType.objects.create(
        project=project, name=name, key=key, base_category=base_cat,
        is_default=True, is_active=True, sort_order=10,
    )


def backfill_default_ticket_types():
    """Give every project that has no TicketType a sensible default one.

    Targeted repair (safe to run on customised tenants — it never touches existing
    types or any other config). Fixes custom projects created before
    `perform_create` learned to seed a default type."""
    from .models import Project, TicketType

    with_types = set(
        TicketType.objects.filter(is_deleted=False).values_list("project_id", flat=True)
    )
    fixed = 0
    for project in Project.objects.filter(is_deleted=False).exclude(id__in=with_types):
        if ensure_default_ticket_type(project) is not None:
            fixed += 1
    return {"fixed": fixed}


def seed_project_memberships():
    """Grant every active helpdesk member access to all that helpdesk's active
    projects — strict-whitelist parity with helpdesk membership, so a freshly
    seeded agent sees their helpdesk's project tabs. Runs LAST (after projects +
    helpdesk memberships). Idempotent."""
    from apps.itsm_helpdesks.models import HelpdeskMembership

    from .models import Project, ProjectMembership

    by_hd: dict = {}
    for pid, hd_id in (
        Project.objects.filter(is_deleted=False, status="active")
        .values_list("id", "helpdesk_id")
    ):
        by_hd.setdefault(hd_id, []).append(pid)

    made = 0
    for user_id, hd_id in (
        HelpdeskMembership.objects.filter(
            is_active=True, is_deleted=False,
            helpdesk__status="active", helpdesk__is_deleted=False,
        ).values_list("user_id", "helpdesk_id")
    ):
        for pid in by_hd.get(hd_id, []):
            _, created = ProjectMembership.objects.get_or_create(
                project_id=pid, user_id=user_id, defaults={"is_active": True},
            )
            made += int(created)
    return {"granted": made}
