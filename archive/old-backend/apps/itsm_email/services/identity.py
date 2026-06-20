"""Sender → User resolution.

SECURITY: externally‑created requestors get a **non‑login** account with NO
``RoleAssignment``. ``itsm_rbac.services.get_user_role`` returns None without an
assignment, so ``check_permission`` denies every module/action — an email sender
can never reach the agent console. We also ``set_unusable_password()``.
"""

from __future__ import annotations

import re

from django.contrib.auth import get_user_model

User = get_user_model()

_LOCALPART_RE = re.compile(r"[^a-z0-9._-]+")


def _unique_username(email: str) -> str:
    base = _LOCALPART_RE.sub("", email.split("@", 1)[0].lower()) or "user"
    base = base[:140]
    candidate = base
    i = 1
    while User.objects.filter(username=candidate).exists():
        suffix = str(i)
        candidate = f"{base[:140 - len(suffix)]}{suffix}"
        i += 1
    return candidate


def resolve_or_create_user(email: str, name: str, *, create_users: bool, default_requestor=None):
    """Return a User for the sender, or the channel default, or None.

    - existing user (case‑insensitive email match) → returned as‑is
    - unknown + create_users → a new non‑login external account (no role)
    - unknown + not create_users → ``default_requestor`` (may be None)
    """
    email = (email or "").strip().lower()
    if not email:
        return default_requestor

    existing = User.objects.filter(email__iexact=email).order_by("date_joined").first()
    if existing:
        return existing

    if not create_users:
        return default_requestor

    user = User.objects.create_user(
        username=_unique_username(email), email=email, full_name=(name or "")[:255],
        is_active=True,
    )
    user.set_unusable_password()
    # External requestors must not carry any ITSM/agent app access.
    if hasattr(user, "app_access"):
        user.app_access = []
    user.save(update_fields=["password", "app_access"] if hasattr(user, "app_access") else ["password"])
    return user
