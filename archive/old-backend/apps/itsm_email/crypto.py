"""Credential encryption for mailbox secrets (IMAP/POP passwords, OAuth tokens).

Secrets are encrypted at rest with Fernet (AES‑128‑CBC + HMAC). The key comes
from ``settings.ITSM_CREDENTIAL_KEY`` when set; otherwise it is derived
deterministically from ``SECRET_KEY`` so dev/CI works with zero extra setup.

``EncryptedField`` stores ciphertext in a normal TEXT column and transparently
decrypts to plaintext in Python. A DB dump therefore never leaks usable
credentials. Empty/blank values are passed through unencrypted (stored as "")
so the column degrades gracefully and ``has_*`` checks stay simple.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

logger = logging.getLogger("itsm")

_PREFIX = "enc::"  # marks a value we encrypted, so we never double‑encrypt / mis‑read


def _fernet() -> Fernet:
    key = getattr(settings, "ITSM_CREDENTIAL_KEY", "") or ""
    if not key:
        # Derive a stable 32‑byte urlsafe key from SECRET_KEY (dev/CI fallback).
        digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest).decode("ascii")
    elif isinstance(key, str) and len(key) != 44:
        # Treat an arbitrary string as a passphrase → derive a valid Fernet key.
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest).decode("ascii")
    return Fernet(key if isinstance(key, bytes) else key.encode("ascii"))


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    token = _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt(stored: str) -> str:
    if not stored:
        return ""
    if not stored.startswith(_PREFIX):
        # Legacy/plaintext value (e.g. a fixture) — return as‑is.
        return stored
    try:
        return _fernet().decrypt(stored[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        logger.warning("Failed to decrypt a stored credential (key rotated?).")
        return ""


class EncryptedField(models.TextField):
    """A TextField whose value is encrypted on the way to the DB and decrypted
    on the way out. Use for secrets only; not indexable/searchable by value."""

    description = "Fernet‑encrypted text"

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None:
            return value
        return encrypt(value)

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decrypt(value)

    def to_python(self, value):
        # Values already in Python are plaintext; only DB reads are ciphertext.
        return value
