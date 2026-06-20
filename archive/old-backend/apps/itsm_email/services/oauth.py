"""OAuth2 (XOAUTH2 over IMAP) for Gmail and Microsoft 365.

One provider app per provider (client id/secret in settings); per‑channel we
store only the granted access/refresh tokens (encrypted). Token exchange and
refresh use stdlib ``urllib`` — no provider SDK. The CSRF ``state`` is a signed
channel id (Django signing) with a 1‑hour TTL.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.utils import timezone

logger = logging.getLogger("itsm")

_STATE_SALT = "itsm.email.oauth"
_STATE_MAX_AGE = 3600  # 1 hour

PROVIDERS = {
    "oauth_google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "scope": "https://mail.google.com/",
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
        "client_id_setting": "GOOGLE_OAUTH_CLIENT_ID",
        "client_secret_setting": "GOOGLE_OAUTH_CLIENT_SECRET",
        "extra_authorize": {"access_type": "offline", "prompt": "consent"},
    },
    "oauth_microsoft": {
        "authorize": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
        "token": "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        "scope": "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access",
        "imap_host": "outlook.office365.com",
        "imap_port": 993,
        "client_id_setting": "MICROSOFT_OAUTH_CLIENT_ID",
        "client_secret_setting": "MICROSOFT_OAUTH_CLIENT_SECRET",
        "extra_authorize": {},
    },
}


class OAuthError(Exception):
    pass


def _provider(channel) -> dict:
    cfg = PROVIDERS.get(channel.auth_method)
    if not cfg:
        raise OAuthError(f"{channel.auth_method} is not an OAuth method.")
    return cfg


def _tenant() -> str:
    return getattr(settings, "MICROSOFT_OAUTH_TENANT", "common") or "common"


def _client(cfg) -> tuple[str, str]:
    cid = getattr(settings, cfg["client_id_setting"], "")
    secret = getattr(settings, cfg["client_secret_setting"], "")
    if not cid or not secret:
        raise OAuthError("OAuth provider is not configured (missing client id/secret).")
    return cid, secret


def _fmt(url: str) -> str:
    return url.format(tenant=_tenant())


def make_state(channel_id) -> str:
    return signing.dumps({"cid": str(channel_id)}, salt=_STATE_SALT)


def parse_state(state: str):
    data = signing.loads(state, salt=_STATE_SALT, max_age=_STATE_MAX_AGE)
    return data["cid"]


def authorize_url(channel) -> str:
    cfg = _provider(channel)
    cid, _ = _client(cfg)
    params = {
        "client_id": cid,
        "redirect_uri": settings.EMAIL_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": cfg["scope"],
        "state": make_state(channel.id),
        "login_hint": channel.username or channel.address,
        **cfg.get("extra_authorize", {}),
    }
    return _fmt(cfg["authorize"]) + "?" + urllib.parse.urlencode(params)


def _post_token(cfg, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(_fmt(cfg["token"]), data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 - fixed provider URLs
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # pragma: no cover - network
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise OAuthError(f"Token endpoint {exc.code}: {detail}") from exc
    except Exception as exc:  # noqa: BLE001  # pragma: no cover - network
        raise OAuthError(str(exc)) from exc


def _store_tokens(channel, payload: dict):
    access = payload.get("access_token", "")
    refresh = payload.get("refresh_token", "")
    expires_in = int(payload.get("expires_in", 3600))
    channel.oauth_access_token_enc = access
    if refresh:  # refresh token is only returned on first consent
        channel.oauth_refresh_token_enc = refresh
    channel.oauth_token_expiry = timezone.now() + timedelta(seconds=max(60, expires_in - 60))
    channel.oauth_authorized = bool(access)
    channel.save(update_fields=[
        "oauth_access_token_enc", "oauth_refresh_token_enc",
        "oauth_token_expiry", "oauth_authorized", "updated_at",
    ])


def exchange_code(channel, code: str):
    cfg = _provider(channel)
    cid, secret = _client(cfg)
    payload = _post_token(cfg, {
        "client_id": cid, "client_secret": secret, "code": code,
        "redirect_uri": settings.EMAIL_OAUTH_REDIRECT_URI, "grant_type": "authorization_code",
    })
    _store_tokens(channel, payload)


def refresh(channel):
    cfg = _provider(channel)
    cid, secret = _client(cfg)
    if not channel.oauth_refresh_token_enc:
        raise OAuthError("No refresh token stored; re‑authorize the channel.")
    payload = _post_token(cfg, {
        "client_id": cid, "client_secret": secret,
        "refresh_token": channel.oauth_refresh_token_enc, "grant_type": "refresh_token",
    })
    _store_tokens(channel, payload)


def ensure_fresh(channel) -> str:
    """Return a valid access token, refreshing if expired. Raises OAuthError."""
    if not channel.oauth_authorized:
        raise OAuthError("Channel is not authorized.")
    expiry = channel.oauth_token_expiry
    if not channel.oauth_access_token_enc or (expiry and expiry <= timezone.now()):
        refresh(channel)
    return channel.oauth_access_token_enc


def imap_endpoint(channel) -> tuple[str, int]:
    cfg = _provider(channel)
    host = channel.host or cfg["imap_host"]
    port = channel.port or cfg["imap_port"]
    return host, port
