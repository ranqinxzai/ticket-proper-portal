"""Add ``Module.category`` and backfill it (+ clarity copy) for existing tenants.

Splits the permission tree into two buckets for the role editor:
``operations`` ("Screens & Features") vs ``administration``
("Settings & Administration"). New tenants get this from ``seed_rbac`` at
provision time; this migration backfills already-seeded schemas on the next
``migrate_schemas`` run.

Idempotent and per-schema (RunPython runs inside each tenant schema). On a
freshly created schema the ``Module`` table is still empty at migration time
(modules are seeded *after* migrations by ``provision_org`` → ``seed_itsm``), so
the ``.filter(...).update(...)`` calls match nothing and ``seed_rbac`` supplies
the values later. It touches ONLY ``Module`` rows — never ``RoleModulePermission``
— so hand-edited role grants (e.g. a tenant's customised Supervisor/Agent) are
left completely untouched. The literals are hardcoded (mirrors 0002/0004);
migrations must not import the registry.
"""

from django.db import migrations, models

# The 23 administration codes. Everything else keeps the column default
# ("operations"), so only these rows are flipped.
ADMIN_CODES = [
    "itsm.projects.config", "itsm.catalog.admin", "itsm.knowledge.authoring",
    "itsm.approvals.admin",
    "itsm.workflows", "itsm.workflows.transitions",
    "itsm.fields", "itsm.fields.layouts",
    "itsm.sla", "itsm.sla.policies", "itsm.sla.calendars",
    "itsm.notifications", "itsm.notifications.schemes", "itsm.notifications.templates",
    "itsm.email", "itsm.email.channels", "itsm.email.logs",
    "itsm.dashboards",
    "itsm.surveys.config",
    "itsm.admin", "itsm.admin.roles", "itsm.admin.helpdesks", "itsm.admin.sso",
]

# code -> (name, description). Clarity copy for the most-confused nodes; must stay
# in sync with registry.MODULE_COPY (fresh tenants) — this backfills existing ones.
COPY = {
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


def backfill(apps, schema_editor):
    Module = apps.get_model("itsm_rbac", "Module")
    # The AddField default already made every existing row "operations"; only the
    # admin bucket needs flipping.
    Module.objects.filter(code__in=ADMIN_CODES).update(category="administration")
    for code, (name, desc) in COPY.items():
        Module.objects.filter(code=code).update(name=name, description=desc)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_rbac", "0006_userattributedefinition_userattributeoption_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="module",
            name="category",
            field=models.CharField(
                choices=[
                    ("operations", "Screens & Features"),
                    ("administration", "Settings & Administration"),
                ],
                default="operations",
                max_length=20,
            ),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
