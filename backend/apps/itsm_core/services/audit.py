"""Audit write sites.

Two separate ledgers live here:

* ``log_event`` — the per-ticket activity feed (``AuditEvent``). Unchanged.
* The **admin & security audit log** (``AdminAuditEvent``): sign-ins, failed
  sign-ins, password events, user / role / permission / membership changes and
  configuration changes. Written by ``record_event`` (and its helpers below), which
  the request-level mixins in ``apps.itsm_core.audit_mixin`` call centrally for every
  audited ViewSet. Ticket traffic is deliberately NOT in ``AUDITED_AREAS``.

Rules for the admin log (see itsm-core skill):
* Never break the caller — every write swallows + logs its errors.
* Config changes are written ``on_commit`` (a rolled-back change is never logged);
  auth events are written immediately (a failed login has nothing to commit).
* Secrets are never stored: ``EncryptedField`` values and password/secret/token-named
  fields are compared by sha256 in memory and persisted as ``"[redacted]"``.
* Nothing is written in the ``public`` schema in prod (no tenant tables there), so
  platform-console sign-ins/org CRUD never land in any org's log.
"""

from __future__ import annotations

import datetime as _dt
import decimal
import hashlib
import ipaddress
import json
import logging
import os
import re
import uuid

from django.conf import settings
from django.db import connection, transaction

logger = logging.getLogger("itsm")


def log_event(ticket, actor, action, payload=None, field_key=""):
    """Append one row to a ticket's audit feed. The single sanctioned write site.

    The ``AuditEvent`` model lands in P1 with the Ticket model it references; this
    helper is only ever called from ticket write paths, so the lazy import is
    resolved at call time (never at P0 import time)."""
    from apps.itsm_core.models import AuditEvent

    return AuditEvent.objects.create(
        ticket=ticket,
        actor=actor if (actor and getattr(actor, "pk", None)) else None,
        action=action,
        field_key=field_key or "",
        payload=payload or {},
    )


# ══════════════════════════════════════════════════════════════════════════════
# Admin & security audit log
# ══════════════════════════════════════════════════════════════════════════════

AUTH_AREA = "auth"
AUDIT_AREA = "itsm.admin.audit"

# Exact-match allowlist: module_code → human label. A ViewSet whose (per-action)
# module code is not here is never recorded — this is what keeps ticket, comment,
# canned-note, template, queue-preference, dashboard and KB traffic out.
AUDITED_AREAS: dict[str, str] = {
    "itsm.admin.roles": "Users, roles & permissions",
    "itsm.admin.helpdesks": "Helpdesks & membership",
    "itsm.admin.sso": "Authentication & SSO",
    "itsm.admin.branding": "Branding",
    "itsm.admin.interface": "Interface (Classic / Modern)",
    "itsm.projects": "Projects & automation",
    "itsm.projects.config": "Ticket types",
    "itsm.groups": "Groups & routing",
    "itsm.workflows": "Workflows",
    "itsm.workflows.transitions": "Workflow statuses & transitions",
    "itsm.fields": "Custom fields",
    "itsm.fields.layouts": "Form layouts",
    "itsm.sla.policies": "SLA policies",
    "itsm.sla.calendars": "Business calendars",
    "itsm.notifications.schemes": "Notification rules",
    "itsm.notifications.templates": "Email templates",
    "itsm.email.channels": "Email channels",
    "itsm.surveys.config": "Surveys",
    "itsm.approvals.admin": "Approval workflows",
    "itsm.catalog.admin": "Request catalog",
    # Asset settings (categories, fields, statuses, vendors, locations, departments).
    # The asset register and imports keep their own history, so they aren't listed.
    "itsm.assets.config": "Asset configuration",
}
# Areas that appear in the log but aren't ViewSet module codes.
EXTRA_AREAS: dict[str, str] = {
    AUTH_AREA: "Sign-in & passwords",
    AUDIT_AREA: "Audit log",
}

ACTION_LABELS: dict[str, str] = {
    "create": "Created",
    "update": "Updated",
    "delete": "Deleted",
    "login": "Signed in",
    "login_failed": "Sign-in failed",
    "password_changed": "Password changed",
    "password_change_failed": "Password change failed",
    "password_reset": "Password reset",
    "password_reset_requested": "Password reset requested",
    "password_reset_failed": "Password reset failed",
    "user_activated": "User activated",
    "user_deactivated": "User deactivated",
    "role_changed": "Role changed",
    "permissions_changed": "Permissions changed",
    "member_added": "Member added",
    "member_removed": "Member removed",
    "reordered": "Reordered",
    "oauth_started": "Mailbox sign-in started",
    "exported": "Audit log exported",
}

# CSV export cap (rows, newest first). Documented in the viewer + help copy.
EXPORT_MAX_ROWS = 10_000

REDACTED = "[redacted]"
_MAX_TEXT = 500
_MAX_JSON = 2000
_MAX_LIST = 50
_MAX_CHANGES = 200
_MAX_REQUEST_BYTES = 2048

_SECRET_NAME_RE = re.compile(
    r"(password|passwd|secret|token|api_?key|private_?key|credential|_enc$)", re.I
)
# Bookkeeping columns that are never interesting in a diff.
_SKIP_FIELDS = {"id", "created_at", "updated_at", "is_deleted", "deleted_at", "deleted_by"}
# accounts.User: only these concrete fields are shown (the rest is legacy/noise).
_USER_FIELDS = {
    "username", "email", "full_name", "is_active", "is_staff", "is_superuser",
    "auth_method", "manager", "password",
}


def area_label(code: str) -> str:
    return AUDITED_AREAS.get(code) or EXTRA_AREAS.get(code) or code


def action_label(code: str) -> str:
    return ACTION_LABELS.get(code) or (code or "").replace("_", " ").capitalize()


def is_audited_area(code: str | None) -> bool:
    return bool(code) and code in AUDITED_AREAS


def is_secret_name(name: str) -> bool:
    return bool(_SECRET_NAME_RE.search(name or ""))


def _is_secret_field(field) -> bool:
    return type(field).__name__ == "EncryptedField" or is_secret_name(field.name)


# ── value formatting ─────────────────────────────────────────────────────────

def _digest(value) -> str:
    if value in (None, ""):
        return ""
    return hashlib.sha256(str(value).encode("utf-8", "replace")).hexdigest()


def _truncate(text: str, limit: int = _MAX_TEXT) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def json_safe(value, depth: int = 0):
    """A JSON-serialisable, size-capped rendering of ``value`` for display."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, (uuid.UUID, decimal.Decimal)):
        return str(value)
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if hasattr(value, "name") and hasattr(value, "storage"):  # FieldFile
        return value.name or ""
    if depth > 4:
        return _truncate(str(value), 200)
    if isinstance(value, dict):
        out = {str(k): json_safe(v, depth + 1) for k, v in list(value.items())[:_MAX_LIST]}
    elif isinstance(value, (list, tuple, set)):
        out = [json_safe(v, depth + 1) for v in list(value)[:_MAX_LIST]]
    else:
        return _truncate(str(value))
    try:
        text = json.dumps(out, default=str)
    except (TypeError, ValueError):
        return _truncate(str(value))
    return out if len(text) <= _MAX_JSON else _truncate(text, _MAX_JSON)


def _label(obj) -> str:
    if obj is None:
        return ""
    try:
        return _truncate(str(obj), 200)
    except Exception:  # noqa: BLE001
        return str(getattr(obj, "pk", ""))


def redact_payload(value, depth: int = 0):
    """Redact a request body by key name (recursively), then size-cap it."""
    if depth > 5:
        return "…"
    if isinstance(value, dict):
        return {
            str(k): (REDACTED if is_secret_name(str(k)) and v not in (None, "") else redact_payload(v, depth + 1))
            for k, v in list(value.items())[:_MAX_LIST]
        }
    if isinstance(value, (list, tuple)):
        return [redact_payload(v, depth + 1) for v in list(value)[:_MAX_LIST]]
    return json_safe(value, depth)


def capped_request(data) -> object:
    try:
        if hasattr(data, "dict") and not isinstance(data, dict):  # QueryDict
            data = data.dict()
        red = redact_payload(data)
        text = json.dumps(red, default=str)
        return red if len(text) <= _MAX_REQUEST_BYTES else _truncate(text, _MAX_REQUEST_BYTES)
    except Exception:  # noqa: BLE001
        return None


# ── snapshot + diff ──────────────────────────────────────────────────────────
# A snapshot is {key: (cmp, display, label, redacted)} — ``cmp`` is only ever held
# in memory (for secrets it's a sha256 digest), ``display`` is what gets persisted.

def _entry(cmp, display, label, redacted=False):
    return (cmp, display, label, redacted)


def snapshot(obj) -> dict | None:
    """Field-level snapshot of a model instance (+ per-model extras)."""
    if obj is None:
        return None
    snap: dict = {}
    meta = obj._meta
    is_user = meta.label_lower == (settings.AUTH_USER_MODEL or "").lower()
    for field in meta.concrete_fields:
        name = field.name
        if name in _SKIP_FIELDS or field.primary_key:
            continue
        if is_user and name not in _USER_FIELDS:
            continue
        label = str(getattr(field, "verbose_name", name) or name).capitalize()
        try:
            if _is_secret_field(field):
                raw = field.value_from_object(obj)
                snap[name] = _entry(_digest(raw), REDACTED if raw not in (None, "") else "", label, True)
            elif field.is_relation:
                raw = getattr(obj, field.attname, None)
                display = _label(getattr(obj, name, None)) if raw is not None else None
                snap[name] = _entry(str(raw) if raw is not None else None, display, label)
            else:
                raw = field.value_from_object(obj)
                cmp = json.dumps(raw, default=str, sort_keys=True) if isinstance(raw, (dict, list)) else raw
                snap[name] = _entry(cmp, json_safe(raw), label)
                if isinstance(raw, dict):
                    snap[name] = _entry(raw, json_safe(raw), label)  # dict → per-key diff
        except Exception:  # noqa: BLE001 — one odd field must not lose the event
            logger.debug("audit snapshot skipped %s.%s", meta.label, name, exc_info=True)
    for field in meta.many_to_many:
        try:
            items = list(getattr(obj, field.name).all()[: _MAX_LIST + 1])
            snap[field.name] = _entry(
                sorted(str(i.pk) for i in items),
                sorted(_label(i) for i in items),
                str(field.verbose_name).capitalize(),
            )
        except Exception:  # noqa: BLE001
            pass
    extender = _EXTENDERS.get(meta.label_lower)
    if extender is not None:
        try:
            extender(obj, snap)
        except Exception:  # noqa: BLE001
            logger.debug("audit snapshot extender failed for %s", meta.label, exc_info=True)
    return snap


def _ext_user(user, snap):
    from apps.itsm_rbac.models import RoleAssignment

    ra = (
        RoleAssignment.all_objects.filter(user=user, is_deleted=False)
        .select_related("role").first()
    )
    role = f"{ra.role.name} ({ra.role.code})" if ra and ra.role_id else ""
    snap["itsm_role"] = _entry(role, role, "ITSM role")
    try:
        from apps.itsm_helpdesks.models import HelpdeskMembership

        rows = HelpdeskMembership.objects.filter(
            user=user, is_active=True, is_deleted=False
        ).select_related("helpdesk")
        hds = sorted(
            f"{m.helpdesk.key}{' (lead)' if m.role_in_helpdesk == 'lead' else ''}" for m in rows
        )
        snap["helpdesks"] = _entry(hds, hds, "Helpdesks")
    except Exception:  # noqa: BLE001
        pass
    try:
        from apps.itsm_projects.models import ProjectMembership

        keys = sorted(
            ProjectMembership.objects.filter(user=user, is_active=True, is_deleted=False)
            .values_list("project__key", flat=True)
        )
        snap["projects"] = _entry(keys, keys, "Projects")
    except Exception:  # noqa: BLE001
        pass
    try:
        from apps.itsm_rbac import user_attr_service

        attrs = user_attr_service.get_values(user)
        if attrs:
            snap["attributes"] = _entry(attrs, json_safe(attrs), "Attributes")
    except Exception:  # noqa: BLE001
        pass


def _bits(p) -> str:
    names = [n for n, on in (("read", p.can_read), ("create", p.can_create),
                             ("update", p.can_update), ("delete", p.can_delete)) if on]
    return ", ".join(names) if names else "no access"


def _ext_role(role, snap):
    from apps.itsm_rbac.models import RoleModulePermission

    perms = {
        p.module.code: _bits(p)
        for p in RoleModulePermission.objects.filter(role=role, is_deleted=False).select_related("module")
    }
    snap["permissions"] = _entry(perms, perms, "Permissions")


def _members(qs, role_attr=None) -> list[str]:
    out = []
    for m in qs.select_related("user"):
        name = getattr(m.user, "username", "") if m.user_id else ""
        role = getattr(m, role_attr, "") if role_attr else ""
        out.append(f"{name} ({role})" if role and role != "member" else name)
    return sorted(out)


def _ext_helpdesk(hd, snap):
    rows = _members(hd.memberships.filter(is_active=True, is_deleted=False), "role_in_helpdesk")
    snap["members"] = _entry(rows, rows, "Members")


def _ext_group(group, snap):
    rows = _members(group.memberships.filter(is_active=True, is_deleted=False), "role_in_group")
    snap["members"] = _entry(rows, rows, "Members")


def _ext_project(project, snap):
    from apps.itsm_projects.models import ProjectMembership

    rows = _members(ProjectMembership.objects.filter(project=project, is_active=True, is_deleted=False))
    snap["members"] = _entry(rows, rows, "Members")


_EXTENDERS = {
    (settings.AUTH_USER_MODEL or "accounts.User").lower(): _ext_user,
    "itsm_rbac.systemrole": _ext_role,
    "itsm_helpdesks.helpdesk": _ext_helpdesk,
    "itsm_groups.group": _ext_group,
    "itsm_projects.project": _ext_project,
}


def _change(field, label, old, new, redacted=False):
    row = {"field": field, "label": label, "old": old, "new": new}
    if redacted:
        row["redacted"] = True
    return row


def diff(before: dict | None, after: dict | None) -> list[dict]:
    """Change list between two snapshots. create ⇒ non-empty new values; delete ⇒
    non-empty old values; update ⇒ changed keys (dict values expand one level)."""
    before = before or {}
    after = after or {}
    out: list[dict] = []
    for key in list(dict.fromkeys([*before.keys(), *after.keys()])):
        b = before.get(key)
        a = after.get(key)
        b_cmp, b_disp, b_label, b_red = b if b else (None, None, None, False)
        a_cmp, a_disp, a_label, a_red = a if a else (None, None, None, False)
        label = a_label or b_label or key
        redacted = bool(a_red or b_red)
        if isinstance(b_cmp, dict) or isinstance(a_cmp, dict):
            bd = b_cmp if isinstance(b_cmp, dict) else {}
            ad = a_cmp if isinstance(a_cmp, dict) else {}
            if bd == ad:
                continue
            bdisp = b_disp if isinstance(b_disp, dict) else {}
            adisp = a_disp if isinstance(a_disp, dict) else {}
            for sub in sorted(set(bd) | set(ad), key=str):
                if bd.get(sub) == ad.get(sub):
                    continue
                if key == "permissions":
                    old_v = bdisp.get(sub, "(inherited)" if before else None)
                    new_v = adisp.get(sub, "(inherited)")
                else:
                    old_v, new_v = bdisp.get(sub), adisp.get(sub)
                out.append(_change(f"{key}.{sub}", f"{label} · {sub}", json_safe(old_v), json_safe(new_v)))
            continue
        if b_cmp == a_cmp:
            continue
        if not before and a_cmp in (None, "", [], False):
            continue  # create: skip empty values
        if not after and b_cmp in (None, "", [], False):
            continue  # delete: skip empty values
        out.append(_change(key, label, b_disp if before else None, a_disp if after else None, redacted))
        if len(out) >= _MAX_CHANGES:
            break
    return out[:_MAX_CHANGES]


# ── request context ──────────────────────────────────────────────────────────

def _proxy_hops() -> int:
    raw = getattr(settings, "AUDIT_TRUSTED_PROXY_HOPS", None)
    if raw is None:
        raw = os.getenv("AUDIT_TRUSTED_PROXY_HOPS", "2")
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 2


def _valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


def client_ip(request) -> str | None:
    """Best-effort client IP. Prod sits behind two proxies (edge nginx → ticket-nginx),
    each appending to X-Forwarded-For, so the client is the entry the FIRST trusted
    proxy appended: ``XFF[-hops]`` (``AUDIT_TRUSTED_PROXY_HOPS``, default 2). A
    shorter chain falls back to its first entry, then REMOTE_ADDR. X-Real-IP is
    ignored (ticket-nginx overwrites it with the edge's address)."""
    meta = getattr(request, "META", {}) or {}
    xff = [p.strip() for p in (meta.get("HTTP_X_FORWARDED_FOR") or "").split(",") if p.strip()]
    hops = _proxy_hops()
    if xff and hops:
        candidate = xff[-hops] if len(xff) >= hops else xff[0]
        ip = _valid_ip(candidate)
        if ip:
            return ip
    return _valid_ip(meta.get("REMOTE_ADDR") or "")


def user_agent(request) -> str:
    meta = getattr(request, "META", {}) or {}
    return (meta.get("HTTP_USER_AGENT") or "")[:512]


def _request_user(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False) and getattr(user, "pk", None):
        return user
    return None


def _can_write_here() -> bool:
    """The admin log table only exists in tenant schemas in prod. In tests every app
    is SHARED (flattened into public), so writing there is fine."""
    try:
        from django_tenants.utils import get_public_schema_name

        if getattr(connection, "schema_name", None) != get_public_schema_name():
            return True
    except Exception:  # noqa: BLE001
        return True
    return any(str(a).startswith("apps.itsm_core") for a in getattr(settings, "SHARED_APPS", []))


def object_fields(obj) -> dict:
    if obj is None:
        return {}
    meta = obj._meta
    return {
        "object_type": str(meta.verbose_name)[:100],
        "object_id": str(obj.pk)[:64] if obj.pk is not None else "",
        "object_repr": _label(obj)[:255],
    }


# ── write paths ──────────────────────────────────────────────────────────────

def _write(row: dict, schema: str | None):
    from django_tenants.utils import schema_context

    from apps.itsm_core.models.audit import AdminAuditEvent

    try:
        ctx = schema_context(schema) if schema and schema != getattr(connection, "schema_name", None) else None
        if ctx is None:
            if not _can_write_here():
                return None
            with transaction.atomic():
                return AdminAuditEvent.objects.create(**row)
        with ctx:
            if not _can_write_here():
                return None
            with transaction.atomic():
                return AdminAuditEvent.objects.create(**row)
    except Exception:  # noqa: BLE001 — the audit log must never break the request
        logger.exception("admin audit write failed (%s %s)", row.get("action"), row.get("area"))
        return None


def record_event(
    request=None,
    *,
    area: str,
    action: str,
    obj=None,
    changes: list | None = None,
    extra: dict | None = None,
    actor=None,
    actor_label: str | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    object_repr: str | None = None,
    defer: bool = True,
):
    """Record one admin/security audit event. Never raises.

    ``actor`` defaults to the request's authenticated user; ``actor=False`` forces
    none. Pass ``actor_label`` for a failed sign-in (the attempted username) or a
    platform-console operator.
    ``defer=True`` writes on commit (config changes); ``False`` writes now (auth).
    """
    try:
        if not _can_write_here():
            return None
        if actor is False:  # explicitly no actor (failed sign-in, platform console)
            user = None
        else:
            user = actor if actor is not None else (_request_user(request) if request is not None else None)
        if user is not None and not getattr(user, "pk", None):
            user = None
        label = actor_label if actor_label is not None else (getattr(user, "username", "") if user else "")
        row = {
            "actor": user,
            "actor_label": (label or "")[:150],
            "action": (action or "")[:40],
            "area": (area or "")[:100],
            "changes": json_safe(changes or []) if not isinstance(changes, list) else changes[:_MAX_CHANGES],
            "extra": json_safe(extra or {}),
            "ip_address": client_ip(request) if request is not None else None,
            "user_agent": user_agent(request) if request is not None else "",
            **object_fields(obj),
        }
        if object_type is not None:
            row["object_type"] = object_type[:100]
        if object_id is not None:
            row["object_id"] = str(object_id)[:64]
        if object_repr is not None:
            row["object_repr"] = object_repr[:255]
        # Make the payload JSON-clean now (the row may be written after commit).
        row["changes"] = json.loads(json.dumps(row["changes"], default=str))
        row["extra"] = json.loads(json.dumps(row["extra"], default=str))
        schema = getattr(connection, "schema_name", None)
        if defer:
            transaction.on_commit(lambda: _write(row, schema))
            return None
        return _write(row, schema)
    except Exception:  # noqa: BLE001
        logger.exception("admin audit record failed (%s %s)", action, area)
        return None


def record_change(request, *, area, action, obj, before=None, after=None, extra=None, defer=True, **kw):
    """Record a model-level change from two snapshots."""
    return record_event(
        request, area=area, action=action, obj=obj,
        changes=diff(before, after), extra=extra, defer=defer, **kw,
    )


def log_admin_event(request, action, *, area=AUTH_AREA, obj=None, extra=None, actor=None,
                    actor_label=None, defer=False, **kw):
    """Public one-call helper for explicit write sites (e.g. password-reset request /
    confirm views): ``audit.log_admin_event(request, "password_reset_requested",
    obj=user, actor=None, actor_label=attempted)``. Written immediately by default.
    Never pass secrets in ``extra`` (keys named like a secret are redacted anyway)."""
    return record_event(
        request, area=area, action=action, obj=obj,
        extra=redact_payload(extra or {}), actor=actor, actor_label=actor_label,
        defer=defer, **kw,
    )


def audited_save(request, area: str, serializer, **save_kwargs):
    """``serializer.save()`` + an audit row (create/update with a field diff). For
    endpoints outside the ViewSet hook, e.g. the singleton SSO / branding configs."""
    instance = getattr(serializer, "instance", None)
    before = None
    if instance is not None and getattr(instance, "pk", None):
        try:
            before = snapshot(type(instance)._base_manager.filter(pk=instance.pk).first())
        except Exception:  # noqa: BLE001
            before = None
    obj = serializer.save(**save_kwargs)
    try:
        fresh = type(obj)._base_manager.filter(pk=obj.pk).first() or obj
        after = snapshot(fresh)
        changes = diff(before, after)
        if before is not None and not changes:
            return obj
        record_event(
            request, area=area, action="update" if before is not None else "create",
            obj=fresh, changes=changes,
        )
    except Exception:  # noqa: BLE001
        logger.exception("audited_save failed to record (%s)", area)
    return obj
