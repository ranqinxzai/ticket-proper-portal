"""DRF permission class + base ViewSet for ITSM.

Every ITSM ViewSet declares a ``module_code``. ``HasModulePermission`` maps the
HTTP method to a CRUD action and asks ``check_permission``. A custom ``@action``
may override the module by setting a ``module_code`` attribute on the handler
(used for private comments, bulk ops, portal actions).
"""

from __future__ import annotations

from rest_framework import viewsets
from rest_framework.permissions import BasePermission

from .services import check_permission, get_user_role

# Admin & security audit log: one request-level hook for every ITSM ViewSet (it only
# records module codes in itsm_core.services.audit.AUDITED_AREAS — never ticket traffic).
from apps.itsm_core.audit_mixin import AdminAuditMixin  # noqa: E402

_METHOD_ACTION = {
    "GET": "read",
    "HEAD": "read",
    "OPTIONS": "read",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


def _resolve_module_code(view) -> str | None:
    """Per-action override beats the view-level module_code."""
    action = getattr(view, "action", None)
    if action:
        handler = getattr(view, action, None)
        override = getattr(handler, "module_code", None)
        if override:
            return override
    return getattr(view, "module_code", None)


class HasModulePermission(BasePermission):
    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        module_code = _resolve_module_code(view)
        if not module_code:
            # No module declared → authenticated access only (opt-out for
            # read-only utility endpoints).
            return True
        action = _METHOD_ACTION.get(request.method, "read")
        return check_permission(user, module_code, action)

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class ItsmModelViewSet(AdminAuditMixin, viewsets.ModelViewSet):
    """Base for ITSM resources: JWT auth (global) + module RBAC.

    Subclasses set ``module_code``. Soft-deletable models are deleted via
    ``soft_delete`` rather than a hard DELETE.
    """

    permission_classes = [HasModulePermission]
    module_code: str | None = None

    def perform_destroy(self, instance):
        if hasattr(instance, "soft_delete"):
            instance.soft_delete(user=self.request.user if self.request.user.is_authenticated else None)
        else:
            instance.delete()


class CanUseApprovalInbox(BasePermission):
    """The approver inbox: list *my* pending approvals and approve / reject them.

    Gated by ``itsm.portal.approvals`` (Read) for users who HAVE an ITSM role — the
    portal and the agent app share these endpoints, so the module gates "act on
    approvals assigned to me" everywhere. Who may decide a given request is still the
    approval engine's data-driven approver check. A user with **no** ITSM role keeps
    the pre-2026-10-18 behaviour (only the approvals they are the configured approver
    of): a role grant can't express them, and blocking them would freeze tickets that
    wait on, e.g., a role-less requestor's manager. Superusers bypass.
    """

    message = "Your role doesn't allow you to act on approvals."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "is_superuser", False):
            return True
        if get_user_role(user) is None:
            return True
        return check_permission(user, "itsm.portal.approvals", "read")
