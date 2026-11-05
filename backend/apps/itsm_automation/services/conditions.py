"""Rule conditions = the queue FilterSpec, evaluated against ONE ticket.

Reuses the queue compiler (``query_builder.build_q``) instead of a second
evaluator, so every operator, custom field and ``maps_to`` column behaves exactly
as it does in a queue filter. Scope clamps are left unset: this is an internal
check on a ticket the rule's own project already owns.
"""

from __future__ import annotations


def has_conditions(spec) -> bool:
    return bool(isinstance(spec, dict) and spec.get("conditions"))


def matches(ticket, spec) -> bool:
    """True when ``ticket`` satisfies ``spec`` (an empty spec always matches)."""
    if not has_conditions(spec):
        return True
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_tickets.services.query_builder import build_q

    clean = {"match": spec.get("match", "all"), "conditions": spec.get("conditions") or []}
    return Ticket.objects.filter(pk=ticket.pk).filter(build_q(clean)).exists()
