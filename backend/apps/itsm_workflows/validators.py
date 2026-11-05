"""Admin-time workflow graph validation (run on save / publish)."""

from __future__ import annotations


def validate_workflow_graph(workflow) -> dict:
    statuses = list(workflow.statuses.all())
    transitions = list(workflow.transitions.select_related("from_status", "to_status").all())
    errors, warnings = [], []

    by_id = {s.id: s for s in statuses}
    initials = [s for s in statuses if s.is_initial]
    if len(initials) != 1:
        errors.append(f"Workflow must have exactly one initial status (found {len(initials)}).")

    # A create transition = from_status none AND not global (a global transition with
    # no from_status is "any status", not a create transition — B14).
    create_transitions = [t for t in transitions if t.from_status_id is None and not t.is_global]
    if len(create_transitions) < 1:
        errors.append("Workflow must have a create transition (from_status = none).")
    else:
        from .services.engine import create_transition_for

        used = create_transition_for(workflow)
        if used is None:
            errors.append("The create transition can't lead to a Done status.")
        else:
            extra = [t.name for t in create_transitions if t.id != used.id]
            if extra:
                warnings.append(
                    f"Only one create transition runs (“{used.name}”); "
                    f"{', '.join(f'“{n}”' for n in extra)} never run. Delete them, "
                    "or recreate them with a From status.")
            if initials and used.to_status_id != initials[0].id:
                warnings.append(
                    f"New tickets start in “{used.to_status.name}” (the create transition's "
                    f"target), not the status marked initial (“{initials[0].name}”).")

    # reachability from the initial status
    if initials:
        adj = {}
        for t in transitions:
            if t.is_global:
                for s in statuses:
                    adj.setdefault(s.id, set()).add(t.to_status_id)
            elif t.from_status_id:
                adj.setdefault(t.from_status_id, set()).add(t.to_status_id)
        # Send for approval moves a ticket into its waiting status and back (no
        # transition rows), so those count as edges too.
        for s in statuses:
            if s.allows_send_for_approval and s.approval_waiting_status_id:
                adj.setdefault(s.id, set()).add(s.approval_waiting_status_id)
                adj.setdefault(s.approval_waiting_status_id, set()).add(s.id)
        seen, stack = set(), [initials[0].id]
        for ct in create_transitions:
            stack.append(ct.to_status_id)
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(adj.get(cur, ()))
        orphans = [by_id[s.id].name for s in statuses if s.id not in seen]
        if orphans:
            warnings.append(f"Unreachable statuses: {', '.join(orphans)}.")

    if not any(s.category and s.category.key == "done" for s in statuses):
        errors.append("Workflow has no Done-category status; tickets could never close.")

    # duplicate transitions
    seen_edges = set()
    for t in transitions:
        key = (t.from_status_id, t.to_status_id, t.name)
        if key in seen_edges:
            warnings.append(f"Duplicate transition '{t.name}'.")
        seen_edges.add(key)

    return {"valid": not errors, "errors": errors, "warnings": warnings}
