"""Concurrency-safe, per-project ticket numbering (INC-1, REQ-42, …).

The per-project ``TicketSequence`` row is locked with ``select_for_update`` so
two simultaneous creates can't collide. Must be called inside a transaction.
"""

from __future__ import annotations

from django.db import transaction


def generate_ticket_number(project) -> str:
    from apps.itsm_tickets.models import TicketSequence

    with transaction.atomic():
        seq, _ = TicketSequence.objects.select_for_update().get_or_create(project=project)
        seq.last_number = (seq.last_number or 0) + 1
        seq.save(update_fields=["last_number"])
        return f"{project.key}-{seq.last_number}"
