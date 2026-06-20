"""Idempotent seed: the non‑login 'email‑bot' system actor.

Registered as a ``seed_itsm`` STEP. We do NOT seed a live mailbox (channels carry
real credentials); admins create those via the UI. The bot is the audit actor /
created_by for email‑originated tickets.
"""

from __future__ import annotations


def run():
    from .services.system_user import get_email_bot, reset_cache

    reset_cache()
    bot = get_email_bot()
    return {"email_bot": bot.username}
