"""Asset module codes and the two permission classes the asset API uses."""

from __future__ import annotations

from apps.itsm_rbac.permissions import HasModulePermission
from apps.itsm_rbac.services import check_permission

ASSETS = "itsm.assets"            # the register, dashboard and report
IMPORT = "itsm.assets.import"     # Excel import (template, run, history)
CONFIG = "itsm.assets.config"     # categories, fields, statuses, vendors, locations, departments

_SAFE = ("GET", "HEAD", "OPTIONS")


def can_read_lookups(user) -> bool:
    return check_permission(user, ASSETS, "read") or check_permission(user, CONFIG, "read")


class AssetLookupPermission(HasModulePermission):
    """Configuration lists feed the asset form's pickers, so READ is allowed with
    either Assets or Asset Configuration read. Writes follow the view's module
    code (``itsm.assets.config``) and the HTTP method, like every ITSM ViewSet."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in _SAFE:
            return can_read_lookups(user)
        return super().has_permission(request, view)


class AssetDocumentPermission(HasModulePermission):
    """Documents on an asset: reading (list, download) needs Assets read; adding or
    removing one is an EDIT of the asset, so it needs Assets **update** — not create /
    delete, which would hand removal to Supervisors only (user decision 2026-10-31)."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return check_permission(user, ASSETS, "read" if request.method in _SAFE else "update")
