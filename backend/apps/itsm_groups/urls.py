from rest_framework.routers import DefaultRouter

from .views import GroupMembershipViewSet, GroupViewSet, RoutingRuleViewSet

router = DefaultRouter()
router.register(r"groups", GroupViewSet, basename="itsm-group")
router.register(r"group-memberships", GroupMembershipViewSet, basename="itsm-group-membership")
router.register(r"routing-rules", RoutingRuleViewSet, basename="itsm-routing-rule")

urlpatterns = router.urls
