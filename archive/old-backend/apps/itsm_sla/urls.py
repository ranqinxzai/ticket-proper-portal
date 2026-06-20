from rest_framework.routers import DefaultRouter

from .views import (
    BusinessCalendarViewSet,
    EscalationRuleViewSet,
    HolidayViewSet,
    SLAMetricViewSet,
    SLAPolicyViewSet,
    SLATargetViewSet,
    SLATrackerViewSet,
)

router = DefaultRouter()
router.register(r"sla-policies", SLAPolicyViewSet, basename="itsm-sla-policy")
router.register(r"sla-metrics", SLAMetricViewSet, basename="itsm-sla-metric")
router.register(r"sla-targets", SLATargetViewSet, basename="itsm-sla-target")
router.register(r"escalation-rules", EscalationRuleViewSet, basename="itsm-escalation-rule")
router.register(r"business-calendars", BusinessCalendarViewSet, basename="itsm-business-calendar")
router.register(r"holidays", HolidayViewSet, basename="itsm-holiday")
router.register(r"sla-trackers", SLATrackerViewSet, basename="itsm-sla-tracker")

urlpatterns = router.urls
