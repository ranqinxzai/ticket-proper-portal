from rest_framework.authentication import SessionAuthentication
from rest_framework.pagination import PageNumberPagination


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """Session auth without CSRF enforcement (local dev)."""

    def enforce_csrf(self, request):  # noqa: ARG002
        return


class StandardPagination(PageNumberPagination):
    """DRF page-number pagination that lets the client override `page_size`."""
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 500
