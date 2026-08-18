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
                                            {"type": "set_resolution_details", "config": {}},
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

# ITIL Problem workflow — JSM's default problem skeleton (minus the low-value
# "Under Review") plus an explicit **Known Error** status for KEDB visibility
# (JSM models known-error as a resolution; ServiceNow as a flag on the RCA state).
# Problem control (Under Investigation) → error control (Known Error → fix).
PROBLEM_STATUSES = [
    ("new", "New", "todo", "#64748b", True),
    ("under_investigation", "Under Investigation", "in_progress", "#3b82f6", False),
    ("pending", "Pending", "in_progress", "#f59e0b", False),
    ("known_error", "Known Error", "in_progress", "#8b5cf6", False),
    ("resolved", "Resolved", "done", "#22c55e", False),
    ("closed", "Closed", "done", "#16a34a", False),
]
PROBLEM_RESOLVE_PFS = [
    {"type": "set_resolution", "config": {}},
    {"type": "set_resolution_details", "config": {}},
    {"type": "stamp_timestamp", "config": {"field": "resolved_at"}},
    {"type": "stop_sla", "config": {"metric": "resolution"}},
]
PROBLEM_TRANSITIONS = [
    ("Create", None, "new", [], None),
    ("Start Investigation", "new", "under_investigation",
     [{"type": "auto_assign", "config": {"strategy": "round_robin"}},
      {"type": "stamp_timestamp", "config": {"field": "assigned_at"}}], None),
    ("Put on Hold", "under_investigation", "pending",
     [{"type": "pause_sla", "config": {"metric": "resolution"}}], HOLD_NOTE),
    ("Resume", "pending", "under_investigation",
     [{"type": "resume_sla", "config": {"metric": "resolution"}}], None),
    # Root cause documented + workaround recorded → the problem becomes a Known
    # Error (KEDB entry). The capture screen (ensure_problem_screens) makes
    # root_cause mandatory here.
    ("Record Known Error", "under_investigation", "known_error", [], None),
    # ServiceNow-style reassessment of a known error.
    ("Re-analyze", "known_error", "under_investigation", [], None),
    ("Resolve", "under_investigation", "resolved", list(PROBLEM_RESOLVE_PFS), RESOLUTION_NOTE),
    ("Implement Fix", "known_error", "resolved", list(PROBLEM_RESOLVE_PFS), RESOLUTION_NOTE),
    ("Close", "resolved", "closed",
     [{"type": "stamp_timestamp", "config": {"field": "closed_at"}}], None),
    # Reopen clears the RESOLUTION (code/notes) but preserves the KEDB payload —
    # root_cause + workaround_provided were captured at Record Known Error, not at
    # resolve time (workaround_notes is untouched by clear_resolution anyway).
    ("Reopen", "resolved", "under_investigation",
     [{"type": "clear_resolution",
       "config": {"preserve": ["root_cause", "workaround_provided"]}},
      {"type": "stamp_timestamp", "config": {"field": "reopened_at"}}], REOPEN_NOTE),
]

WORKFLOWS = [
    ("Default Incident Workflow", "incident", INCIDENT_STATUSES, INCIDENT_TRANSITIONS),
    ("Default Request Workflow", "service_request", REQUEST_STATUSES, REQUEST_TRANSITIONS),
    ("Default Problem Workflow", "problem", PROBLEM_STATUSES, PROBLEM_TRANSITIONS),
]

# Workflows whose Reopen transition is invokable from the end-user portal.
# Problems are agent-only (never surfaced on the portal), so their Reopen is not.
PORTAL_REOPEN_BASE_TYPES = {"incident", "service_request"}

# ITIL Resolution Details captured on the Incident Resolve screen. Each field_key
# references a global system FieldDefinition (see itsm_core.seed GLOBAL_FIELDS) whose
# config.maps_to routes it to the matching Ticket column (persisted by the engine's
# `set_resolution_details` post-function). Non-mandatory by default — admins can
# require any of them from the Workflow settings tab's per-transition Configure dialog.
RESOLUTION_SCREEN_NAME = "Resolution Details"
RESOLUTION_SCREEN_FIELDS = [
    ("resolution_code", False),
    ("root_cause", False),
    ("workaround_provided", False),
    ("resolution_notes", False),
]


# ITIL Known-Error capture on the Problem "Record Known Error" transition — a
# problem can't become a Known Error without a documented root cause (workaround
# stays optional; admins can flip it mandatory in the transition Configure dialog).
KNOWN_ERROR_SCREEN_NAME = "Root Cause & Workaround"
KNOWN_ERROR_SCREEN_FIELDS = [
    ("root_cause", True),
    ("workaround_notes", False),
    ("workaround_provided", False),
]


def ensure_resolution_screen(workflow, resolve_transition):
    """Idempotently create the workflow's Resolution Details screen + fields and
    attach it to `resolve_transition`. Admin-set mandatory flags on existing fields
    are preserved (get_or_create — defaults only apply on first create). Used by
    the Incident Resolve and both Problem resolve-style transitions (calling it
    twice attaches the same per-workflow screen to each)."""
    from .models import TransitionScreen, TransitionScreenField

    screen, _ = TransitionScreen.objects.get_or_create(
        workflow=workflow, name=RESOLUTION_SCREEN_NAME,
    )
    for i, (field_key, mandatory) in enumerate(RESOLUTION_SCREEN_FIELDS):
        TransitionScreenField.objects.get_or_create(
            screen=screen, field_key=field_key,
            defaults={"is_mandatory": mandatory, "sort_order": (i + 1) * 10},
        )
    if resolve_transition is not None and resolve_transition.screen_id != screen.id:
        resolve_transition.screen = screen
        resolve_transition.save(update_fields=["screen", "updated_at"])
    return screen


def ensure_problem_screens(workflow, transition_objs):
    """Idempotently wire the Problem workflow's capture screens: Root Cause &
    Workaround on **Record Known Error** (root_cause mandatory) and the shared
    Resolution Details screen on **Resolve** + **Implement Fix**."""
    from .models import TransitionScreen, TransitionScreenField

    screen, _ = TransitionScreen.objects.get_or_create(
        workflow=workflow, name=KNOWN_ERROR_SCREEN_NAME,
    )
    for i, (field_key, mandatory) in enumerate(KNOWN_ERROR_SCREEN_FIELDS):
        TransitionScreenField.objects.get_or_create(
            screen=screen, field_key=field_key,
            defaults={"is_mandatory": mandatory, "sort_order": (i + 1) * 10},
        )
    record = transition_objs.get("Record Known Error")
    if record is not None and record.screen_id != screen.id:
        record.screen = screen
        record.save(update_fields=["screen", "updated_at"])
    for tname in ("Resolve", "Implement Fix"):
        tr = transition_objs.get(tname)
        if tr is not None:
            ensure_resolution_screen(workflow, tr)


def _ensure_categories():
    from .models import StatusCategory

    cats = {}
    for key, name, color, order in CATEGORIES:
        cat, _ = StatusCategory.objects.update_or_create(
            key=key, defaults={"name": name, "color": color, "sort_order": order}
        )
        cats[key] = cat
    return cats


def _seed_workflow(cats, wf_name, base_type, statuses, transitions):
    """Idempotently seed one default workflow graph. Returns (workflow, created)."""
    from .models import Status, Transition, Workflow

    wf, created = Workflow.objects.get_or_create(
        name=wf_name, defaults={"base_type": base_type, "is_default": True, "is_active": True}
    )
    status_objs = {}
    for i, (skey, sname, catkey, color, is_initial) in enumerate(statuses):
        st, _ = Status.objects.update_or_create(
            workflow=wf, key=skey,
            defaults={"name": sname, "category": cats[catkey], "color": color,
                      "sort_order": (i + 1) * 10, "is_initial": is_initial,
                      "canvas_x": 80 + i * 200, "canvas_y": 120},
        )
        status_objs[skey] = st
    transition_objs = {}
    for j, (tname, from_key, to_key, post_funcs, note_cfg) in enumerate(transitions):
        note = note_cfg or {}
        tr, _ = Transition.objects.update_or_create(
            workflow=wf, name=tname,
            defaults={"from_status": status_objs.get(from_key) if from_key else None,
                      "to_status": status_objs[to_key], "sort_order": (j + 1) * 10,
                      "post_functions": post_funcs,
                      "note_prompt": bool(note_cfg),
                      "note_required": note.get("required", False),
                      "note_heading": note.get("heading", ""),
                      "note_visibility": note.get("visibility", "public"),
                      # Reopen is the one transition end-users can run from the
                      # portal — but only on portal-facing workflows (problems are
                      # agent-only). Re-seeding re-asserts this (same override
                      # semantics as note_*).
                      "portal_allowed": (tname == "Reopen"
                                         and base_type in PORTAL_REOPEN_BASE_TYPES)},
        )
        transition_objs[tname] = tr

    # ITIL capture screens.
    if base_type == "incident" and "Resolve" in transition_objs:
        ensure_resolution_screen(wf, transition_objs["Resolve"])
    if base_type == "problem":
        ensure_problem_screens(wf, transition_objs)
    return wf, created


def ensure_problem_workflow():
    """Idempotently seed the Default Problem Workflow (statuses, transitions,
    capture screens) and return it. Called from `run()` (fresh orgs / re-seed) and
    lazily by the standard-project import service — a tenant provisioned before
    Problem Management existed self-heals on first import, no data migration
    needed."""
    from .models import Workflow

    existing = Workflow.objects.filter(
        base_type="problem", is_default=True, is_deleted=False
    ).first()
    if existing is not None:
        return existing
    cats = _ensure_categories()
    wf, _ = _seed_workflow(
        cats, "Default Problem Workflow", "problem", PROBLEM_STATUSES, PROBLEM_TRANSITIONS
    )
    # get_or_create in _seed_workflow looks up BY NAME — a same-named workflow
    # that lost its default/active flags (or a pre-existing custom one) must be
    # re-asserted, or the (base_type, is_default) lookup above keeps missing.
    if not wf.is_default or not wf.is_active or wf.base_type != "problem":
        wf.is_default = True
        wf.is_active = True
        wf.base_type = "problem"
        wf.save(update_fields=["is_default", "is_active", "base_type", "updated_at"])
    return wf


def run():
    cats = _ensure_categories()
    made = 0
    for wf_name, base_type, statuses, transitions in WORKFLOWS:
        _, created = _seed_workflow(cats, wf_name, base_type, statuses, transitions)
        made += int(created)
    return {"workflows": len(WORKFLOWS), "created": made}
