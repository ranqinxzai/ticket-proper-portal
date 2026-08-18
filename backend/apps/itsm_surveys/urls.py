from rest_framework.routers import DefaultRouter

from .views import SurveyConfigViewSet

router = DefaultRouter()
router.register(r"survey-configs", SurveyConfigViewSet, basename="itsm-survey-config")

urlpatterns = router.urls
