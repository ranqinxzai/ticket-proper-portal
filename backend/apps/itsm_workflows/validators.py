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

    create_transitions = [t for t in transitions if t.from_status_id is None]
    if len(create_transitions) < 1:
        errors.append("Workflow must have a create transition (from_status = none).")

    # reachability from the initial status
    if initials:
        adj = {}
        for t in transitions:
            if t.is_global:
                for s in statuses:
                    adj.setdefault(s.id, set()).add(t.to_status_id)
            elif t.from_status_id:
                adj.setdefault(t.from_status_id, set()).add(t.to_status_id)
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
