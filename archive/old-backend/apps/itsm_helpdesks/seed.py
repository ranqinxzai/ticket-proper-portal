"""Seed the default helpdesks (workspaces). Runs after RBAC, before groups/projects.

Each helpdesk gets its own Incident + Request projects (seeded by itsm_projects),
its own Service Desk group (itsm_groups), and seeded agent memberships (itsm_tickets
seed) — all keyed off the helpdesk `key` so re-runs are idempotent."""

from __future__ import annotations

# (key, name, icon, color, description)
DEFAULT_HELPDESKS = [
    ("IT", "IT Helpdesk", "monitor",
     "#3b82f6", "Helpdesk to manage all IT support — incidents and service requests."),
    ("HR", "HR Helpdesk", "users",
     "#a855f7", "User on-boarding, department change, leave and HR service requests."),
]


def run():
    from .models import Helpdesk

    created = 0
    for key, name, icon, color, desc in DEFAULT_HELPDESKS:
        _, was_created = Helpdesk.objects.get_or_create(
            key=key,
            defaults={"name": name, "icon": icon, "color": color,
                      "description": desc, "status": "active"},
        )
        created += int(was_created)
    return {"helpdesks": len(DEFAULT_HELPDESKS), "created": created}


def seed_memberships():
    """Enroll every real ITSM agent/supervisor into all active helpdesks.

    Runs LAST (after users/roles/helpdesks exist). "Real agent" = a user with an
    active ITSM RoleAssignment; this excludes the email system bot (no role) and
    superusers (who get unrestricted access via the `accessible_helpdesk_ids`
    `None` sentinel and don't need explicit memberships). Idempotent."""
    from django.contrib.auth import get_user_model

    from apps.itsm_rbac.models import RoleAssignment

    from .models import Helpdesk, HelpdeskMembership

    User = get_user_model()
    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    role_user_ids = RoleAssignment.objects.filter(
        is_deleted=False, role__is_active=True
    ).values_list("user_id", flat=True)
    users = list(User.objects.filter(pk__in=role_user_ids, is_active=True, is_superuser=False))
    made = 0
    for hd in helpdesks:
        for user in users:
            _, was_created = HelpdeskMembership.objects.get_or_create(
                helpdesk=hd, user=user,
                defaults={"role_in_helpdesk": "member", "is_active": True},
            )
            made += int(was_created)
    return {"helpdesks": len(helpdesks), "users": len(users), "created": made}
