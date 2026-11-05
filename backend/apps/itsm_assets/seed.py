"""Idempotent seed: the six default asset statuses (org-wide).

Shares its list with migration 0002 (which writes the same rows into existing
orgs). Never touches an org that already has statuses.
"""

from __future__ import annotations

# (name, key, state_type, color, is_default, auto_expire_target, sort_order)
DEFAULT_STATUSES = [
    ("In Stock", "in_stock", "available", "#0284c7", True, False, 10),
    ("In Use", "in_use", "in_use", "#16a34a", False, False, 20),
    ("In Repair", "in_repair", "maintenance", "#d97706", False, False, 30),
    ("Expired", "expired", "retired", "#7c3aed", False, True, 40),
    ("Disposed", "disposed", "retired", "#64748b", False, False, 50),
    ("Lost", "lost", "missing", "#dc2626", False, False, 60),
]


def run():
    from .models import AssetStatus

    if AssetStatus.objects.exists():
        return {"statuses": 0}
    for name, key, state, color, default, target, order in DEFAULT_STATUSES:
        AssetStatus.objects.create(name=name, key=key, state_type=state, color=color,
                                   is_default=default, auto_expire_target=target, sort_order=order)
    return {"statuses": len(DEFAULT_STATUSES)}
