"""Authentication backend with case-insensitive login lookup.

Django's default ``ModelBackend`` matches the ``USERNAME_FIELD`` case-sensitively,
so a user whose stored login is ``shekhar@ticket.com`` cannot sign in by typing
``Shekhar@ticket.com``. Our logins are email-shaped, and email is case-insensitive
(RFC 5321), so we look the user up case-insensitively: (1) exact username (the
unique-index fast path), (2) case-insensitive username, then (3) case-insensitive
email.

Registered in ``AUTHENTICATION_BACKENDS`` ahead of the default, so it covers every
entry point that goes through ``authenticate()``: the ITSM JWT login
(``ItsmTokenObtainPairSerializer`` → simplejwt), the platform-admin JWT login, and
the legacy session ``LoginView``. Multi-tenant safe — the ORM query runs inside the
request's active schema.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class CaseInsensitiveModelBackend(ModelBackend):
    """``ModelBackend`` that resolves the login case-insensitively (username then email)."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        UserModel = get_user_model()
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD)
        if not username or not password:
            return None

        user = self._find_user(UserModel, username)
        if user is None:
            # Run the hasher once even on a miss so response time doesn't leak
            # whether the account exists (mirrors Django's ModelBackend).
            UserModel().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None

    @staticmethod
    def _find_user(UserModel, login):
        """Exact username → case-insensitive username → case-insensitive email.

        ``filter().first()`` (not ``get``) on the case-insensitive lookups so a rare
        case-only duplicate (e.g. ``Bob`` and ``bob``) resolves deterministically
        instead of raising ``MultipleObjectsReturned``.
        """
        field = UserModel.USERNAME_FIELD
        try:
            return UserModel._default_manager.get(**{field: login})
        except UserModel.DoesNotExist:
            pass
        for lookup in (f"{field}__iexact", "email__iexact"):
            match = UserModel._default_manager.filter(**{lookup: login}).order_by("pk").first()
            if match is not None:
                return match
        return None
