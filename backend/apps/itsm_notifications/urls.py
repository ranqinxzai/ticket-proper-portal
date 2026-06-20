from rest_framework.routers import DefaultRouter

from .views import (
    EmailTemplateViewSet,
    InAppNotificationViewSet,
    NotificationRuleViewSet,
    NotificationSchemeViewSet,
)

router = DefaultRouter()
router.register(r"notification-schemes", NotificationSchemeViewSet, basename="itsm-notification-scheme")
router.register(r"notification-rules", NotificationRuleViewSet, basename="itsm-notification-rule")
router.register(r"email-templates", EmailTemplateViewSet, basename="itsm-email-template")
router.register(r"notifications", InAppNotificationViewSet, basename="itsm-notification")

urlpatterns = router.urls
