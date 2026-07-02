"""ITIL Priority Matrix — the single site that derives Priority from Impact × Urgency.

The matrix lives on the project (``Project.priority_matrix``, per-project customisable,
defaulting to the standard ITIL matrix). ``compute_priority`` is the authoritative
server-side calculation; the frontend mirrors it (``lib/itsm/priority.ts``) for the live
UI preview. Keep the two in sync.
"""

from __future__ import annotations


def compute_priority(project, impact, urgency):
    """Return the priority code for ``impact × urgency`` per ``project``'s matrix.

    Returns ``None`` when either input is blank or the matrix has no cell for the
    pair — callers keep the ticket's current priority in that case (so a partial
    assessment never blanks or wrongly downgrades priority). Falls back to the
    standard ITIL matrix when the project has no matrix stored.
    """
    from apps.itsm_projects.models import default_priority_matrix

    if not impact or not urgency:
        return None
    matrix = (project.priority_matrix if project is not None else None) or default_priority_matrix()
    row = matrix.get(impact)
    if not isinstance(row, dict):
        return None
    return row.get(urgency) or None
