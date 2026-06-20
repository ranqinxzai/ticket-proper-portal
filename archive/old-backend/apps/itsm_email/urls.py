from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EmailChannelViewSet,
    EmailRuleViewSet,
    InboundEmailViewSet,
    OAuthCallbackView,
)

router = DefaultRouter()
router.register(r"email-channels", EmailChannelViewSet, basename="itsm-email-channel")
router.register(r"email-rules", EmailRuleViewSet, basename="itsm-email-rule")
router.register(r"inbound-emails", InboundEmailViewSet, basename="itsm-inbound-email")

urlpatterns = [
    path("email/oauth/callback/", OAuthCallbackView.as_view(), name="itsm-email-oauth-callback"),
] + router.urls
