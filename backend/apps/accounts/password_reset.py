"""Self-service password reset (U14, 2026-10-18) — the service layer.

Flow: "Forgot password?" → ``request_reset(login)`` emails a link to
``/t/<org>/reset-password?uid=…&token=…`` → the page calls ``validate`` then
``confirm(uid, token, new_password)``.

- **Never leaks whether an account exists**: the API answers the same whatever
  ``login`` matched; the work (or no work) happens silently.
- **Who gets an email**: active accounts with an email and a usable local
  password that sign in with a password. Microsoft-SSO users, the two system bots
  and the no-login accounts email intake creates get nothing.
- **Token**: Django's ``PasswordResetTokenGenerator`` (HMAC over the user's id,
  password hash, last login, email and a timestamp) plus the org's schema name,
  so a link from one org is useless in another even where integer user ids
  collide. It is single-use (setting the password changes the hash) and expires
  after ``RESET_VALID_MINUTES``.
- **Delivery**: the notification outbox (platform SMTP tier), via
  ``hooks.send_password_reset_email``.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection
from django.db.models import Q
from django.utils.encoding import force_bytes, force_str
from django.utils.http import base36_to_int, urlsafe_base64_decode, urlsafe_base64_encode
from django_tenants.utils import get_public_schema_name

from .models import AuthMethod, User
from .system_users import system_usernames

logger = logging.getLogger("itsm")

RESET_VALID_MINUTES = int(getattr(settings, "ITSM_PASSWORD_RESET_MINUTES", 60))
INVALID_LINK = "This reset link is invalid or has expired. Request a new one."


def current_org() -> str | None:
    """The active tenant schema (= the ``/t/<org>/`` slug), or ``None`` on the public
    schema, where platform-admin accounts live and no reset is offered."""
    schema = getattr(connection, "schema_name", "") or ""
    if not schema or schema == get_public_schema_name():
        return None
    return schema


class TenantPasswordResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "apps.accounts.password_reset.TenantPasswordResetTokenGenerator"

    def _make_hash_value(self, user, timestamp):
        # Bind the token to the org it was issued in.
        return f"{current_org() or ''}|{super()._make_hash_value(user, timestamp)}"

    def check_token(self, user, token):
        if not super().check_token(user, token):
            return False
        # Django's own window is PASSWORD_RESET_TIMEOUT (days); ours is minutes.
        try:
            ts = base36_to_int(token.split("-")[0])
        except (ValueError, AttributeError):
            return False
        return (self._num_seconds(self._now()) - ts) <= RESET_VALID_MINUTES * 60


token_generator = TenantPasswordResetTokenGenerator()


def eligible(user) -> bool:
    """May this account reset its password by email?"""
    return bool(
        user is not None
        and user.is_active
        and (user.email or "").strip()
        and user.has_usable_password()
        and user.auth_method == AuthMethod.PASSWORD
        and user.username not in system_usernames()
    )


def reset_url(user) -> str:
    base = getattr(settings, "FRONTEND_BASE_URL", "")
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = token_generator.make_token(user)
    return f"{base}/t/{current_org()}/reset-password?uid={uid}&token={token}"


def request_reset(login: str) -> int:
    """Email a reset link to every eligible account whose username or email is
    ``login`` (case-insensitive). Returns how many were queued — for logs/tests
    only, NEVER for the API response."""
    from apps.itsm_core.services import hooks

    login = (login or "").strip()
    if not login or current_org() is None:
        return 0
    queued = 0
    for user in User.objects.filter(Q(username__iexact=login) | Q(email__iexact=login)):
        if not eligible(user):
            continue
        if hooks.send_password_reset_email(user, reset_url(user), RESET_VALID_MINUTES):
            queued += 1
    logger.info("password reset requested in %s: %d email(s) queued", current_org(), queued)
    return queued


def user_for(uid, token):
    """The account a (uid, token) pair is valid for, else ``None``."""
    if current_org() is None or not uid or not token:
        return None
    try:
        pk = force_str(urlsafe_base64_decode(str(uid)))
        user = User.objects.filter(pk=int(pk)).first()
    except (TypeError, ValueError, OverflowError):
        return None
    if not eligible(user) or not token_generator.check_token(user, str(token)):
        return None
    return user


def confirm(uid, token, new_password) -> dict | None:
    """Set the new password. Returns ``None`` on success, else an error body:
    ``{"detail": INVALID_LINK}`` or ``{"new_password": [...]}``."""
    user = user_for(uid, token)
    if user is None:
        return {"detail": INVALID_LINK}
    new_password = new_password or ""
    if not new_password:
        return {"new_password": ["Enter a new password."]}
    try:
        validate_password(new_password, user=user)  # same rules as change-password
    except DjangoValidationError as exc:
        return {"new_password": list(exc.messages)}
    user.set_password(new_password)
    user.save(update_fields=["password"])
    logger.info("password reset completed for user %s in %s", user.pk, current_org())
    return None
