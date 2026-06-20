from rest_framework.routers import DefaultRouter

from .views import HelpdeskMembershipViewSet, HelpdeskViewSet

router = DefaultRouter()
router.register(r"helpdesks", HelpdeskViewSet, basename="itsm-helpdesk")
router.register(r"helpdesk-memberships", HelpdeskMembershipViewSet, basename="itsm-helpdesk-membership")

urlpatterns = router.urls
