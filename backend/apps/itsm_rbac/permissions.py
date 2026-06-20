"""DRF permission class + base ViewSet for ITSM.

Every ITSM ViewSet declares a ``module_code``. ``HasModulePermission`` maps the
HTTP method to a CRUD action and asks ``check_permission``. A custom ``@action``
may override the module by setting a ``module_code`` attribute on the handler
(used for private comments and bulk ops).
"""

from __future__ import annotations

from rest_framework import viewsets
from rest_framework.permissions import BasePermission

from .services import check_permission

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
            # No module declared → authenticated access only (fail safe-ish for
            # read-only utility endpoints that opt out).
            return True
        action = _METHOD_ACTION.get(request.method, "read")
        return check_permission(user, module_code, action)

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class ItsmModelViewSet(viewsets.ModelViewSet):
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
