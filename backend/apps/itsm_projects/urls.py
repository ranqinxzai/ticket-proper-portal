from rest_framework.routers import DefaultRouter

from .views import ProjectMembershipViewSet, ProjectViewSet, TicketTypeViewSet

router = DefaultRouter()
router.register(r"projects", ProjectViewSet, basename="itsm-project")
router.register(r"ticket-types", TicketTypeViewSet, basename="itsm-ticket-type")
router.register(r"project-memberships", ProjectMembershipViewSet,
                basename="itsm-project-membership")

urlpatterns = router.urls
