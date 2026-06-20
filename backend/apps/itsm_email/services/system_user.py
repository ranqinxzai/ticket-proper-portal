"""The non‑login 'email‑bot' system user — the audit actor / created_by for
email‑originated tickets and the author when posting an inbound reply where the
sender can't be attributed."""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model

User = get_user_model()
_cache = {"user": None}


def get_email_bot():
    """Return (and lazily create) the system actor. Cached per process."""
    if _cache["user"] is not None:
        return _cache["user"]
    username = getattr(settings, "EMAIL_SYSTEM_ACTOR_USERNAME", "email-bot")
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, email="", full_name="Email Bot",
                                         is_active=True)
        user.set_unusable_password()
        if hasattr(user, "app_access"):
            user.app_access = []
        user.save()
    _cache["user"] = user
    return user


def reset_cache():
    _cache["user"] = None
