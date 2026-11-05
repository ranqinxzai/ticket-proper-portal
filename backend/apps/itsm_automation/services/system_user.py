"""The non-login 'automation-bot' system user — the actor/author for every write an
automation rule makes (audit feed, comments, transitions). Being a distinct user is
also the loop guard: the dispatcher ignores events whose actor is this bot."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import connection

User = get_user_model()
USERNAME = "automation-bot"
# Keyed by tenant schema: each org has its own users table, so a process-wide cache
# (as the email-bot uses) would hand one tenant's user id to another tenant.
_cache: dict[str, object] = {}


def get_automation_bot():
    """Return (and lazily create) this tenant's automation actor."""
    schema = getattr(connection, "schema_name", "public")
    cached = _cache.get(schema)
    if cached is not None:
        return cached
    user = User.objects.filter(username=USERNAME).first()
    if user is None:
        user = User.objects.create_user(username=USERNAME, email="", full_name="Automation",
                                        is_active=True)
        user.set_unusable_password()
        if hasattr(user, "app_access"):
            user.app_access = []
        user.save()
    _cache[schema] = user
    return user


def is_automation_bot(user) -> bool:
    return bool(user is not None and getattr(user, "username", None) == USERNAME)


def reset_cache():
    _cache.clear()
