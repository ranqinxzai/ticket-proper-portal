"""Create a new, immediately-valid starter workflow.

The workflow config UI can point a project at an *existing* workflow, but there was no way to
create a fresh one from scratch — a project with no matching seeded workflow was stuck (the
Workflow tab dead-ended on "Set a Default workflow in the Overview tab", and the Overview
dropdown only lists pre-seeded globals). A bare ``POST /workflows/`` doesn't help: it creates a
flat record with no statuses and no create-transition, which fails ``validate_workflow_graph``
and is unusable (``ticket_service.create_ticket`` needs an ``is_initial`` status).

``create_starter_workflow`` builds a minimal but **valid** graph (To Do → In Progress → Done +
a create transition) so the new workflow is usable the moment it's linked to a project; the admin
then edits its statuses/transitions in the Workflow tab. This is the single write choke-point
(coding rule 4); the caller links it via ``Project.default_workflow`` separately.
"""

from __future__ import annotations

from django.db import transaction

from ..validators import validate_workflow_graph

# The minimal starter graph, mirroring the seed.py structure:
# (status_key, status_name, category_key, is_initial)
_STARTER_STATUSES = [
    ("to_do", "To Do", "todo", True),
    ("in_progress", "In Progress", "in_progress", False),
    ("done", "Done", "done", False),
]
# (transition_name, from_status_key|None, to_status_key)
_STARTER_TRANSITIONS = [
    ("Create", None, "to_do"),
    ("Start Progress", "to_do", "in_progress"),
    ("Done", "in_progress", "done"),
]

_VALID_BASE_TYPES = {"incident", "service_request", "problem", "custom"}


@transaction.atomic
def create_starter_workflow(name, base_type="custom"):
    """Create a new Workflow with a minimal, valid To Do → In Progress → Done graph.

    ``name`` is required (the caller/view enforces non-blank). ``base_type`` is coerced to
    ``"custom"`` if it isn't one of the three known values. Returns the new ``Workflow``.
    Raises ``ValueError`` if the resulting graph fails validation (a safety net — it never
    should for the fixed starter).
    """
    from ..models import Status, StatusCategory, Transition, Workflow

    clean_name = (name or "").strip()
    if not clean_name:
        raise ValueError("A workflow name is required.")
    if base_type not in _VALID_BASE_TYPES:
        base_type = "custom"

    # The fixed three categories are always seeded (seed_itsm). Reuse them; never create.
    cats = {c.key: c for c in StatusCategory.objects.filter(key__in=[s[2] for s in _STARTER_STATUSES])}
    missing = {s[2] for s in _STARTER_STATUSES} - set(cats)
    if missing:
        raise ValueError(f"Status categories not seeded: {', '.join(sorted(missing))}. Run seed_itsm.")

    wf = Workflow.objects.create(name=clean_name, base_type=base_type, is_default=False,
                                 is_active=True, version=1)

    status_objs = {}
    for i, (skey, sname, catkey, is_initial) in enumerate(_STARTER_STATUSES):
        status_objs[skey] = Status.objects.create(
            workflow=wf, name=sname, key=skey, category=cats[catkey],
            color="#64748b", sort_order=(i + 1) * 10, is_initial=is_initial,
            canvas_x=80 + i * 200, canvas_y=120,
        )

    for j, (tname, from_key, to_key) in enumerate(_STARTER_TRANSITIONS):
        Transition.objects.create(
            workflow=wf, name=tname, sort_order=(j + 1) * 10,
            from_status=status_objs[from_key] if from_key else None,
            to_status=status_objs[to_key],
        )

    result = validate_workflow_graph(wf)
    if not result["valid"]:
        raise ValueError("Generated starter workflow is invalid: " + "; ".join(result["errors"]))
    return wf
