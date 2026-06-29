"""Microsoft Entra (Azure AD) **Sign-in** via OpenID Connect — per tenant.

This is the SSO login flow, distinct from the mailbox XOAUTH2 in
``apps.itsm_email.services.oauth`` (which grants IMAP/SMTP). Here Microsoft only
proves *who* the person is; once identity is verified we mint our own ordinary
ITSM JWT (identical to the password login), so the rest of the app is unchanged.

Per-tenant, exactly like the mailbox config: each org registers its OWN app in
Entra and stores the Client ID / Directory (tenant) ID / Client secret on
``TenantSSOConfig`` (secret Fernet-encrypted). The flow runs under the org path
(``/t/<org>/…``) so ``PathTenantMiddleware`` has already selected the schema.

Token trust model — we use the **authorization-code flow with a confidential
client**: the ``id_token`` is fetched by THIS server directly from Microsoft's
token endpoint over TLS, authenticated with the client secret. It never passes
through the browser, so (per OIDC §3.1.3.7 / Microsoft + Google guidance) we can
read its claims without re-verifying the JWT signature. We still strictly check
``aud`` (our client id), ``tid`` (the configured directory — pins single-tenant),
``iss``, ``exp`` and the ``nonce`` we issued. Uses stdlib ``urllib`` — no SDK.
"""

from __future__ import annotations

import base64
import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import connection
from django.utils import timezone

from .models import SsoLoginTicket, TenantSSOConfig

logger = logging.getLogger("itsm")

# Browser-bound CSRF cookie for the OIDC flow (set at start, checked at callback).
STATE_COOKIE = "sso_flow"

MS_AUTHORIZE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
MS_TOKEN = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MS_SCOPE = "openid profile email"

# Tenant placeholders that mean "multi-tenant" — we can't pin `tid` to these.
_MULTITENANT = {"common", "organizations", "consumers"}

_STATE_SALT = "itsm.sso.oauth.state"
_STATE_MAX_AGE = 600  # 10 min to complete the redirect round-trip
_HANDOFF_SALT = "itsm.sso.handoff"
_HANDOFF_MAX_AGE = 120  # the SPA must redeem the one-time code within 2 min
_CLOCK_SKEW = 120  # seconds of tolerance on token expiry


class SsoError(Exception):
    """User-safe SSO failure; the message is shown on the login page."""


# ── config ──────────────────────────────────────────────────────────────────

def get_microsoft_config() -> TenantSSOConfig:
    """The active org's SSO config, or raise if Microsoft sign-in isn't usable."""
    config = TenantSSOConfig.current()
    if config is None or not config.microsoft_enabled:
        raise SsoError("Microsoft sign-in is not enabled for this organisation.")
    return config


def _tenant_segment(config: TenantSSOConfig) -> str:
    return (config.microsoft_tenant_id or "").strip() or "organizations"


def _public_base() -> str:
    return (getattr(settings, "PUBLIC_BASE_URL", "")
            or getattr(settings, "FRONTEND_BASE_URL", "")
            or "http://localhost:3000").rstrip("/")


def redirect_uri() -> str:
    """The org-specific callback the tenant must register in its Entra app.

    Derived from the active schema so it matches whether built during ``start``
    (UI) or ``callback`` (provider redirect) — both run under ``/t/<org>/…``."""
    org = connection.schema_name
    return f"{_public_base()}/api/v1/t/{org}/itsm/auth/sso/microsoft/callback/"


def login_page_url(status: str, *, code: str | None = None, detail: str | None = None) -> str:
    """Where the callback bounces the browser back to (the org login page)."""
    org = connection.schema_name
    url = f"{_public_base()}/t/{org}/login?sso={status}"
    if code:
        url += f"&code={urllib.parse.quote(code)}"
    if detail:
        url += f"&detail={urllib.parse.quote(detail[:200])}"
    return url


# ── state / nonce (CSRF + replay) ───────────────────────────────────────────

def make_state(nonce: str) -> str:
    return signing.dumps({"org": connection.schema_name, "nonce": nonce}, salt=_STATE_SALT)


def parse_state(state: str) -> tuple[str, str]:
    data = signing.loads(state, salt=_STATE_SALT, max_age=_STATE_MAX_AGE)
    return data.get("org", ""), data.get("nonce", "")


# ── authorize + token exchange ──────────────────────────────────────────────

def authorize_url(config: TenantSSOConfig) -> tuple[str, str]:
    """Return (authorize_url, nonce). The nonce is echoed in the id_token AND set
    as a browser cookie at start, so the callback can prove the response belongs
    to the browser that began the flow (login-CSRF protection)."""
    nonce = secrets.token_urlsafe(24)
    params = {
        "client_id": config.microsoft_client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri(),
        "response_mode": "query",
        "scope": MS_SCOPE,
        "state": make_state(nonce),
        "nonce": nonce,
        "prompt": "select_account",
    }
    url = MS_AUTHORIZE.format(tenant=_tenant_segment(config)) + "?" + urllib.parse.urlencode(params)
    return url, nonce


def _post_token(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 - fixed provider URL
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # pragma: no cover - network
        detail = exc.read().decode("utf-8", "replace")[:300]
        logger.warning("SSO token endpoint %s: %s", exc.code, detail)
        raise SsoError("Microsoft rejected the sign-in. Please try again.") from exc
    except Exception as exc:  # noqa: BLE001  # pragma: no cover - network
        logger.warning("SSO token endpoint error: %s", exc)
        raise SsoError("Could not reach Microsoft to complete sign-in.") from exc


def exchange_code(config: TenantSSOConfig, code: str) -> dict:
    payload = _post_token(MS_TOKEN.format(tenant=_tenant_segment(config)), {
        "client_id": config.microsoft_client_id,
        # Reading the EncryptedField attribute returns the decrypted secret.
        "client_secret": config.microsoft_client_secret_enc,
        "code": code,
        "redirect_uri": redirect_uri(),
        "grant_type": "authorization_code",
        "scope": MS_SCOPE,
    })
    if not payload.get("id_token"):
        raise SsoError("Microsoft did not return an identity token.")
    return payload


# ── id_token decode + claim validation ──────────────────────────────────────

def _b64url_decode(segment: str) -> bytes:
    pad = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + pad)


def decode_id_token(id_token: str) -> dict:
    try:
        payload_seg = id_token.split(".")[1]
        return json.loads(_b64url_decode(payload_seg).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise SsoError("Could not read the Microsoft identity token.") from exc


def validate_claims(claims: dict, config: TenantSSOConfig, expected_nonce: str) -> None:
    """Strict claim checks — see the module docstring's trust model."""
    if claims.get("aud") != config.microsoft_client_id:
        raise SsoError("The Microsoft token was issued for a different application.")

    if expected_nonce and claims.get("nonce") != expected_nonce:
        raise SsoError("The Microsoft sign-in failed a security check (nonce mismatch).")

    exp = claims.get("exp")
    try:
        if exp is None or time.time() > float(exp) + _CLOCK_SKEW:
            raise SsoError("The Microsoft sign-in token has expired — please try again.")
    except (TypeError, ValueError) as exc:
        raise SsoError("The Microsoft token is malformed (exp).") from exc

    iss = claims.get("iss") or ""
    if not iss.startswith("https://login.microsoftonline.com/") and \
       not iss.startswith("https://sts.windows.net/"):
        raise SsoError("The Microsoft token has an unexpected issuer.")

    # Directory pin: only accounts from the configured single-tenant directory may
    # sign in — this is what makes auto-provisioning safe. Fail CLOSED if the
    # directory isn't a single-tenant id (defence in depth; the config serializer
    # already rejects multi-tenant values, this guards any legacy/bypassed row).
    configured = (config.microsoft_tenant_id or "").strip().lower()
    if not configured or configured in _MULTITENANT:
        raise SsoError(
            "Microsoft sign-in requires a single-tenant Directory (tenant) ID. "
            "Ask your administrator to set it in Authentication settings."
        )
    if (claims.get("tid") or "").strip().lower() != configured:
        raise SsoError("This Microsoft account belongs to a different directory.")


# ── identity → local user ───────────────────────────────────────────────────

def _claim_email(claims: dict) -> str:
    return (claims.get("email") or claims.get("preferred_username") or "").strip().lower()


def _unique_username(email: str) -> str:
    from apps.accounts.models import User

    base = (email or "").lower() or f"sso-user-{uuid.uuid4().hex[:8]}"
    candidate, i = base, 2
    while User.objects.filter(username__iexact=candidate).exists():
        candidate, i = f"{base}-{i}", i + 1
    return candidate


def _provision_requestor(email: str, name: str, oid: str):
    from apps.accounts.models import AuthMethod, User
    from .models import RoleAssignment, SystemRole

    user = User(
        username=_unique_username(email),
        email=email,
        full_name=name or "",
        auth_method=AuthMethod.MICROSOFT,
        ms_object_id=oid or "",
        is_active=True,
    )
    user.set_unusable_password()
    user.save()

    role = SystemRole.objects.filter(code="requestor", is_active=True, is_deleted=False).first()
    if role is not None:
        # all_objects so a previously soft-deleted assignment is revived, not duplicated.
        RoleAssignment.all_objects.update_or_create(
            user=user, defaults={"role": role, "is_deleted": False}
        )
    return user


def resolve_or_create_user(claims: dict, config: TenantSSOConfig):
    """Map verified Microsoft claims to a local user. Raises SsoError on refusal.

    Matching: stable ``oid`` → email → username. A matched account must be a
    Microsoft-method user (fixed per-user method). Unknown users auto-provision a
    portal Requestor when enabled and the email domain is allowed.
    """
    from apps.accounts.models import AuthMethod, User

    oid = (claims.get("oid") or "").strip()
    email = _claim_email(claims)
    name = (claims.get("name") or "").strip()
    if not oid and not email:
        raise SsoError("Microsoft did not return an email address or account id.")

    user = None
    if oid:
        user = User.objects.filter(ms_object_id=oid).order_by("pk").first()
    if user is None and email:
        user = User.objects.filter(email__iexact=email).order_by("pk").first()
    if user is None and email:
        user = User.objects.filter(username__iexact=email).order_by("pk").first()

    if user is not None:
        if user.auth_method != AuthMethod.MICROSOFT:
            raise SsoError("This account signs in with a password, not Microsoft.")
        if not user.is_active:
            raise SsoError("This account is disabled. Contact your administrator.")
        if oid and user.ms_object_id != oid:
            user.ms_object_id = oid
            user.save(update_fields=["ms_object_id"])
        return user

    # No match → auto-provision (or refuse).
    if not config.auto_provision:
        raise SsoError(
            "No account exists for this Microsoft user. Ask your administrator to add you."
        )
    if not email:
        raise SsoError("Microsoft did not return an email address, so no account can be created.")
    if not config.domain_allowed(email):
        raise SsoError("Your email domain is not permitted to sign in to this organisation.")
    return _provision_requestor(email, name, oid)


# ── handoff to the SPA + token mint ─────────────────────────────────────────

def make_handoff_code(user) -> str:
    """A short-lived, single-use code the SPA exchanges for real JWTs (keeps the
    tokens out of the redirect URL / browser history). Backed by a DB ticket so
    single-use holds across gunicorn workers."""
    # Opportunistic prune of stale tickets (best-effort housekeeping).
    cutoff = timezone.now() - timedelta(seconds=_HANDOFF_MAX_AGE)
    SsoLoginTicket.objects.filter(created_at__lt=cutoff).delete()

    jti = uuid.uuid4().hex
    SsoLoginTicket.objects.create(jti=jti, user=user)
    return signing.dumps({"org": connection.schema_name, "jti": jti}, salt=_HANDOFF_SALT)


def redeem_handoff_code(code: str):
    """Validate a handoff code, atomically consume its ticket, return the user."""
    try:
        data = signing.loads(code, salt=_HANDOFF_SALT, max_age=_HANDOFF_MAX_AGE)
    except signing.SignatureExpired as exc:
        raise SsoError("This sign-in link has expired. Please sign in again.") from exc
    except signing.BadSignature as exc:
        raise SsoError("This sign-in link is invalid.") from exc

    if data.get("org") != connection.schema_name:
        raise SsoError("This sign-in link was issued for a different organisation.")

    ticket = SsoLoginTicket.objects.filter(jti=data.get("jti")).select_related("user").first()
    if ticket is None:
        raise SsoError("This sign-in link has expired or already been used.")
    user = ticket.user
    # Atomic single-use: the DELETE removes the row exactly once across all workers;
    # a racing redemption sees 0 deleted and is rejected.
    deleted, _ = SsoLoginTicket.objects.filter(jti=ticket.jti).delete()
    if not deleted:
        raise SsoError("This sign-in link has already been used.")
    if not user.is_active:
        raise SsoError("Your account could not be found or is disabled.")
    return user


def issue_tokens(user) -> dict:
    """Mint the standard ITSM JWT pair (same shape/claims as the password login)."""
    from .serializers import ItsmTokenObtainPairSerializer, ItsmUserSerializer

    refresh = ItsmTokenObtainPairSerializer.get_token(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": ItsmUserSerializer(user).data,
    }
