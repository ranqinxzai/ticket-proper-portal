"""Standard-project catalog + per-helpdesk import service.

The catalog is the single registry of standard (one-per-helpdesk) project
templates — Incident, Request and Problem. Incident + Request are auto-seeded
for every active helpdesk at org provisioning (``seed.run()`` iterates the
``auto_seed`` entries); **Problem is import-only**, and helpdesks created later
from the UI import any of the three from Settings → Projects
(``POST /projects/import_standard/``). ``ensure_standard_project`` is the single
provisioning choke-point shared by the seed and the import (rule 4).
"""

from __future__ import annotations

from django.db import transaction

# One entry per standard template, keyed by its project_type.
# ticket_types tuples = (name, key, base_category, is_default).
STANDARD_PROJECT_TEMPLATES = [
    {
        "template": "incident", "auto_seed": True,
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
        "template": "service_request", "auto_seed": True,
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
    {
        "template": "problem", "auto_seed": False,
        "base": "PRB", "name": "Problem Management", "project_type": "problem",
        "color": "#8b5cf6", "icon": "shield-alert",
        "description": "Root-cause analysis of recurring incidents; known errors and workarounds (ITIL Problem).",
        "workflow_base": "problem",
        "ticket_types": [
            ("Problem", "problem", "problem", True),
        ],
        # Problems carry no SLA by default (long-running RCA): the import seeds an
        # empty project-scoped policy so resolve_policy never falls through to the
        # tenant default and no clocks start. Admins add targets in the SLA tab.
        "no_sla": True,
    },
]

TEMPLATES_BY_KEY = {t["template"]: t for t in STANDARD_PROJECT_TEMPLATES}


def _default_workflow_for(spec):
    """The seeded default workflow for a template — self-healing for `problem` on
    tenants provisioned before Problem Management existed."""
    from apps.itsm_workflows.models import Workflow

    wf = Workflow.objects.filter(
        base_type=spec["workflow_base"], is_default=True, is_deleted=False
    ).first()
    if wf is None and spec["workflow_base"] == "problem":
        from apps.itsm_workflows.seed import ensure_problem_workflow

        wf = ensure_problem_workflow()
    return wf


def ensure_standard_project(helpdesk, spec, *, created_by=None, restore_deleted=False):
    """Idempotently create/refresh `helpdesk`'s project for `spec` (a
    STANDARD_PROJECT_TEMPLATES entry): the project row wired to the default
    workflow + the helpdesk's Service Desk group, its starter ticket types, and
    the standard field layout. Returns ``(project, created)``. Shared by
    ``seed.run()`` (auto_seed templates) and ``import_standard_project``.

    ``Project.key`` is unique across ALL rows including soft-deleted ones, so a
    retired standard project still owns its key. The seed path must neither
    crash (the old ``objects``-manager get_or_create raised IntegrityError) nor
    resurrect an admin's deliberate delete → it **skips** (returns
    ``(None, False)``). The import path passes ``restore_deleted=True`` — an
    explicit re-import restores the retired project."""
    from apps.itsm_core.seed import ensure_project_layout
    from apps.itsm_groups.models import Group

    from .models import Project, TicketType

    grp = Group.objects.filter(
        helpdesk=helpdesk, type="service_desk", is_deleted=False
    ).first()
    wf = _default_workflow_for(spec)
    key = f"{helpdesk.key}{spec['base']}"
    project = Project.all_objects.filter(key=key).first()
    created = False
    if project is None:
        project = Project.objects.create(
            key=key,
            helpdesk=helpdesk, name=f"{helpdesk.key} {spec['name']}",
            project_type=spec["project_type"], description=spec["description"],
            color=spec["color"], icon=spec["icon"],
            default_workflow=wf, default_group=grp, status="active",
            created_by=created_by,
        )
        created = True
    elif project.is_deleted:
        if not (restore_deleted
                and project.helpdesk_id == helpdesk.id
                and project.project_type == spec["project_type"]):
            return None, False  # seed: skip a retired standard project
        project.is_deleted = False
        project.deleted_at = None
        project.deleted_by = None
        project.status = "active"
        project.save(update_fields=["is_deleted", "deleted_at", "deleted_by",
                                    "status", "updated_at"])
    # keep helpdesk/workflow/group wiring fresh on re-run
    if (project.helpdesk_id != helpdesk.id
            or project.default_workflow_id != (wf.id if wf else None)
            or project.default_group_id != (grp.id if grp else None)):
        project.helpdesk = helpdesk
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
    return project, created


def _ensure_no_sla_policy(project):
    """A project-scoped SLA policy with **no metrics**: ``resolve_policy`` picks it
    over the tenant default, so no clocks ever start on this project's tickets.
    Admins add metrics/targets later from the project's SLA settings tab."""
    from apps.itsm_sla.models import SLAPolicy

    policy, _ = SLAPolicy.objects.get_or_create(
        project=project, is_deleted=False,
        defaults={
            "name": f"{project.key} — No SLA (default)",
            "description": (
                "Seeded by the Problem template: problems are long-running "
                "root-cause investigations and carry no SLA by default. Add "
                "metrics here to opt in."
            ),
            # ⚠️ NOT is_default: resolve_policy's tenant-wide fallback matches
            # is_default policies regardless of project; a second default would
            # randomly hijack SLA resolution for every other project. A
            # project-scoped policy with empty applies_to already wins for THIS
            # project via the candidates loop.
            "is_default": False, "is_active": True,
        },
    )
    return policy


def _grant_helpdesk_member_access(project):
    """Membership parity with ``seed.seed_project_memberships``: every active
    member of the project's helpdesk gets a ``ProjectMembership`` so the new tab
    is visible immediately (leads/managers see it regardless)."""
    from apps.itsm_helpdesks.models import HelpdeskMembership

    from .models import ProjectMembership

    granted = 0
    for user_id in HelpdeskMembership.objects.filter(
        helpdesk=project.helpdesk, is_active=True, is_deleted=False,
    ).values_list("user_id", flat=True):
        _, created = ProjectMembership.objects.get_or_create(
            project=project, user_id=user_id, defaults={"is_active": True},
        )
        granted += int(created)
    return granted


def template_status(helpdesk):
    """The catalog annotated with this helpdesk's install state — drives the
    Settings → Projects import dialog."""
    from .models import Project

    installed = {
        p.project_type: p
        for p in Project.objects.filter(
            helpdesk=helpdesk, is_deleted=False,
            project_type__in=list(TEMPLATES_BY_KEY),
        )
    }
    out = []
    for spec in STANDARD_PROJECT_TEMPLATES:
        current = installed.get(spec["project_type"])
        out.append({
            "template": spec["template"],
            "name": spec["name"],
            "description": spec["description"],
            "project_type": spec["project_type"],
            "color": spec["color"],
            "icon": spec["icon"],
            "key": f"{helpdesk.key}{spec['base']}",
            "installed": current is not None,
            "installed_project_id": str(current.id) if current else None,
            "installed_project_key": current.key if current else None,
        })
    return out


@transaction.atomic
def import_standard_project(helpdesk, template_key, user=None):
    """Import one standard project into `helpdesk` — the full provisioning chain
    a seeded project gets (project + ticket types + field layout + notification
    scheme + survey config + membership grants, and the no-SLA policy for
    Problem). Raises ``ValueError`` with a user-facing message on any friendly
    rejection (the view maps it to a 400)."""
    from .models import Project

    spec = TEMPLATES_BY_KEY.get(template_key)
    if spec is None:
        raise ValueError("Unknown standard project template.")
    if helpdesk.status != "active":
        raise ValueError("Standard projects can only be imported into an active helpdesk.")
    existing = Project.objects.filter(
        helpdesk=helpdesk, project_type=spec["project_type"], is_deleted=False
    ).first()
    if existing is not None:
        raise ValueError(
            f"This helpdesk already has a {spec['name']} project ({existing.key})."
        )
    key = f"{helpdesk.key}{spec['base']}"
    # key is unique across ALL rows (soft-deleted included) — a foreign/custom
    # squatter blocks the import, but this helpdesk's own retired standard
    # project is restorable (ensure_standard_project restore_deleted).
    squatter = Project.all_objects.filter(key=key).first()
    if squatter is not None and not (
        squatter.is_deleted
        and squatter.helpdesk_id == helpdesk.id
        and squatter.project_type == spec["project_type"]
    ):
        raise ValueError(
            f"Project key {key} is already in use in this organisation."
        )

    project, _ = ensure_standard_project(
        helpdesk, spec, created_by=user, restore_deleted=True
    )
    if project is None:  # unreachable given the pre-checks; belt and braces
        raise ValueError(f"Project key {key} is already in use in this organisation.")

    # Per-project engine config — same chain as ProjectViewSet.perform_create.
    # Guarded: a notification/survey provisioning hiccup must not block the import
    # (both self-heal on the next seed run).
    import logging

    log = logging.getLogger("itsm")
    try:
        from apps.itsm_notifications.seed import ensure_notification_scheme

        ensure_notification_scheme(project)
    except Exception:  # noqa: BLE001
        log.exception("ensure_notification_scheme failed for project %s", project.pk)
    try:
        from apps.itsm_surveys.seed import ensure_survey_config

        ensure_survey_config(project)
    except Exception:  # noqa: BLE001
        log.exception("ensure_survey_config failed for project %s", project.pk)
    try:
        from apps.itsm_tickets.seed import ensure_ticket_templates

        ensure_ticket_templates(project)
    except Exception:  # noqa: BLE001
        log.exception("ensure_ticket_templates failed for project %s", project.pk)

    # NOT guarded: silently falling through to the tenant default SLA would put
    # incident clocks on problems — fail the import loudly instead.
    if spec.get("no_sla"):
        _ensure_no_sla_policy(project)

    _grant_helpdesk_member_access(project)
    return project
