"""Idempotent seed for the ITSM platform.

Runs each app's seed in dependency order. Each step is optional: a step whose
seed module isn't implemented yet (earlier phase) is skipped with a notice, so
this command works at every stage of the rebuild. Safe to re-run.

    python manage.py seed_itsm
"""

from __future__ import annotations

import importlib

from django.core.management.base import BaseCommand
from django.db import transaction

# (label, "module path", "callable") in dependency order. Forward-looking: steps
# for apps not yet built skip cleanly until those phases land.
STEPS = [
    ("RBAC modules & roles", "apps.itsm_rbac.registry", "seed_rbac"),
    ("Helpdesks (workspaces)", "apps.itsm_helpdesks.seed", "run"),
    ("Status categories & workflows", "apps.itsm_workflows.seed", "run"),
    ("Business calendars & SLA policies", "apps.itsm_sla.seed", "run"),
    ("Notification schemes & templates", "apps.itsm_notifications.seed", "run"),
    ("Groups (shared + per-helpdesk service desks)", "apps.itsm_groups.seed", "run"),
    ("Standard field catalog (system fields)", "apps.itsm_core.seed", "seed_system_fields"),
    ("Projects (Incident + Request per helpdesk)", "apps.itsm_projects.seed", "run"),
    ("Default field layouts (per project)", "apps.itsm_core.seed", "backfill_layouts"),
    ("Per-project notification schemes", "apps.itsm_notifications.seed",
     "backfill_notification_schemes"),
    ("Email template designs (refresh all)", "apps.itsm_notifications.seed",
     "backfill_email_templates"),
    ("Approval workflows", "apps.itsm_approvals.seed", "run"),
    ("Request catalog", "apps.itsm_catalog.seed", "run"),
    ("Knowledge base", "apps.itsm_knowledge.seed", "run"),
    ("Canned notes & ticket templates", "apps.itsm_tickets.seed", "run"),
    ("Email channel system user", "apps.itsm_email.seed", "run"),
    ("Helpdesk memberships", "apps.itsm_helpdesks.seed", "seed_memberships"),
    ("Project memberships (per-helpdesk access)", "apps.itsm_projects.seed",
     "seed_project_memberships"),
]


class Command(BaseCommand):
    help = "Seed the ITSM platform (modules, roles, workflows, SLAs, projects, …). Idempotent."

    def handle(self, *args, **options):
        for label, module_path, func_name in STEPS:
            try:
                mod = importlib.import_module(module_path)
                func = getattr(mod, func_name)
            except (ModuleNotFoundError, AttributeError):
                self.stdout.write(self.style.WARNING(f"  • skip   {label} (not implemented yet)"))
                continue
            with transaction.atomic():
                result = func()
            self.stdout.write(self.style.SUCCESS(f"  ✓ seeded {label}  {result or ''}"))
        self.stdout.write(self.style.SUCCESS("ITSM seed complete."))
