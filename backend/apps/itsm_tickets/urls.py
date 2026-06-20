from rest_framework.routers import DefaultRouter

from .portal import PortalTicketViewSet
from .views import (
    CannedNoteCategoryViewSet,
    CannedNoteViewSet,
    CommentViewSet,
    TemplateCategoryViewSet,
    TicketAttachmentViewSet,
    TicketLinkViewSet,
    TicketTemplateViewSet,
    TicketViewSet,
    WatcherViewSet,
)

router = DefaultRouter()
router.register(r"tickets", TicketViewSet, basename="itsm-ticket")
router.register(r"comments", CommentViewSet, basename="itsm-comment")
router.register(r"watchers", WatcherViewSet, basename="itsm-watcher")
router.register(r"ticket-links", TicketLinkViewSet, basename="itsm-ticket-link")
router.register(r"ticket-attachments", TicketAttachmentViewSet, basename="itsm-ticket-attachment")
router.register(r"canned-note-categories", CannedNoteCategoryViewSet, basename="itsm-canned-note-category")
router.register(r"canned-notes", CannedNoteViewSet, basename="itsm-canned-note")
router.register(r"template-categories", TemplateCategoryViewSet, basename="itsm-template-category")
router.register(r"ticket-templates", TicketTemplateViewSet, basename="itsm-ticket-template")
router.register(r"portal/requests", PortalTicketViewSet, basename="itsm-portal-request")

urlpatterns = router.urls
