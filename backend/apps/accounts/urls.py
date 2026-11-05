from rest_framework.routers import DefaultRouter

from .views import UserViewSet

# Read-only, agent-only user directory (see views.py). The legacy session
# auth/login|logout|me routes were removed 2026-10-18 (S8): every app signs in
# with JWT through itsm/auth/login/.
router = DefaultRouter()
router.register(r"users", UserViewSet, basename="user")

urlpatterns = router.urls
