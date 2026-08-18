"""Canonical ITSM module registry + role seed.

`MODULES` is the single source of truth for the permission tree. `seed_rbac()`
upserts the modules and the four seeded system roles (Admin, Supervisor, Agent,
Requestor) with their default CRUD grants. Idempotent — safe to re-run; it never
clobbers admin edits to *custom* roles (only the seeded system roles are reset).

Admin and Supervisor both hold full CRUD on every module; Admin is the explicit
top-level role (the "owner" role you assign to a human admin who isn't a Django
superuser), Supervisor is the team-lead/manager tier. They diverge only if a
future change narrows Supervisor — Admin always tracks the full module tree.
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
    ("itsm.tickets.move", "Move Ticket", "itsm.tickets", 109),
    ("itsm.tickets.print", "Print Ticket", "itsm.tickets", 111),
    ("itsm.canned_notes", "Canned Notes", "itsm.tickets", 110),

    ("itsm.projects", "Projects", "itsm", 200),
    ("itsm.projects.config", "Project Configuration", "itsm.projects", 201),
    ("itsm.groups", "Groups / Teams", "itsm", 210),

    # ── New modules (rebuild) ────────────────────────────────────────────────
    ("itsm.catalog", "Request Catalog", "itsm", 230),
    ("itsm.catalog.admin", "Catalog Administration", "itsm.catalog", 231),
    ("itsm.knowledge", "Knowledge Base", "itsm", 240),
    ("itsm.knowledge.authoring", "KB Authoring", "itsm.knowledge", 241),
    ("itsm.approvals", "Approvals", "itsm", 250),
    ("itsm.approvals.admin", "Approval Workflows", "itsm.approvals", 251),

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

    ("itsm.surveys", "CSAT Surveys", "itsm", 630),
    ("itsm.surveys.config", "Survey Configuration", "itsm.surveys", 631),

    # ── End-user Service Portal ──────────────────────────────────────────────
    ("itsm.portal", "Service Portal", "itsm", 700),
    ("itsm.portal.tickets", "Portal Tickets", "itsm.portal", 701),
    ("itsm.portal.approvals", "Portal Approvals", "itsm.portal", 702),

    ("itsm.admin", "ITSM Administration", "itsm", 900),
    ("itsm.admin.roles", "Roles & Permissions", "itsm.admin", 901),
    ("itsm.admin.helpdesks", "Helpdesks", "itsm.admin", 902),
    ("itsm.admin.sso", "Authentication & SSO", "itsm.admin", 903),
    ("itsm.admin.branding", "Branding", "itsm.admin", 904),
]

# Modules that are settings/configuration/administration surfaces. Everything NOT
# in this set is an operational "Screens & Features" surface (Module.category
# default). Display-only grouping for the role editor — never an access decision.
ADMIN_MODULE_CODES: set[str] = {
    "itsm.projects.config",
    "itsm.catalog.admin",
    "itsm.knowledge.authoring",
    "itsm.approvals.admin",
    "itsm.workflows", "itsm.workflows.transitions",
    "itsm.fields", "itsm.fields.layouts",
    "itsm.sla", "itsm.sla.policies", "itsm.sla.calendars",
    "itsm.notifications", "itsm.notifications.schemes", "itsm.notifications.templates",
    "itsm.email", "itsm.email.channels", "itsm.email.logs",
    "itsm.dashboards",
    "itsm.surveys.config",
    "itsm.admin", "itsm.admin.roles", "itsm.admin.helpdesks", "itsm.admin.sso",
    "itsm.admin.branding",
}

# Clarified display name + help text for the most easily-confused nodes (surfaced
# as a tooltip in the role editor). A code absent here keeps its MODULES name and
# a blank description. `name` overrides MODULES; keyed off `code`, so safe to edit.
MODULE_COPY: dict[str, tuple[str, str]] = {  # code -> (name, description)
    "itsm.projects": (
        "Projects",
        "View and work inside project workspaces — boards, tickets and views. "
        "Turning this off hides Projects from the role entirely.",
    ),
    "itsm.projects.config": (
        "Project Configuration",
        "Create and edit project settings, workflow and membership. "
        "Not required to view or work in projects.",
    ),
    "itsm.groups": (
        "Groups / Teams",
        "See and assign to teams. Managing team membership uses the Create/Update bits.",
    ),
    "itsm.catalog": ("Request Catalog", "Browse and raise catalog requests."),
    "itsm.catalog.admin": (
        "Catalog Administration", "Build and edit catalog items and categories."
    ),
    "itsm.knowledge": ("Knowledge Base", "Read and search knowledge articles."),
    "itsm.knowledge.authoring": (
        "KB Authoring", "Write, edit and publish knowledge articles."
    ),
    "itsm.approvals": ("Approvals", "Act on approvals assigned to the user."),
    "itsm.approvals.admin": (
        "Approval Workflows", "Configure approval rules and workflows."
    ),
    "itsm.notifications": (
        "Notification Settings",
        "Configure notification schemes and email templates. This is NOT the "
        "personal notification inbox.",
    ),
    "itsm.notifications.inbox": (
        "My Notifications", "The user's own notification inbox."
    ),
    "itsm.surveys": ("CSAT Surveys", "View survey results and responses."),
    "itsm.surveys.config": (
        "Survey Configuration", "Design surveys and configure when they are sent."
    ),
    "itsm.reports": ("Reports", "View operational reports and dashboards."),
    "itsm.dashboards": ("Dashboards (config)", "Build and manage shared dashboards."),
}

# Modules an Agent can fully operate on (read/create/update; no delete, no admin).
AGENT_RW_MODULES = [
    "itsm.dashboard",
    "itsm.tickets", "itsm.tickets.queue", "itsm.tickets.create", "itsm.tickets.bulk",
    "itsm.tickets.comments", "itsm.tickets.comments_private", "itsm.tickets.watchers",
    "itsm.tickets.links", "itsm.tickets.templates", "itsm.tickets.move", "itsm.tickets.print",
    "itsm.canned_notes",
    "itsm.knowledge", "itsm.knowledge.authoring",
    "itsm.reports", "itsm.reports.sla", "itsm.reports.agent",
    "itsm.dashboards",
]
# Modules an Agent can only read. Note the config *children* whose READ an agent
# needs to render operational ticket screens: `itsm.fields.layouts` (the create/detail
# form layout resolve) and `itsm.workflows.transitions` (status transitions) — without
# them the closest-ancestor rule stops at the child's explicit read=False row and the
# ticket create form 403s to a blank body.
AGENT_RO_MODULES = [
    "itsm", "itsm.projects", "itsm.groups",
    "itsm.workflows", "itsm.workflows.transitions",
    "itsm.fields", "itsm.fields.layouts",
    "itsm.sla", "itsm.email", "itsm.email.logs", "itsm.admin.helpdesks",
    "itsm.catalog", "itsm.approvals",
]

# Requestor (end-user portal). No helpdesk membership ⇒ the agent ticket scope is
# empty for them; the portal API clamps reads to ``requestor=self`` instead.
REQUESTOR_READ_MODULES = [
    "itsm.portal", "itsm.portal.tickets", "itsm.portal.approvals",
    "itsm.catalog", "itsm.knowledge", "itsm.approvals",
]
REQUESTOR_CREATE_MODULES = ["itsm.portal.tickets", "itsm.catalog"]  # raise ticket / from catalog


def seed_rbac():
    from .models import Module, ModuleCategory, RoleModulePermission, SystemRole

    # 1) Upsert modules, then wire parents (two passes so order-independent).
    by_code = {}
    for code, name, _parent, order in MODULES:
        category = (
            ModuleCategory.ADMINISTRATION
            if code in ADMIN_MODULE_CODES
            else ModuleCategory.OPERATIONS
        )
        copy_name, copy_desc = MODULE_COPY.get(code, (name, ""))
        mod, _ = Module.objects.update_or_create(
            code=code,
            defaults={
                "name": copy_name,
                "description": copy_desc,
                "category": category,
                "sort_order": order,
                "is_active": True,
            },
        )
        by_code[code] = mod
    for code, _name, parent_code, _order in MODULES:
        parent = by_code.get(parent_code) if parent_code else None
        if by_code[code].parent_id != (parent.id if parent else None):
            by_code[code].parent = parent
            by_code[code].save(update_fields=["parent", "updated_at"])

    # 2) Seed system roles.
    admin, _ = SystemRole.objects.update_or_create(
        code="admin",
        defaults={"name": "Admin", "is_system": True, "is_active": True,
                  "description": "Full access to every module — the top-level owner role."},
    )
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
    requestor, _ = SystemRole.objects.update_or_create(
        code="requestor",
        defaults={"name": "Requestor", "is_system": True, "is_active": True,
                  "description": "End user: raise & track requests, browse catalog/KB, approve."},
    )

    # 3) Default grants. Admin + Supervisor (the team-lead / "lead" tier) = full CRUD on
    #    everything. This is the source of the **ticket-delete** policy: `itsm.tickets`
    #    `can_delete=True` is granted to Admin + Supervisor by default (so the ticket-detail
    #    "More ▸ Delete ticket" action is visible to them), while Agent is intentionally
    #    excluded — `AGENT_RW_MODULES` forces `can_delete=False` for `itsm.tickets` below.
    #    Delete is never hardcoded: it is this grantable RBAC bit, editable per-role in the
    #    roles-admin matrix. Existing tenants are backfilled by migration
    #    `0008_grant_ticket_delete_lead_admin` (idempotent, per-schema).
    full_crud = {"can_read": True, "can_create": True, "can_update": True, "can_delete": True}
    for mod in by_code.values():
        for role in (admin, supervisor):
            RoleModulePermission.objects.update_or_create(
                role=role, module=mod, defaults=full_crud,
            )

    # Agent grants.
    agent_rw, agent_ro = set(AGENT_RW_MODULES), set(AGENT_RO_MODULES)
    for code, mod in by_code.items():
        if code in agent_rw:
            bits = {"can_read": True, "can_create": True, "can_update": True, "can_delete": False}
        elif code in agent_ro:
            bits = {"can_read": True, "can_create": False, "can_update": False, "can_delete": False}
        else:
            bits = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}
        RoleModulePermission.objects.update_or_create(role=agent, module=mod, defaults=bits)

    # Requestor grants (portal-scoped read + a couple of create rights).
    req_read, req_create = set(REQUESTOR_READ_MODULES), set(REQUESTOR_CREATE_MODULES)
    for code, mod in by_code.items():
        if code in req_create:
            bits = {"can_read": True, "can_create": True, "can_update": False, "can_delete": False}
        elif code in req_read:
            bits = {"can_read": True, "can_create": False, "can_update": False, "can_delete": False}
        else:
            bits = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False}
        RoleModulePermission.objects.update_or_create(role=requestor, module=mod, defaults=bits)

    return {"modules": len(by_code), "roles": 4}
