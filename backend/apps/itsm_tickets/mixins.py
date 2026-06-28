from __future__ import annotations

import uuid

from django.shortcuts import get_object_or_404


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
        obj = get_object_or_404(queryset, **filt)
        self.check_object_permissions(self.request, obj)
        return obj
