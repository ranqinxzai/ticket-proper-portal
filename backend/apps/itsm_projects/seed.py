"""Seed each active helpdesk's default Incident + Request projects.

Every helpdesk gets its OWN Incident and Request project (IT's Incident is a
different row than HR's). Project keys are prefixed with the helpdesk code so they
stay globally unique and become the ticket-number prefix (helpdesk `IT` → `ITINC`
→ tickets `ITINC-1`). Workflows are shared globally (by base_type); the default
group is the helpdesk's own Service Desk team. Run after helpdesks + workflows +
groups seeds."""

from __future__ import annotations

# base key, name, project_type, color, icon, description, workflow_base, ticket_types
PROJECT_SPECS = [
    {
        "base": "INC", "name": "Incident Management", "project_type": "incident",
        "color": "#ef4444", "icon": "alert-triangle",
        "description": "Service interruptions, outages, defects and production issues (ITIL Incident).",
        "workflow_base": "incident",
        "ticket_types": [
            ("Incident", "incident", "incident", True),
            ("Hardware", "hardware", "incident", False),
            ("Network", "network", "incident", False),
            ("Application", "application", "incident", False),
        ],
    },
    {
        "base": "REQ", "name": "Request Management", "project_type": "service_request",
        "color": "#3b82f6", "icon": "inbox",
        "description": "Access requests, hardware/software/VPN requests (ITIL Service Request).",
        "workflow_base": "service_request",
        "ticket_types": [
            ("Service Request", "service_request", "service_request", True),
            ("Access Request", "access", "service_request", False),
            ("Hardware Request", "hardware_request", "service_request", False),
            ("Onboarding", "onboarding", "service_request", False),
        ],
    },
]


def run():
    from apps.itsm_core.seed import ensure_project_layout
    from apps.itsm_groups.models import Group
    from apps.itsm_helpdesks.models import Helpdesk
    from apps.itsm_workflows.models import Workflow

    from .models import Project, TicketType

    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    created = 0
    for hd in helpdesks:
        grp = Group.objects.filter(helpdesk=hd, type="service_desk", is_deleted=False).first()
        for spec in PROJECT_SPECS:
            wf = Workflow.objects.filter(base_type=spec["workflow_base"], is_default=True).first()
            key = f"{hd.key}{spec['base']}"
            project, was_created = Project.objects.get_or_create(
                key=key,
                defaults={
                    "helpdesk": hd, "name": f"{hd.key} {spec['name']}",
                    "project_type": spec["project_type"], "description": spec["description"],
                    "color": spec["color"], "icon": spec["icon"],
                    "default_workflow": wf, "default_group": grp, "status": "active",
                },
            )
            created += int(was_created)
            # keep helpdesk/workflow/group wiring fresh on re-run
            if (project.helpdesk_id != hd.id
                    or project.default_workflow_id != (wf.id if wf else None)
                    or project.default_group_id != (grp.id if grp else None)):
                project.helpdesk = hd
                project.default_workflow = wf
                project.default_group = grp
                project.save(update_fields=["helpdesk", "default_workflow", "default_group",
                                            "updated_at"])
            for i, (name, tt_key, base_cat, is_default) in enumerate(spec["ticket_types"]):
                TicketType.objects.update_or_create(
                    project=project, key=tt_key,
                    defaults={"name": name, "base_category": base_cat, "is_default": is_default,
                              "sort_order": (i + 1) * 10},
                )
            ensure_project_layout(project)
    return {"helpdesks": len(helpdesks),
            "projects": len(helpdesks) * len(PROJECT_SPECS), "created": created}


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
