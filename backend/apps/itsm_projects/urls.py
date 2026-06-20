from rest_framework.routers import DefaultRouter

from .views import ProjectViewSet, TicketTypeViewSet

router = DefaultRouter()
router.register(r"projects", ProjectViewSet, basename="itsm-project")
router.register(r"ticket-types", TicketTypeViewSet, basename="itsm-ticket-type")

urlpatterns = router.urls
