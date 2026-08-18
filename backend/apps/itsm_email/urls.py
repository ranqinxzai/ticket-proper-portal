from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EmailChannelViewSet,
    EmailRoutingRuleViewSet,
    EmailRuleViewSet,
    HelpdeskEmailTransportViewSet,
    InboundEmailViewSet,
    OAuthCallbackView,
)

router = DefaultRouter()
router.register(r"email-channels", EmailChannelViewSet, basename="itsm-email-channel")
router.register(r"email-rules", EmailRuleViewSet, basename="itsm-email-rule")
router.register(r"email-routing-rules", EmailRoutingRuleViewSet, basename="itsm-email-routing-rule")
router.register(
    r"helpdesk-email-transports", HelpdeskEmailTransportViewSet,
    basename="itsm-helpdesk-email-transport",
)
router.register(r"inbound-emails", InboundEmailViewSet, basename="itsm-inbound-email")

urlpatterns = [
    path("email/oauth/callback/", OAuthCallbackView.as_view(), name="itsm-email-oauth-callback"),
] + router.urls
