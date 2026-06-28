"""Mailbox transport — fetch raw messages over IMAP/POP3 (stdlib).

``fetch_new(channel)`` yields ``(uid, raw_bytes)`` for messages not yet seen.
IMAP uses a UID high‑water mark (``channel.last_seen_uid``) and only marks a
message ``\\Seen`` after the caller confirms it was durably stored — so a crash
re‑fetches and the inbound idempotency key dedupes. OAuth channels authenticate
with XOAUTH2; basic channels use LOGIN.

``test_connection(channel)`` opens a connection and returns a short status
string (used by the admin "Test connection" action).
"""

from __future__ import annotations

import imaplib
import logging
import poplib
from contextlib import contextmanager

from . import oauth

logger = logging.getLogger("itsm")

_FETCH_CAP = 50  # messages per poll, per channel


def _xoauth2_string(user: str, token: str) -> bytes:
    return f"user={user}\x01auth=Bearer {token}\x01\x01".encode("utf-8")


@contextmanager
def _imap(channel):
    host, port = (channel.host, channel.port)
    if channel.is_oauth:
        host, port = oauth.imap_endpoint(channel)
    conn = imaplib.IMAP4_SSL(host, port) if channel.use_ssl else imaplib.IMAP4(host, port)
    try:
        if channel.is_oauth:
            token = oauth.ensure_fresh(channel)
            conn.authenticate("XOAUTH2", lambda _x: _xoauth2_string(channel.username or channel.address, token))
        else:
            conn.login(channel.username, channel.password_enc)
        yield conn
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


def fetch_new(channel):
    """Yield (uid:int|None, raw:bytes) for new messages. IMAP advances the UID
    cursor as it goes (the caller persists ``channel.last_seen_uid``)."""
    if channel.protocol == "pop3":
        yield from _fetch_pop(channel)
        return
    yield from _fetch_imap(channel)


def _fetch_imap(channel):
    with _imap(channel) as conn:
        conn.select(channel.folder or "INBOX")
        low = (channel.last_seen_uid or 0) + 1
        typ, data = conn.uid("SEARCH", None, f"UID {low}:*")
        if typ != "OK" or not data or not data[0]:
            return
        uids = [int(x) for x in data[0].split() if int(x) >= low]
        for uid in uids[:_FETCH_CAP]:
            typ, msg_data = conn.uid("FETCH", str(uid), "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            if not isinstance(raw, (bytes, bytearray)):
                continue
            yield uid, bytes(raw)


def _fetch_pop(channel):
    host, port = channel.host, channel.port
    box = poplib.POP3_SSL(host, port) if channel.use_ssl else poplib.POP3(host, port)
    try:
        box.user(channel.username)
        box.pass_(channel.password_enc)
        count = len(box.list()[1])
        # POP3 has no stable UID; rely on the inbound idempotency key (Message‑ID).
        for i in range(max(1, count - _FETCH_CAP + 1), count + 1):
            raw = b"\r\n".join(box.retr(i)[1])
            yield None, raw
    finally:
        try:
            box.quit()
        except Exception:  # noqa: BLE001
            pass


def current_max_uid(channel):
    """Highest UID currently in the folder, ``0`` if empty, ``None`` on error.

    Used to set a 'start from now' baseline on first connect so a busy mailbox
    doesn't back-fill its entire history as tickets — only mail that arrives
    after connection is ingested. IMAP only (POP3 already fetches just the
    most-recent messages)."""
    if channel.protocol != "imap":
        return None
    try:
        with _imap(channel) as conn:
            conn.select(channel.folder or "INBOX")
            typ, data = conn.uid("SEARCH", None, "ALL")
            if typ != "OK" or not data or not data[0]:
                return 0
            return max(int(x) for x in data[0].split())
    except Exception:  # noqa: BLE001 — unreachable mailbox: caller falls back
        logger.warning("could not read max uid for channel %s", channel.id)
        return None


def mark_seen(channel, uid):
    """Mark a single IMAP message \\Seen (called after durable storage)."""
    if channel.protocol != "imap" or uid is None:
        return
    try:
        with _imap(channel) as conn:
            conn.select(channel.folder or "INBOX")
            conn.uid("STORE", str(uid), "+FLAGS", "(\\Seen)")
    except Exception:  # noqa: BLE001
        logger.warning("Could not mark uid %s seen on channel %s", uid, channel.id)


def test_connection(channel) -> dict:
    """Open a connection and report status without fetching mail."""
    try:
        if channel.protocol == "pop3":
            box = poplib.POP3_SSL(channel.host, channel.port) if channel.use_ssl \
                else poplib.POP3(channel.host, channel.port)
            box.user(channel.username)
            box.pass_(channel.password_enc)
            n = len(box.list()[1])
            box.quit()
            return {"ok": True, "detail": f"POP3 OK — {n} message(s) in mailbox."}
        with _imap(channel) as conn:
            conn.select(channel.folder or "INBOX")
            typ, data = conn.uid("SEARCH", None, "ALL")
            n = len(data[0].split()) if (typ == "OK" and data and data[0]) else 0
            return {"ok": True, "detail": f"IMAP OK — {n} message(s) in {channel.folder}."}
    except oauth.OAuthError as exc:
        return {"ok": False, "detail": f"OAuth error: {exc}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)[:300]}


def test_smtp(channel) -> dict:
    """Open the outbound SMTP connection and authenticate, without sending mail."""
    from .transport import _connection_for

    if not channel.outbound_enabled:
        return {"ok": False, "detail": "Outbound is disabled for this mailbox."}
    if not channel.is_oauth and not channel.smtp_host:
        return {"ok": False, "detail": "No SMTP host configured."}
    conn = None
    try:
        conn = _connection_for(channel)
        if conn is None:
            return {"ok": False, "detail": "No SMTP transport could be built."}
        conn.open()  # raises on auth/connect failure (fail_silently=False)
        host = conn.host
        return {"ok": True, "detail": f"SMTP OK — authenticated to {host}."}
    except oauth.OAuthError as exc:
        return {"ok": False, "detail": f"OAuth error: {exc}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)[:300]}
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:  # noqa: BLE001
            pass
