from __future__ import annotations

import uuid


class TicketNumberLookupMixin:
    """Resolve the detail lookup token as either a UUID (pk) or a human-readable
    ticket_number (e.g. 'ITINC-600').

    This lets ticket-detail URLs route by the readable number while old UUID
    bookmarks keep working. Scope and permission checks are preserved because we
    delegate to the viewset's own get_queryset()/check_object_permissions() — the
    only thing that changes versus DRF's GenericAPIView.get_object() is the filter
    key. UUID strings parse and take the ``pk`` branch; ``ITINC-600`` raises
    ValueError and takes the ``ticket_number`` branch.
    """

    def get_object(self):
        queryset = self.filter_queryset(self.get_queryset())
        lookup = self.kwargs.get(self.lookup_url_kwarg or self.lookup_field)
        try:
            uuid.UUID(str(lookup))
            filt = {"pk": lookup}
        except (ValueError, TypeError):
            filt = {"ticket_number": lookup}
        obj = queryset.filter(**filt).first()
        # Old-number fallback: a ticket moved to another project was re-keyed, so its
        # previous number lives in TicketNumberAlias. Resolve it to the current ticket
        # THROUGH the already-scoped queryset (so helpdesk/permission scope still
        # applies — an inaccessible ticket still 404s). The caller/frontend then
        # canonicalises the URL to the new number.
        if obj is None and "ticket_number" in filt:
            from .models import TicketNumberAlias

            alias = (TicketNumberAlias.objects
                     .filter(old_number=filt["ticket_number"]).only("ticket_id").first())
            if alias is not None:
                obj = queryset.filter(pk=alias.ticket_id).first()
        if obj is None:
            from django.http import Http404

            raise Http404("No ticket matches the given query.")
        self.check_object_permissions(self.request, obj)
        return obj
