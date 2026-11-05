from rest_framework.routers import DefaultRouter

from .views import AutomationRuleViewSet

router = DefaultRouter()
router.register(r"automation-rules", AutomationRuleViewSet, basename="itsm-automation-rule")

urlpatterns = router.urls
