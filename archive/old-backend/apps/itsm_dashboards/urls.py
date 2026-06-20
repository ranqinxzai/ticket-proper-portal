from rest_framework.routers import DefaultRouter

from .views import DashboardViewSet, SavedFilterViewSet, WidgetViewSet

router = DefaultRouter()
router.register(r"saved-filters", SavedFilterViewSet, basename="itsm-saved-filter")
router.register(r"dashboards", DashboardViewSet, basename="itsm-dashboard")
router.register(r"widgets", WidgetViewSet, basename="itsm-widget")

urlpatterns = router.urls
