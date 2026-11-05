"""Routes for the admin & security audit-log viewer (mounted under /api/v1/itsm/)."""

from rest_framework.routers import DefaultRouter

from .audit_api import AdminAuditEventViewSet

router = DefaultRouter()
router.register(r"audit-events", AdminAuditEventViewSet, basename="itsm-audit-event")

urlpatterns = router.urls
