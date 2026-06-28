"""Provisioning console API — mounted at /api/v1/admin/ (public schema only)."""

from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import OrgViewSet, PlatformLoginView

router = DefaultRouter()
router.register("orgs", OrgViewSet, basename="org")

urlpatterns = [
    path("auth/login/", PlatformLoginView.as_view(), name="platform-login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="platform-refresh"),
    path("", include(router.urls)),
]
