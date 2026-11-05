"""Copy a (shared) workflow — "Make a copy for this project" (U6, 2026-10-18).

Workflows are shared: every project whose ``default_workflow`` points at one uses the
same statuses and transitions, so an edit lands on all of them. ``clone_workflow``
duplicates the whole graph (statuses, capture screens + fields, transitions with every
config column, their conditions, reopen rules) and, when a project is given, links the
copy as that project's ``default_workflow`` in the same transaction — and re-points
that project's automation rules from the old workflow's ids to the copy's.

Rule 10 (config snapshots): existing tickets keep their snapshotted
``Ticket.workflow``, so open tickets created before the copy stay on the shared
workflow; only NEW tickets use the copy. Single write choke-point (rule 4).
"""

from __future__ import annotations

import copy

from django.db import transaction

from ..validators import validate_workflow_graph


def default_copy_name(source, project=None) -> str:
    base = f"{source.name} ({project.key})" if project is not None else f"{source.name} (copy)"
    return base[:150]


def _name_taken(name, exclude_id=None) -> bool:
    from ..models import Workflow

    qs = Workflow.objects.filter(name__iexact=name.strip(), is_deleted=False)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


@transaction.atomic
def clone_workflow(source, *, name=None, project=None):
    """Duplicate ``source`` and (optionally) link it to ``project``.

    Returns ``(workflow, automation_report)`` where the report is
    ``{"repointed": int, "unmatched": [str]}`` (empty when no project / no
    itsm_automation). Raises ``ValueError`` for a blank or duplicate name — names must
    be unique among live workflows, because the seed looks workflows up by name."""
    from ..models import (
        ReopenRule,
        Status,
        Transition,
        TransitionCondition,
        TransitionScreen,
        TransitionScreenField,
        Workflow,
    )

    clean = (name or "").strip() or default_copy_name(source, project)
    if len(clean) > 150:
        raise ValueError("The workflow name is too long (150 characters max).")
    if _name_taken(clean):
        raise ValueError(f"A workflow named “{clean}” already exists. Pick another name.")

    desc = f"Copy of “{source.name}”" + (f" for {project.key}" if project is not None else "")
    wf = Workflow.objects.create(
        name=clean, description=desc, base_type=source.base_type,
        is_default=False, is_active=True, version=1,
    )

    status_map = {}
    for s in source.statuses.all():  # live rows (default manager)
        status_map[s.id] = Status.objects.create(
            workflow=wf, name=s.name, key=s.key, category_id=s.category_id, color=s.color,
            sort_order=s.sort_order, is_initial=s.is_initial, pauses_sla=s.pauses_sla,
            allows_send_for_approval=s.allows_send_for_approval,
            canvas_x=s.canvas_x, canvas_y=s.canvas_y,
        )
    # Second pass: a waiting status points at a sibling, so remap it to the copy's.
    for s in source.statuses.filter(approval_waiting_status__isnull=False):
        target = status_map.get(s.approval_waiting_status_id)
        if target is not None:
            status_map[s.id].approval_waiting_status = target
            status_map[s.id].save(update_fields=["approval_waiting_status"])

    screen_map = {}
    for sc in source.screens.all():
        new_sc = TransitionScreen.objects.create(workflow=wf, name=sc.name)
        screen_map[sc.id] = new_sc
        for f in sc.fields.all():
            TransitionScreenField.objects.create(
                screen=new_sc, field_key=f.field_key, is_mandatory=f.is_mandatory,
                sort_order=f.sort_order,
            )

    for t in source.transitions.prefetch_related("conditions").all():
        if t.to_status_id not in status_map:
            continue  # into a deleted status — never copy a dead edge
        if t.from_status_id is not None and t.from_status_id not in status_map:
            continue
        new_t = Transition.objects.create(
            workflow=wf, name=t.name,
            from_status=status_map.get(t.from_status_id) if t.from_status_id else None,
            to_status=status_map[t.to_status_id], is_global=t.is_global,
            sort_order=t.sort_order,
            post_functions=copy.deepcopy(t.post_functions or []),
            field_conditions=copy.deepcopy(t.field_conditions or []),
            auto_assign_rule_id=t.auto_assign_rule_id,  # global rule — same reference
            screen=screen_map.get(t.screen_id),
            note_prompt=t.note_prompt, note_required=t.note_required,
            note_heading=t.note_heading, note_visibility=t.note_visibility,
            portal_allowed=t.portal_allowed,
        )
        for c in t.conditions.all():
            TransitionCondition.objects.create(
                transition=new_t, condition_type=c.condition_type,
                config=copy.deepcopy(c.config or {}), negate=c.negate,
            )

    for rr in source.reopen_rules.all():
        if rr.reopen_to_status_id in status_map:
            ReopenRule.objects.create(
                workflow=wf, reopen_to_status=status_map[rr.reopen_to_status_id],
                window_days=rr.window_days, requires_comment=rr.requires_comment,
            )

    result = validate_workflow_graph(wf)
    if not result["valid"] and validate_workflow_graph(source)["valid"]:
        raise ValueError("The copy failed validation: " + "; ".join(result["errors"]))

    report = {"repointed": 0, "unmatched": []}
    if project is not None:
        project.default_workflow = wf
        project.save(update_fields=["default_workflow", "updated_at"])
        report = _repoint_automation(project, source, wf)
    return wf, report


def _repoint_automation(project, old_wf, new_wf):
    """Re-point the project's automation rules to the copy (lazy, optional app)."""
    from django.apps import apps

    if not apps.is_installed("apps.itsm_automation"):
        return {"repointed": 0, "unmatched": []}
    from apps.itsm_automation.services.workflow_remap import repoint_project_rules

    return repoint_project_rules(project, old_wf, new_wf)
