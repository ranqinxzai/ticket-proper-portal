from rest_framework.routers import DefaultRouter

from .views import (
    DashboardViewSet,
    QueueColumnPreferenceViewSet,
    QueueViewPreferenceViewSet,
    SavedFilterViewSet,
    WidgetViewSet,
)

router = DefaultRouter()
router.register(r"saved-filters", SavedFilterViewSet, basename="itsm-saved-filter")
router.register(r"queue-columns", QueueColumnPreferenceViewSet, basename="itsm-queue-columns")
router.register(r"queue-view", QueueViewPreferenceViewSet, basename="itsm-queue-view")
router.register(r"dashboards", DashboardViewSet, basename="itsm-dashboard")
router.register(r"widgets", WidgetViewSet, basename="itsm-widget")

urlpatterns = router.urls
