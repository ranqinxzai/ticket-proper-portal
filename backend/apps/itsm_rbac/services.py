"""Permission resolution. Single entry point: ``check_permission``."""

from __future__ import annotations

from django.core.cache import cache

_ACTIONS = ("read", "create", "update", "delete")
_CACHE_TTL = 300  # 5 min


def get_user_role(user):
    """Return the user's ITSM SystemRole, or None."""
    if not user or not getattr(user, "is_authenticated", False):
        return None
    assignment = getattr(user, "itsm_role_assignment", None)
    if assignment and assignment.role and assignment.role.is_active:
        return assignment.role
    return None


def _module_chain(code: str) -> list[str]:
    """['itsm.tickets.bulk', 'itsm.tickets', 'itsm'] — walk up the dot tree."""
    parts = code.split(".")
    return [".".join(parts[: i]) for i in range(len(parts), 0, -1)]


def check_permission(user, module_code: str, action: str) -> bool:
    """True if `user` may perform `action` (read|create|update|delete) on `module_code`.

    Superusers bypass. Otherwise the user's role must grant the action on the
    module or one of its ancestors (closest ancestor wins). Cached 5 min per
    (role, module, action).
    """
    if action not in _ACTIONS:
        return False
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True

    role = get_user_role(user)
    if role is None:
        return False

    key = f"itsm_perm:{role.id}:{module_code}:{action}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    from .models import RoleModulePermission

    field = f"can_{action}"
    granted = False
    perms = {
        p.module.code: p
        for p in RoleModulePermission.objects.filter(role=role).select_related("module")
    }
    for code in _module_chain(module_code):
        if code in perms:
            granted = bool(getattr(perms[code], field))
            break  # closest ancestor with an explicit row decides

    cache.set(key, granted, _CACHE_TTL)
    return granted


def invalidate_permission_cache():
    """Call after any role/permission edit. LocMem cache has no pattern delete,
    so we bump a generation token used in cache keys is overkill for v1; clearing
    is acceptable for a small admin surface."""
    cache.clear()
