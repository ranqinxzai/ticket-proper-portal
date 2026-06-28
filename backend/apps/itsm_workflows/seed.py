"""Seed status categories + the two default workflows."""

from __future__ import annotations

CATEGORIES = [
    ("todo", "To Do", "#94a3b8", 10),
    ("in_progress", "In Progress", "#3b82f6", 20),
    ("done", "Done", "#22c55e", 30),
]

# workflow_key: (name, base_type, [ (status_key, status_name, category, color, is_initial), ... ],
#                [ (transition_name, from_key|None, to_key, [post_functions], note_cfg|None) ])
# note_cfg (optional): {"heading": str, "required": bool, "visibility": "public"|"private"} — when
# set, the transition opens a slide-over asking for a note (posted as a comment) on movement.
RESOLUTION_NOTE = {"heading": "Resolution Note", "required": True, "visibility": "public"}
HOLD_NOTE = {"heading": "Reason to hold", "required": True, "visibility": "public"}
# Reopen prompts for a reason but doesn't force one — a click-to-reopen still works with no
# note (the optional reason lands as a public comment for the audit trail). Reopen is the one
# transition seeded ``portal_allowed=True`` (see the loop below), so end-users can reopen.
REOPEN_NOTE = {"heading": "Reason to reopen", "required": False, "visibility": "public"}

INCIDENT_STATUSES = [
    ("new", "New", "todo", "#64748b", True),
    ("assigned", "Assigned", "todo", "#8b5cf6", False),
    ("in_progress", "In Progress", "in_progress", "#3b82f6", False),
    ("pending", "Pending", "in_progress", "#f59e0b", False),
    ("resolved", "Resolved", "done", "#22c55e", False),
    ("closed", "Closed", "done", "#16a34a", False),
]
INCIDENT_TRANSITIONS = [
    ("Create", None, "new", [], None),
    ("Assign", "new", "assigned", [{"type": "auto_assign", "config": {"strategy": "round_robin"}},
                                   {"type": "stamp_timestamp", "config": {"field": "assigned_at"}}], None),
    ("Start Progress", "assigned", "in_progress", [], None),
    ("Put on Hold", "in_progress", "pending",
     [{"type": "pause_sla", "config": {"metric": "resolution"}}], HOLD_NOTE),
    ("Resume", "pending", "in_progress",
     [{"type": "resume_sla", "config": {"metric": "resolution"}}], None),
    ("Resolve", "in_progress", "resolved", [{"type": "set_resolution", "config": {}},
                                            {"type": "stamp_timestamp", "config": {"field": "resolved_at"}},
                                            {"type": "stop_sla", "config": {"metric": "resolution"}}],
     RESOLUTION_NOTE),
    ("Close", "resolved", "closed", [{"type": "stamp_timestamp", "config": {"field": "closed_at"}}], None),
    ("Reopen", "resolved", "in_progress", [{"type": "clear_resolution", "config": {}},
                                           {"type": "stamp_timestamp", "config": {"field": "reopened_at"}}],
     REOPEN_NOTE),
]

REQUEST_STATUSES = [
    ("new", "New", "todo", "#64748b", True),
    ("approved", "Approved", "todo", "#8b5cf6", False),
    ("in_progress", "In Progress", "in_progress", "#3b82f6", False),
    ("fulfilled", "Fulfilled", "done", "#22c55e", False),
    ("closed", "Closed", "done", "#16a34a", False),
]
REQUEST_TRANSITIONS = [
    ("Create", None, "new", [], None),
    ("Approve", "new", "approved", [], None),
    ("Start Fulfilment", "approved", "in_progress",
     [{"type": "auto_assign", "config": {"strategy": "round_robin"}},
      {"type": "stamp_timestamp", "config": {"field": "assigned_at"}}], None),
    ("Fulfil", "in_progress", "fulfilled",
     [{"type": "stamp_timestamp", "config": {"field": "resolved_at"}},
      {"type": "stop_sla", "config": {"metric": "resolution"}}], RESOLUTION_NOTE),
    ("Close", "fulfilled", "closed", [{"type": "stamp_timestamp", "config": {"field": "closed_at"}}], None),
    ("Reopen", "fulfilled", "in_progress", [{"type": "clear_resolution", "config": {}},
                                            {"type": "stamp_timestamp", "config": {"field": "reopened_at"}}],
     REOPEN_NOTE),
]

WORKFLOWS = [
    ("Default Incident Workflow", "incident", INCIDENT_STATUSES, INCIDENT_TRANSITIONS),
    ("Default Request Workflow", "service_request", REQUEST_STATUSES, REQUEST_TRANSITIONS),
]


def run():
    from .models import Status, StatusCategory, Transition, Workflow

    cats = {}
    for key, name, color, order in CATEGORIES:
        cat, _ = StatusCategory.objects.update_or_create(
            key=key, defaults={"name": name, "color": color, "sort_order": order}
        )
        cats[key] = cat

    made = 0
    for wf_name, base_type, statuses, transitions in WORKFLOWS:
        wf, created = Workflow.objects.get_or_create(
            name=wf_name, defaults={"base_type": base_type, "is_default": True, "is_active": True}
        )
        made += int(created)
        status_objs = {}
        for i, (skey, sname, catkey, color, is_initial) in enumerate(statuses):
            st, _ = Status.objects.update_or_create(
                workflow=wf, key=skey,
                defaults={"name": sname, "category": cats[catkey], "color": color,
                          "sort_order": (i + 1) * 10, "is_initial": is_initial,
                          "canvas_x": 80 + i * 200, "canvas_y": 120},
            )
            status_objs[skey] = st
        for j, (tname, from_key, to_key, post_funcs, note_cfg) in enumerate(transitions):
            note = note_cfg or {}
            Transition.objects.update_or_create(
                workflow=wf, name=tname,
                defaults={"from_status": status_objs.get(from_key) if from_key else None,
                          "to_status": status_objs[to_key], "sort_order": (j + 1) * 10,
                          "post_functions": post_funcs,
                          "note_prompt": bool(note_cfg),
                          "note_required": note.get("required", False),
                          "note_heading": note.get("heading", ""),
                          "note_visibility": note.get("visibility", "public"),
                          # Reopen is the one transition end-users can run from the portal.
                          # Re-seeding re-asserts this (same override semantics as note_*).
                          "portal_allowed": tname == "Reopen"},
            )
    return {"workflows": len(WORKFLOWS), "created": made}
