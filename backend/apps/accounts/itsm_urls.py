"""Unauthenticated self-service password reset, under the ITSM API prefix
(``/api/v1/t/<org>/itsm/auth/password-reset/…``)."""

from django.urls import path

from .password_reset_views import (
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordResetValidateView,
)

urlpatterns = [
    path("auth/password-reset/", PasswordResetRequestView.as_view(),
         name="itsm-auth-password-reset"),
    path("auth/password-reset/validate/", PasswordResetValidateView.as_view(),
         name="itsm-auth-password-reset-validate"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(),
         name="itsm-auth-password-reset-confirm"),
]
