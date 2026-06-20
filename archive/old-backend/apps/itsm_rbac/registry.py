"""Canonical ITSM module registry + role seed.

`MODULES` is the single source of truth for the permission tree. `seed_rbac()`
upserts the modules, the Agent + Supervisor system roles, and their default
CRUD grants. It is idempotent — safe to re-run; it never clobbers admin edits to
*custom* roles (only the two seeded system roles are reset to defaults).
"""

from __future__ import annotations

# (code, name, parent_code, sort_order)
MODULES: list[tuple[str, str, str | None, int]] = [
    ("itsm", "Service Management", None, 10),
    ("itsm.dashboard", "Dashboards", "itsm", 20),

    ("itsm.tickets", "Tickets", "itsm", 100),
    ("itsm.tickets.queue", "Ticket Queue", "itsm.tickets", 101),
    ("itsm.tickets.create", "Create Ticket", "itsm.tickets", 102),
    ("itsm.tickets.bulk", "Bulk Operations", "itsm.tickets", 103),
    ("itsm.tickets.comments", "Comments", "itsm.tickets", 104),
    ("itsm.tickets.comments_private", "Internal Comments", "itsm.tickets", 105),
    ("itsm.tickets.watchers", "Watchers", "itsm.tickets", 106),
    ("itsm.tickets.links", "Ticket Links", "itsm.tickets", 107),
    ("itsm.tickets.templates", "Ticket Templates", "itsm.tickets", 108),
    ("itsm.canned_notes", "Canned Notes", "itsm.tickets", 110),

    ("itsm.projects", "Projects", "itsm", 200),
    ("itsm.projects.config", "Project Configuration", "itsm.projects", 201),
    ("itsm.groups", "Groups / Teams", "itsm", 210),

    ("itsm.workflows", "Workflows", "itsm", 300),
    ("itsm.workflows.transitions", "Transitions / Builder", "itsm.workflows", 301),
    ("itsm.fields", "Custom Fields", "itsm", 310),
    ("itsm.fields.layouts", "Layout Designer", "itsm.fields", 311),

    ("itsm.sla", "SLA Management", "itsm", 400),
    ("itsm.sla.policies", "SLA Policies", "itsm.sla", 401),
    ("itsm.sla.calendars", "Business Calendars", "itsm.sla", 402),

    ("itsm.notifications", "Notifications", "itsm", 500),
    ("itsm.notifications.schemes", "Notification Schemes", "itsm.notifications", 501),
    ("itsm.notifications.templates", "Email Templates", "itsm.notifications", 502),
    ("itsm.notifications.inbox", "My Notifications", "itsm.notifications", 503),

    ("itsm.email", "Email Channel", "itsm", 520),
    ("itsm.email.channels", "Mailbox Channels", "itsm.email", 521),
    ("itsm.email.logs", "Email Logs", "itsm.email", 522),

    ("itsm.reports", "Reports", "itsm", 600),
    ("itsm.reports.sla", "SLA Compliance Reports", "itsm.reports", 601),
    ("itsm.reports.agent", "Agent Performance", "itsm.reports", 602),
    ("itsm.dashboards", "Dashboards (config)", "itsm", 610),

    ("itsm.admin", "ITSM Administration", "itsm", 900),
    ("itsm.admin.roles", "Roles & Permissions", "itsm.admin", 901),
    ("itsm.admin.helpdesks", "Helpdesks", "itsm.admin", 902),
]

# Modules an Agent can fully operate on (read/create/update; no delete, no admin).
AGENT_RW_MODULES = [
    "itsm.dashboard",
    "itsm.tickets", "itsm.tickets.queue", "itsm.tickets.create", "itsm.tickets.bulk",
    "itsm.tickets.comments", "itsm.tickets.comments_private", "itsm.tickets.watchers",
    "itsm.tickets.links", "itsm.tickets.templates", "itsm.canned_notes",
    "itsm.reports", "itsm.reports.sla", "itsm.reports.agent",
    "itsm.dashboards",
]
# Modules an Agent can only read.
AGENT_RO_MODULES = ["itsm", "itsm.projects", "itsm.groups", "itsm.workflows", "itsm.fields",
                    "itsm.sla", "itsm.email", "itsm.email.logs", "itsm.admin.helpdesks"]


def seed_rbac():
    from .models import Module, RoleModulePermission, SystemRole

    # 1) Upsert modules, then wire parents (two passes so order-independent).
    by_code = {}
    for code, name, _parent, order in MODULES:
        mod, _ = Module.objects.update_or_create(
            code=code, defaults={"name": name, "sort_order": order, "is_active": True}
        )
        by_code[code] = mod
    for code, _name, parent_code, _order in MODULES:
        parent = by_code.get(parent_code) if parent_code else None
        if by_code[code].parent_id != (parent.id if parent else None):
            by_code[code].parent = parent
            by_code[code].save(update_fields=["parent", "updated_at"])

    # 2) Seed Agent + Supervisor system roles.
    agent, _ = SystemRole.objects.update_or_create(
        code="agent",
        defaults={"name": "Agent", "is_system": True, "is_active": True,
                  "description": "Front-line agent: work tickets, comment, assign, report."},
    )
    supervisor, _ = SystemRole.objects.update_or_create(
        code="supervisor",
        defaults={"name": "Supervisor", "is_system": True, "is_active": True,
                  "description": "Everything an Agent can do plus full configuration & admin."},
    )

    # 3) Default grants. Supervisor = full CRUD on everything.
    for mod in by_code.values():
        RoleModulePermission.objects.update_or_create(
            role=supervisor, module=mod,
            defaults={"can_read": True, "can_create": True, "can_update": True, "can_delete": True},
        )

    agent_rw = set(AGENT_RW_MODULES)
    agent_ro = set(AGENT_RO_MODULES)
    for code, mod in by_code.items():
        if code in agent_rw:
            bits = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}
        elif code in agent_ro:
            bits = {"can_read": True, "can_create": False, "can_update": False, "can_delete": False}
        else:
            bits = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}
        RoleModulePermission.objects.update_or_create(role=agent, module=mod, defaults=bits)

    return {"modules": len(by_code), "roles": 2}
