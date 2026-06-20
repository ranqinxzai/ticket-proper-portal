from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ItsmLoginView,
    MeView,
    ModuleViewSet,
    RoleAssignmentViewSet,
    RoleModulePermissionViewSet,
    SystemRoleViewSet,
)

router = DefaultRouter()
router.register(r"modules", ModuleViewSet, basename="itsm-module")
router.register(r"roles", SystemRoleViewSet, basename="itsm-role")
router.register(r"role-permissions", RoleModulePermissionViewSet, basename="itsm-role-permission")
router.register(r"role-assignments", RoleAssignmentViewSet, basename="itsm-role-assignment")

urlpatterns = router.urls + [
    path("auth/login/", ItsmLoginView.as_view(), name="itsm-auth-login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="itsm-auth-refresh"),
    path("auth/me/", MeView.as_view({"get": "list"}), name="itsm-auth-me"),
]
