from __future__ import annotations

from rest_framework import viewsets

from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import (
    BusinessCalendar,
    BusinessHours,
    EscalationRule,
    Holiday,
    SLAMetric,
    SLAPolicy,
    SLATarget,
    SLATracker,
)
from .serializers import (
    BusinessCalendarSerializer,
    BusinessHoursSerializer,
    EscalationRuleSerializer,
    HolidaySerializer,
    SLAMetricSerializer,
    SLAPolicySerializer,
    SLATargetSerializer,
    SLATrackerSerializer,
)


class SLAPolicyViewSet(ItsmModelViewSet):
    queryset = SLAPolicy.objects.filter(is_deleted=False).prefetch_related(
        "metrics__targets", "metrics__escalations"
    )
    serializer_class = SLAPolicySerializer
    module_code = "itsm.sla.policies"
    filterset_fields = ["project", "is_active"]


class SLAMetricViewSet(ItsmModelViewSet):
    queryset = SLAMetric.objects.filter(is_deleted=False).prefetch_related("targets")
    serializer_class = SLAMetricSerializer
    module_code = "itsm.sla.policies"
    filterset_fields = ["policy"]


class SLATargetViewSet(ItsmModelViewSet):
    queryset = SLATarget.objects.filter(is_deleted=False)
    serializer_class = SLATargetSerializer
    module_code = "itsm.sla.policies"
    filterset_fields = ["metric"]

    def perform_create(self, serializer):
        # A blank target is saved as a soft delete; filling it in again must revive
        # that row, not collide with uniq_metric_priority (was a 500).
        _create_or_revive(serializer, ("metric", "priority"))


class EscalationRuleViewSet(ItsmModelViewSet):
    queryset = EscalationRule.objects.filter(is_deleted=False)
    serializer_class = EscalationRuleSerializer
    module_code = "itsm.sla.policies"
    filterset_fields = ["metric"]


class BusinessCalendarViewSet(ItsmModelViewSet):
    queryset = BusinessCalendar.objects.filter(is_deleted=False).prefetch_related("hours", "holidays")
    serializer_class = BusinessCalendarSerializer
    module_code = "itsm.sla.calendars"

    def perform_create(self, serializer):
        # New calendars start with Mon–Fri 09:00–17:00 (local to their timezone), so
        # an SLA on a just-created calendar never runs with no working hours.
        from .services.calendars import ensure_default_hours
        ensure_default_hours(serializer.save())


class BusinessHoursViewSet(ItsmModelViewSet):
    # Per-row CRUD for a calendar's working windows. Multiple windows per weekday
    # are intentional (split shifts) — business_time.spec_from_calendar aggregates
    # them — so there is deliberately NO (calendar, weekday) unique constraint.
    queryset = BusinessHours.objects.filter(is_deleted=False).select_related("calendar")
    serializer_class = BusinessHoursSerializer
    module_code = "itsm.sla.calendars"
    filterset_fields = ["calendar", "weekday"]


class HolidayViewSet(ItsmModelViewSet):
    queryset = Holiday.objects.filter(is_deleted=False)
    serializer_class = HolidaySerializer
    module_code = "itsm.sla.calendars"
    filterset_fields = ["calendar"]

    def perform_create(self, serializer):
        # Re-adding a deleted holiday revives its row (uniq_calendar_holiday spans
        # soft-deleted rows, so a plain INSERT was a 500).
        _create_or_revive(serializer, ("calendar", "date"))


class SLATrackerViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SLATracker.objects.filter(is_deleted=False).select_related("metric")
    serializer_class = SLATrackerSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.sla"
    filterset_fields = ["ticket", "state", "breached"]

    def get_queryset(self):
        # Clamp SLA trackers to the requester's accessible helpdesks — otherwise an
        # agent could enumerate every helpdesk's SLA/breach state.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached
        qs = super().get_queryset()
        scope = accessible_helpdesk_ids_cached(self.request)
        if scope is not None:
            qs = qs.filter(ticket__project__helpdesk_id__in=scope)
        # Finer per-user project clamp (strict whitelist).
        pscope = accessible_project_ids_cached(self.request)
        if pscope is not None:
            qs = qs.filter(ticket__project_id__in=pscope)
        return qs


def _create_or_revive(serializer, unique_fields):
    """``serializer.save()``, unless a SOFT-DELETED row already holds the same unique
    key: then restore that row with the submitted values. DRF's unique validator only
    sees live rows (default manager), so without this the INSERT hits the DB unique
    constraint and 500s."""
    model = serializer.Meta.model
    data = serializer.validated_data
    lookup = {f: data[f] for f in unique_fields if f in data}
    dead = (model.all_objects.filter(is_deleted=True, **lookup).first()
            if len(lookup) == len(unique_fields) else None)
    if dead is None:
        serializer.save()
        return
    for attr, value in data.items():
        setattr(dead, attr, value)
    dead.is_deleted, dead.deleted_at, dead.deleted_by = False, None, None
    dead.save()
    serializer.instance = dead
