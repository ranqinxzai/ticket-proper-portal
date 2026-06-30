from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.tenants.jwt import TenantAwareTokenRefreshView
from .views import (
    ItsmLoginView,
    MemberViewSet,
    MeView,
    MicrosoftSsoCallbackView,
    MicrosoftSsoExchangeView,
    MicrosoftSsoStartView,
    ModuleViewSet,
    RoleAssignmentViewSet,
    RoleModulePermissionViewSet,
    SsoConfigAdminView,
    SsoPublicConfigView,
    SystemRoleViewSet,
    UserAttributeDefinitionViewSet,
    UserAttributeOptionViewSet,
)

router = DefaultRouter()
router.register(r"modules", ModuleViewSet, basename="itsm-module")
router.register(r"roles", SystemRoleViewSet, basename="itsm-role")
router.register(r"role-permissions", RoleModulePermissionViewSet, basename="itsm-role-permission")
router.register(r"role-assignments", RoleAssignmentViewSet, basename="itsm-role-assignment")
router.register(r"members", MemberViewSet, basename="itsm-member")
router.register(r"user-attributes", UserAttributeDefinitionViewSet, basename="itsm-user-attribute")
router.register(r"user-attribute-options", UserAttributeOptionViewSet, basename="itsm-user-attribute-option")

urlpatterns = router.urls + [
    path("auth/login/", ItsmLoginView.as_view(), name="itsm-auth-login"),
    path("auth/refresh/", TenantAwareTokenRefreshView.as_view(), name="itsm-auth-refresh"),
    path("auth/me/", MeView.as_view({"get": "list"}), name="itsm-auth-me"),
    # ── Microsoft SSO sign-in (per-tenant Entra app) ────────────────────────
    path("auth/sso/config/", SsoPublicConfigView.as_view(), name="itsm-sso-config"),
    path("auth/sso/microsoft/start/", MicrosoftSsoStartView.as_view(), name="itsm-sso-ms-start"),
    path("auth/sso/microsoft/callback/", MicrosoftSsoCallbackView.as_view(), name="itsm-sso-ms-callback"),
    path("auth/sso/exchange/", MicrosoftSsoExchangeView.as_view(), name="itsm-sso-exchange"),
    # Tenant-admin SSO configuration (gated by itsm.admin.sso).
    path("admin/sso-config/", SsoConfigAdminView.as_view(), name="itsm-sso-admin-config"),
]
