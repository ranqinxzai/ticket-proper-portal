"""The non‑login 'email‑bot' system user — the audit actor / created_by for
email‑originated tickets and the author when posting an inbound reply where the
sender can't be attributed."""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection

User = get_user_model()
# Keyed by tenant schema: every org has its own users table, so one process-wide
# slot (the pre-2026-10-18 behaviour) handed org A's bot object — an id that may not
# exist in org B, or belong to someone else there — to org B's mail poll.
_cache: dict[str, object] = {}


def get_email_bot():
    """Return (and lazily create) this tenant's system actor. Cached per schema."""
    schema = getattr(connection, "schema_name", "public")
    cached = _cache.get(schema)
    if cached is not None:
        return cached
    username = getattr(settings, "EMAIL_SYSTEM_ACTOR_USERNAME", "email-bot")
    user = User.objects.filter(username=username).first()
    if user is None:
        user = User.objects.create_user(username=username, email="", full_name="Email Bot",
                                         is_active=True)
        user.set_unusable_password()
        if hasattr(user, "app_access"):
            user.app_access = []
        user.save()
    _cache[schema] = user
    return user


def reset_cache():
    _cache.clear()
