from __future__ import annotations

# Shared/global teams (helpdesk=null) — available to every helpdesk's routing rules.
DEFAULT_GROUPS = [
    ("Network Team", "network", "network", "Connectivity, VPN, firewall, switching/routing."),
    ("Infrastructure Team", "infra", "infra", "Servers, storage, virtualization, cloud."),
    ("Security Team", "security", "security", "Identity, access, incidents, vulnerabilities."),
    ("Application Support", "app-support", "app_support", "Business application defects and requests."),
]


def run():
    """Seed shared teams + one Service Desk team per helpdesk.

    The per-helpdesk Service Desk is the default landing group for that helpdesk's
    Incident/Request projects, so auto-assignment stays inside the department.
    Group keys/names are globally unique, so the per-helpdesk groups are namespaced
    by the helpdesk key (e.g. `it-service-desk` / "IT Helpdesk Service Desk")."""
    from apps.itsm_helpdesks.models import Helpdesk

    from .models import Group

    created = 0
    for name, key, gtype, desc in DEFAULT_GROUPS:
        _, was_created = Group.objects.get_or_create(
            key=key, defaults={"name": name, "type": gtype, "description": desc, "is_active": True}
        )
        created += int(was_created)

    hd_groups = 0
    for hd in Helpdesk.objects.filter(is_deleted=False, status="active"):
        gkey = f"{hd.key.lower()}-service-desk"
        _, was_created = Group.objects.get_or_create(
            key=gkey,
            defaults={"name": f"{hd.name} Service Desk", "type": "service_desk",
                      "description": f"First line of support for {hd.name}.",
                      "helpdesk": hd, "is_active": True},
        )
        hd_groups += int(was_created)

    return {"shared_groups": len(DEFAULT_GROUPS), "helpdesk_groups": hd_groups,
            "created": created + hd_groups}
