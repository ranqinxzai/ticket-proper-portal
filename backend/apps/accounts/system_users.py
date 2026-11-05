"""Non-login system accounts (the email intake bot and the automation actor)."""

from __future__ import annotations

from django.conf import settings

AUTOMATION_BOT_USERNAME = "automation-bot"


def system_usernames() -> frozenset[str]:
    return frozenset({
        getattr(settings, "EMAIL_SYSTEM_ACTOR_USERNAME", "email-bot") or "email-bot",
        AUTOMATION_BOT_USERNAME,
    })
