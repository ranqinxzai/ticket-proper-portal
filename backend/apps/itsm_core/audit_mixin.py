"""Request-level hooks that feed the admin & security audit log.

One central mechanism instead of per-view calls (many config ViewSets override
``perform_create``/``perform_update`` without ``super()``, so a hook there would miss
them). Hooks sit on the DRF request lifecycle instead:

* ``AdminAuditMixin`` — mixed into ``ItsmModelViewSet`` (and ``MemberViewSet``).
  For an unsafe request whose module code is in ``AUDITED_AREAS`` it snapshots the
  target before the handler (``initial``), re-reads it after a 2xx/3xx response
  (``finalize_response``) and records the field diff. Covers standard CRUD AND custom
  ``@action``s (add_member, set_role, permissions, reorder, …). Ticket traffic is
  never in ``AUDITED_AREAS``, so it isn't duplicated here.
* ``AuthAuditMixin`` — declarative, for APIViews: sign-in / failed sign-in, password
  change, SSO callback errors. Written immediately (a failed login has no commit).
* ``ConsoleUserAuditMixin`` — the platform console's org-user actions, written into
  THAT org's schema only (actor = none, label "Platform admin: <name>").

Every hook swallows its own errors: auditing must never break a request.
This module must not import ``apps.itsm_rbac`` at import time (it is imported by
``itsm_rbac.permissions``).
"""

from __future__ import annotations

import logging
import re
import urllib.parse

from django.db import models

from .services import audit

logger = logging.getLogger("itsm")

_SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
# Unsafe actions that only probe/validate — not configuration changes.
_PROBE_ACTIONS = {"validate", "test_connection", "test_smtp", "poll_now"}
_STANDARD_ACTIONS = {"create", "update", "partial_update", "destroy"}
_ACTION_MAP = {
    "create": "create",
    "update": "update",
    "partial_update": "update",
    "destroy": "delete",
    "create_user": "create",
    "import_standard": "create",
    "create_starter": "create",
    "set_role": "role_changed",
    "reset_password": "password_reset",
    "set_attributes": "update",
    "update_profile": "update",
    "permissions": "permissions_changed",
    "add_member": "member_added",
    "remove_member": "member_removed",
    "reorder": "reordered",
    "oauth_start": "oauth_started",
}
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _snap_value(snap, key):
    entry = (snap or {}).get(key)
    return entry[0] if entry else None


def _semantic_action(drf_action: str, before, after) -> str:
    if drf_action == "set_active":
        return "user_activated" if _snap_value(after, "is_active") else "user_deactivated"
    return _ACTION_MAP.get(drf_action, drf_action or "update")


class AdminAuditMixin:
    """Records configuration changes for ``AUDITED_AREAS`` (see module docstring)."""

    #: Force an area for a view without a usable ``module_code``.
    audit_area: str | None = None

    def _audit_resolve_area(self):
        if self.audit_area:
            return self.audit_area if audit.is_audited_area(self.audit_area) else None
        code = None
        action = getattr(self, "action", None)
        if action:
            code = getattr(getattr(self, action, None), "module_code", None)
        code = code or getattr(self, "module_code", None)
        return code if audit.is_audited_area(code) else None

    def _audit_model(self):
        qs = getattr(self, "queryset", None)
        if qs is not None:
            return qs.model
        return self.get_queryset().model

    @staticmethod
    def _audit_fetch(model, value, field="pk"):
        try:
            return model._base_manager.filter(**{field: value}).first()
        except Exception:  # noqa: BLE001 — bad pk etc.: the view itself answers 404/400
            return None

    def initial(self, request, *args, **kwargs):
        self._admin_audit = None
        super().initial(request, *args, **kwargs)
        try:
            if request.method in _SAFE_METHODS:
                return
            drf_action = getattr(self, "action", None) or ""
            if drf_action in _PROBE_ACTIONS:
                return
            area = self._audit_resolve_area()
            if not area:
                return
            model = self._audit_model()
            lookup_field = getattr(self, "lookup_field", "pk") or "pk"
            lookup_kwarg = getattr(self, "lookup_url_kwarg", None) or lookup_field
            lookup = self.kwargs.get(lookup_kwarg) if getattr(self, "kwargs", None) else None
            obj = before = None
            if lookup is not None:
                # Unscoped read for the snapshot only — never returned to the client.
                obj = self._audit_fetch(model, lookup, lookup_field)
                before = audit.snapshot(obj)
            self._admin_audit = {
                "area": area, "action": drf_action, "model": model, "lookup": lookup,
                "lookup_field": lookup_field, "obj": obj, "before": before, "serializers": [],
            }
        except Exception:  # noqa: BLE001
            logger.exception("admin audit: initial hook failed")
            self._admin_audit = None

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        state = getattr(self, "_admin_audit", None)
        if state is not None:
            state["serializers"].append(serializer)
        return serializer

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        state = getattr(self, "_admin_audit", None)
        self._admin_audit = None
        if state is not None and 200 <= getattr(response, "status_code", 500) < 400:
            try:
                self._audit_record(request, response, state)
            except Exception:  # noqa: BLE001
                logger.exception("admin audit: record failed")
        return response

    def _audit_record(self, request, response, state):
        model = state["model"]
        drf_action = state["action"]
        before = state["before"]
        obj = state["obj"]
        after = None
        if state["lookup"] is not None:
            fresh = self._audit_fetch(model, state["lookup"], state["lookup_field"])
            if drf_action != "destroy" and fresh is not None:
                after = audit.snapshot(fresh)
                obj = fresh
        else:
            created = next(
                (s.instance for s in state["serializers"]
                 if isinstance(getattr(s, "instance", None), models.Model)),
                None,
            )
            if created is None:
                data = getattr(response, "data", None)
                if isinstance(data, dict) and data.get("id"):
                    created = self._audit_fetch(model, data["id"])
            if created is not None:
                obj = self._audit_fetch(type(created), created.pk) or created
                after = audit.snapshot(obj)
        changes = audit.diff(before, after)
        if drf_action in ("update", "partial_update") and not changes:
            return  # a no-op save
        extra = {}
        if drf_action not in _STANDARD_ACTIONS:
            extra["operation"] = drf_action
            if not changes:
                req = audit.capped_request(getattr(request, "data", None))
                if req:
                    extra["request"] = req
        audit.record_event(
            request, area=state["area"], action=_semantic_action(drf_action, before, after),
            obj=obj, changes=changes, extra=extra,
        )


# ── auth events ──────────────────────────────────────────────────────────────

def _attempted_username(request) -> str:
    data = getattr(request, "data", None)
    value = ""
    if hasattr(data, "get"):
        value = data.get("username") or data.get("email") or ""
    return _CTRL_RE.sub("", str(value)).strip()[:150]


def _reason(data) -> tuple[str, str]:
    """(message, code) from an error response body. Bodies hold messages only."""
    if not isinstance(data, dict):
        return "", ""
    detail = data.get("detail")
    if detail is not None:
        return str(detail)[:300], str(getattr(detail, "code", "") or data.get("code") or "")[:60]
    parts = []
    for key, val in list(data.items())[:5]:
        msg = val[0] if isinstance(val, (list, tuple)) and val else val
        parts.append(f"{key}: {msg}")
    return "; ".join(parts)[:300], "invalid"


def _user_from_response(data):
    from django.contrib.auth import get_user_model

    if not isinstance(data, dict):
        return None
    uid = (data.get("user") or {}).get("id") if isinstance(data.get("user"), dict) else data.get("id")
    if not uid:
        return None
    try:
        return get_user_model()._base_manager.filter(pk=uid).first()
    except Exception:  # noqa: BLE001
        return None


def _match_user(login: str):
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    if not login:
        return None
    try:
        return (
            get_user_model()._base_manager
            .filter(Q(username__iexact=login) | Q(email__iexact=login)).order_by("pk").first()
        )
    except Exception:  # noqa: BLE001
        return None


class AuthAuditMixin:
    """Declarative auth auditing for APIViews.

    ``audit_auth_event``: ``"login"`` (2xx → login, 4xx → login_failed),
    ``"password_change"`` (2xx → password_changed, 4xx → password_change_failed) or
    ``"sso_callback"`` (a redirect carrying ``sso=error`` → login_failed).
    Passwords and tokens are never read: only the username field and the response's
    error message / user id.
    """

    audit_auth_event: str | None = None
    audit_auth_method: str = "password"

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        try:
            self._audit_auth(request, response)
        except Exception:  # noqa: BLE001
            logger.exception("admin audit: auth hook failed")
        return response

    def _audit_auth(self, request, response):
        event = self.audit_auth_event
        status = getattr(response, "status_code", 500)
        method = self.audit_auth_method
        if event == "login":
            if 200 <= status < 300:
                user = _user_from_response(getattr(response, "data", None))
                if user is not None:
                    audit.record_event(
                        request, area=audit.AUTH_AREA, action="login", obj=user, actor=user,
                        extra={"method": method}, defer=False,
                    )
            elif 400 <= status < 500:
                attempted = _attempted_username(request)
                message, code = _reason(getattr(response, "data", None))
                audit.record_event(
                    request, area=audit.AUTH_AREA, action="login_failed",
                    obj=_match_user(attempted), actor=False, actor_label=attempted,
                    extra={"method": method, "reason": message, "code": code,
                           "forwarded_for": (request.META.get("HTTP_X_FORWARDED_FOR") or "")[:200]},
                    defer=False,
                )
        elif event == "password_change":
            user = audit._request_user(request)
            if user is None:
                return
            if 200 <= status < 300:
                audit.record_event(
                    request, area=audit.AUTH_AREA, action="password_changed", obj=user, defer=False,
                )
            elif 400 <= status < 500:
                message, code = _reason(getattr(response, "data", None))
                audit.record_event(
                    request, area=audit.AUTH_AREA, action="password_change_failed", obj=user,
                    extra={"reason": message, "code": code}, defer=False,
                )
        elif event == "sso_callback":
            location = response.get("Location", "") if hasattr(response, "get") else ""
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)
            if (query.get("sso") or [""])[0] == "error":
                audit.record_event(
                    request, area=audit.AUTH_AREA, action="login_failed", actor=False,
                    actor_label="",
                    extra={"method": method, "reason": (query.get("detail") or [""])[0][:300],
                           "code": "sso_error"},
                    defer=False,
                )


# ── platform console (public schema → the affected org's schema) ─────────────

class ConsoleUserAuditMixin:
    """For ``tenants.OrgViewSet``: audit the console's org-user actions in the org's
    OWN schema. Org create/rename/delete and console sign-ins are never logged (they
    live in ``public``, which has no audit table) — so nothing crosses orgs."""

    _console_actions = {"users", "user_detail", "reset_admin_password"}

    @staticmethod
    def _console_user(schema, username):
        from django.contrib.auth import get_user_model
        from django_tenants.utils import schema_context

        if not username:
            return None, None
        with schema_context(schema):
            user = get_user_model()._base_manager.filter(username=username).first()
            if user is None:
                return None, None
            return (
                {"id": str(user.pk), "repr": audit._label(user), "username": user.username},
                audit.snapshot(user),
            )

    def initial(self, request, *args, **kwargs):
        self._console_audit = None
        super().initial(request, *args, **kwargs)
        try:
            if request.method in _SAFE_METHODS or getattr(self, "action", None) not in self._console_actions:
                return
            from apps.tenants.models import Client

            org = Client.objects.filter(schema_name=self.kwargs.get("schema_name")).first()
            if org is None:
                return
            data = getattr(request, "data", None)
            username = self.kwargs.get("username") or (data.get("username") if hasattr(data, "get") else None)
            ident, before = self._console_user(org.schema_name, username)
            self._console_audit = {
                "schema": org.schema_name, "username": username, "ident": ident, "before": before,
            }
        except Exception:  # noqa: BLE001
            logger.exception("admin audit: console initial hook failed")
            self._console_audit = None

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        state = getattr(self, "_console_audit", None)
        self._console_audit = None
        if state is not None and 200 <= getattr(response, "status_code", 500) < 300:
            try:
                self._console_record(request, state)
            except Exception:  # noqa: BLE001
                logger.exception("admin audit: console record failed")
        return response

    def _console_record(self, request, state):
        from django_tenants.utils import schema_context

        ident_after, after = self._console_user(state["schema"], state["username"])
        ident = ident_after or state["ident"] or {}
        before = state["before"]
        if self.action == "reset_admin_password":
            action = "password_reset"
        elif request.method == "DELETE":
            action, after = "delete", None
        elif self.action == "users":
            action = "create"
        else:
            action = "update"
        changes = audit.diff(before, after)
        if action == "update":
            keys = {c["field"] for c in changes}
            if keys == {"is_active"}:
                action = "user_activated" if _snap_value(after, "is_active") else "user_deactivated"
        operator = getattr(getattr(request, "user", None), "username", "") or "unknown"
        with schema_context(state["schema"]):
            audit.record_event(
                request, area="itsm.admin.roles", action=action, changes=changes,
                actor=False, actor_label=f"Platform admin: {operator}",
                object_type="user", object_id=ident.get("id", ""),
                object_repr=ident.get("repr") or state["username"] or "",
                extra={"via": "platform_console"}, defer=False,
            )
