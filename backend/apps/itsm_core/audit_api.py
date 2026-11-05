"""Read-only viewer API for the admin & security audit log.

``GET audit-events/`` (paginated + filters), ``audit-events/{id}/``,
``audit-events/facets/`` (filter options) and ``audit-events/export/`` (CSV of the
filtered set, newest first, capped at ``EXPORT_MAX_ROWS``). Gated by module
``itsm.admin.audit`` (read). Tenant isolation is the active schema.
"""

from __future__ import annotations

import csv
import datetime as _dt
import io

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.itsm_rbac.permissions import HasModulePermission

from .models.audit import AdminAuditEvent
from .services import audit


class AdminAuditEventSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    actor_name = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()
    area_label = serializers.SerializerMethodField()

    class Meta:
        model = AdminAuditEvent
        fields = [
            "id", "created_at", "actor", "actor_name", "actor_label",
            "action", "action_label", "area", "area_label",
            "object_type", "object_id", "object_repr",
            "changes", "extra", "ip_address", "user_agent",
        ]
        read_only_fields = fields

    def get_actor(self, obj) -> str | None:
        return str(obj.actor_id) if obj.actor_id else None

    def get_actor_name(self, obj) -> str:
        user = obj.actor
        if user is not None:
            return (getattr(user, "full_name", "") or user.username or obj.actor_label)
        return obj.actor_label

    def get_action_label(self, obj) -> str:
        return audit.action_label(obj.action)

    def get_area_label(self, obj) -> str:
        return audit.area_label(obj.area)


class AuditPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 200


def _parse_bound(raw: str | None, *, end: bool, name: str):
    if not raw:
        return None
    value = parse_datetime(raw)
    if value is not None:
        return value if timezone.is_aware(value) else timezone.make_aware(value, _dt.timezone.utc)
    day = parse_date(raw)
    if day is None:
        raise ValidationError({name: "Enter a valid date or date-time (ISO 8601)."})
    t = _dt.time.max if end else _dt.time.min
    return _dt.datetime.combine(day, t, tzinfo=_dt.timezone.utc)


def _csv_cell(value) -> str:
    """Neutralise spreadsheet formulas (an attacker controls failed-login usernames)."""
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def _fmt(value) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value) or "—"
    return str(value)


def _changes_text(changes) -> str:
    if not isinstance(changes, list):
        return ""
    return "; ".join(
        f"{c.get('label') or c.get('field')}: {_fmt(c.get('old'))} → {_fmt(c.get('new'))}"
        for c in changes if isinstance(c, dict)
    )


class AdminAuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AdminAuditEventSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.admin.audit"
    pagination_class = AuditPagination
    filter_backends: list = []  # filtering is explicit below

    def get_queryset(self):
        qs = AdminAuditEvent.objects.select_related("actor").order_by("-created_at", "-id")
        params = self.request.query_params
        start = _parse_bound(params.get("date_from"), end=False, name="date_from")
        end = _parse_bound(params.get("date_to"), end=True, name="date_to")
        if start is not None:
            qs = qs.filter(created_at__gte=start)
        if end is not None:
            qs = qs.filter(created_at__lte=end)
        actor = (params.get("actor") or "").strip()
        if actor:
            if not actor.isdigit():
                raise ValidationError({"actor": "Unknown user id."})
            qs = qs.filter(actor_id=int(actor))
        areas = [a for a in (params.get("area") or "").split(",") if a.strip()]
        if areas:
            qs = qs.filter(area__in=[a.strip() for a in areas])
        actions = [a for a in (params.get("action") or "").split(",") if a.strip()]
        if actions:
            qs = qs.filter(action__in=[a.strip() for a in actions])
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(object_repr__icontains=q) | Q(object_type__icontains=q)
                | Q(actor_label__icontains=q) | Q(object_id=q)
            )
        return qs

    @action(detail=False, methods=["get"])
    def facets(self, request):
        present_areas = set(AdminAuditEvent.objects.values_list("area", flat=True).distinct())
        areas = {**audit.AUDITED_AREAS, **audit.EXTRA_AREAS}
        area_rows = [{"value": k, "label": v} for k, v in areas.items()]
        area_rows += [{"value": a, "label": a} for a in sorted(present_areas - set(areas))]
        present_actions = set(AdminAuditEvent.objects.values_list("action", flat=True).distinct())
        action_codes = list(audit.ACTION_LABELS) + sorted(present_actions - set(audit.ACTION_LABELS))
        actors = (
            AdminAuditEvent.objects.exclude(actor=None)
            .values("actor_id", "actor__username", "actor__full_name").distinct()
            .order_by("actor__full_name", "actor__username")[:200]
        )
        return Response({
            "areas": sorted(area_rows, key=lambda r: r["label"].lower()),
            "actions": [{"value": c, "label": audit.action_label(c)} for c in action_codes],
            "actors": [
                {"value": str(r["actor_id"]),
                 "label": r["actor__full_name"] or r["actor__username"] or str(r["actor_id"])}
                for r in actors
            ],
            "export_max_rows": audit.EXPORT_MAX_ROWS,
        })

    @action(detail=False, methods=["get"])
    def export(self, request):
        qs = self.get_queryset()
        total = qs.count()
        cap = audit.EXPORT_MAX_ROWS
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Time (UTC)", "Actor", "Action", "Area", "Object type", "Object", "Object ID",
            "Changes", "IP address", "User agent", "Details",
        ])
        rows = 0
        for ev in qs[:cap].iterator(chunk_size=500):
            actor = ev.actor_label
            if ev.actor_id and ev.actor is not None:
                actor = getattr(ev.actor, "full_name", "") or ev.actor.username
            details = "; ".join(f"{k}: {_fmt(v)}" for k, v in (ev.extra or {}).items())
            writer.writerow([_csv_cell(v) for v in (
                ev.created_at.astimezone(_dt.timezone.utc).isoformat(), actor,
                audit.action_label(ev.action), audit.area_label(ev.area), ev.object_type,
                ev.object_repr, ev.object_id, _changes_text(ev.changes),
                ev.ip_address or "", ev.user_agent, details,
            )])
            rows += 1
        truncated = total > cap
        audit.record_event(
            request, area=audit.AUDIT_AREA, action="exported",
            object_type="audit log", object_repr=f"{rows} of {total} events",
            extra={"filters": audit.redact_payload(dict(request.query_params.items())),
                   "rows": rows, "total": total, "truncated": truncated},
            defer=False,
        )
        stamp = timezone.now().strftime("%Y%m%d-%H%M")
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="audit-log-{stamp}.csv"'
        resp["X-Audit-Export-Total"] = str(total)
        resp["X-Audit-Export-Truncated"] = "1" if truncated else "0"
        resp["Access-Control-Expose-Headers"] = "Content-Disposition, X-Audit-Export-Total, X-Audit-Export-Truncated"
        return resp
