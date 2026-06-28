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


class EscalationRuleViewSet(ItsmModelViewSet):
    queryset = EscalationRule.objects.filter(is_deleted=False)
    serializer_class = EscalationRuleSerializer
    module_code = "itsm.sla.policies"
    filterset_fields = ["metric"]


class BusinessCalendarViewSet(ItsmModelViewSet):
    queryset = BusinessCalendar.objects.filter(is_deleted=False).prefetch_related("hours", "holidays")
    serializer_class = BusinessCalendarSerializer
    module_code = "itsm.sla.calendars"


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
