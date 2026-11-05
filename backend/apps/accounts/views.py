"""Directory lookup for the ITSM user pickers (requestor / watcher / assignee search).

S8 (2026-10-18): this router is mounted for every org. It used to be the legacy
QA/PM user API — anonymous reads, and a self-PATCH could set ``is_staff`` and then
anyone's password. It is now a READ-ONLY, agent-only directory with a minimal
shape. Creating / editing users lives in the RBAC users admin
(``itsm_rbac.views.MemberViewSet``); the legacy session login/logout/me routes
are gone (the apps sign in with JWT via ``itsm/auth/login/``).
"""

from rest_framework import permissions, viewsets

from .models import User
from .serializers import UserDirectorySerializer
from .system_users import system_usernames


class IsItsmAgent(permissions.BasePermission):
    """Signed in AND allowed to read tickets (``itsm.tickets`` read) — i.e. an agent.
    Portal requestors never browse the directory (they add watchers by exact email)."""

    message = "You do not have permission to look up users."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        from apps.itsm_rbac.services import check_permission
        return check_permission(user, "itsm.tickets", "read")


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """``GET users/?search=&page_size=`` → ``{id, username, full_name, email}``.
    Active people only; the system bots are hidden."""

    serializer_class = UserDirectorySerializer
    permission_classes = [IsItsmAgent]
    search_fields = ["username", "email", "full_name"]
    filterset_fields: list[str] = []

    def get_queryset(self):
        return (User.objects.filter(is_active=True)
                .exclude(username__in=system_usernames())
                .order_by("full_name", "username", "id"))
