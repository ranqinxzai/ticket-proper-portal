"""GridCrest one-off config (2026-10-14) — run via `manage.py shell`.

"Ticket Info must be filled before Assign": on EVERY live gridcrest workflow, each
Assign transition (named "Assign" or moving into an "Assigned" status) gets an
`is_not_empty` field condition (engine `_check_field_conditions`, block-with-message,
button stays visible) for, in this order:

    Category1, Category2, Category3, User Location, Priority,
    Assigned Group, Assigned Technician, Mode

Field keys are resolved per project from the live catalog (project-scoped def wins
over global, like the engine), so a key is only written when it resolves — and is
placed visibly on the layout — for every project that runs that workflow. Anything
unresolved/ambiguous/unplaced aborts the whole run (a rule on a field an agent can't
fill would brick Assign). Existing conditions on other fields are kept; ours are
replaced in place, so a re-run is idempotent.

KEEP_TECHNICIAN=1 also switches any `auto_assign` post-function on those transitions
to `keep_current` — otherwise round-robin overwrites the technician the agent was
just forced to pick (validators run BEFORE post-functions).

Dry run by default (one transaction, rolled back); APPLY=1 commits.
"""
import os
import re
from collections import defaultdict

from django.db import transaction
from django.db.models import Q
from django_tenants.utils import schema_context

APPLY = os.environ.get("APPLY") == "1"
KEEP_TECHNICIAN = os.environ.get("KEEP_TECHNICIAN") == "1"

# (label in the message, accepted normalized name/key spellings)
REQUIRED = [
    ("Category1", {"category1", "catergory1", "category01"}),
    ("Category2", {"category2", "catergory2", "category02"}),
    ("Category3", {"category3", "catergory3", "category03"}),
    ("User Location", {"userlocation"}),
    ("Priority", {"priority"}),
    ("Assigned Group", {"assignedgroup"}),
    ("Assigned Technician", {"assignee", "assignedtechnician"}),
    ("Mode", {"mode"}),
]
MSG = "{name} must be filled in Ticket Info before this ticket can be assigned."


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


class _Rollback(Exception):
    pass


with schema_context("gridcrest"):
    from apps.itsm_core.models import FieldDefinition, FieldLayoutItem
    from apps.itsm_core.models.fields import FieldType
    from apps.itsm_projects.models import Project
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_workflows.models import Transition, Workflow
    from apps.itsm_workflows.serializers import TransitionSerializer

    def resolve(project, aliases):
        """Live defs visible to `project` matching by key or name; project-scoped wins."""
        hits = [fd for fd in FieldDefinition.objects.filter(is_deleted=False)
                .filter(Q(project=project) | Q(project__isnull=True))
                if norm(fd.key) in aliases or norm(fd.name) in aliases]
        scoped = [fd for fd in hits if fd.project_id] or hits
        return scoped

    def placed(project, fd):
        return FieldLayoutItem.objects.filter(
            layout__project=project, layout__is_deleted=False,
            field=fd, is_deleted=False, is_hidden=False).exists()

    problems = []
    try:
        with transaction.atomic():
            for wf in Workflow.objects.filter(is_deleted=False).order_by("name"):
                proj_ids = set(Project.objects.filter(default_workflow=wf, is_deleted=False)
                               .values_list("id", flat=True))
                proj_ids |= set(Ticket.objects.filter(workflow=wf)
                                .values_list("project_id", flat=True).distinct())
                projects = list(Project.objects.filter(id__in=proj_ids, is_deleted=False))
                targets = [t for t in Transition.objects.filter(workflow=wf, is_deleted=False)
                           .select_related("to_status")
                           if norm(t.name) == "assign"
                           or norm(t.to_status.key) == "assigned"
                           or norm(t.to_status.name) == "assigned"]
                print(f"\n=== Workflow '{wf.name}' projects={[p.key for p in projects]}")
                if not targets:
                    print("  (no Assign transition — skipped)")
                    continue
                if not projects:
                    print("  (no live project uses it — skipped)")
                    continue

                # label → the ONE key every project resolves it to
                rules = []
                for label, aliases in REQUIRED:
                    keys, names = set(), set()
                    for p in projects:
                        defs = resolve(p, aliases)
                        if len(defs) != 1:
                            casc = [f"{fd.key}(levels={(fd.config or {}).get('levels')})"
                                    for fd in FieldDefinition.objects.filter(
                                        Q(project=p) | Q(project__isnull=True),
                                        is_deleted=False, field_type=FieldType.CASCADE)]
                            problems.append(
                                f"{wf.name}/{p.key}: '{label}' resolved to "
                                f"{[f'{d.key}({d.name})' for d in defs] or 'NOTHING'}"
                                + (f"; cascade fields here: {casc}" if label.startswith("Category") else ""))
                            continue
                        fd = defs[0]
                        if not placed(p, fd):
                            problems.append(f"{wf.name}/{p.key}: '{label}' ({fd.key}) is not on "
                                            f"the project's layout (or hidden) — agents can't fill it")
                        keys.add(fd.key)
                        names.add(fd.name)
                    if len(keys) > 1:
                        problems.append(f"{wf.name}: '{label}' maps to different keys across "
                                        f"projects {sorted(keys)} — shared workflow can't hold one rule")
                    elif keys:
                        rules.append({"field_key": keys.pop(), "operator": "is_not_empty",
                                      "message": MSG.format(name=label)})
                print(f"  required keys: {[r['field_key'] for r in rules]}")

                ours = {r["field_key"] for r in rules}
                for t in targets:
                    before = list(t.field_conditions or [])
                    kept = [r for r in before if r.get("field_key") not in ours]
                    merged = TransitionSerializer().validate_field_conditions(rules + kept)
                    print(f"  -> '{t.name}' ({t.from_status.name if t.from_status else '(create)'}"
                          f" -> {t.to_status.name}): {len(before)} rule(s) -> {len(merged)}"
                          f" (kept {len(kept)} unrelated)")
                    t.field_conditions = merged
                    fields = ["field_conditions", "updated_at"]
                    aa = [pf for pf in (t.post_functions or []) if pf.get("type") == "auto_assign"
                          and (pf.get("config") or {}).get("strategy") != "keep_current"]
                    if aa and KEEP_TECHNICIAN:
                        for pf in aa:
                            pf.setdefault("config", {})["strategy"] = "keep_current"
                        fields.append("post_functions")
                        print("     auto_assign -> keep_current (technician picked by agent is kept)")
                    elif aa:
                        print(f"     WARN auto_assign {[pf.get('config') for pf in aa]} will "
                              f"OVERWRITE the required technician (re-run with KEEP_TECHNICIAN=1)")
                    t.save(update_fields=fields)

            if problems:
                print("\nBLOCKING problems — nothing applied:")
                for p in problems:
                    print("  - " + p)
                raise _Rollback
            if not APPLY:
                raise _Rollback
    except _Rollback:
        print("\nDRY RUN / ABORTED — rolled back, nothing changed"
              + ("" if problems else " (set APPLY=1 to commit)"))
    else:
        print("\nAPPLIED — committed")
