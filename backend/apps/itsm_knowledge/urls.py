from rest_framework.routers import DefaultRouter

from .views import (
    ArticleAdminViewSet,
    ArticleTicketLinkViewSet,
    KBBrowseViewSet,
    KBCategoryViewSet,
)

router = DefaultRouter()
router.register(r"kb-categories", KBCategoryViewSet, basename="itsm-kb-category")
router.register(r"kb-articles", ArticleAdminViewSet, basename="itsm-kb-article")
router.register(r"kb-article-links", ArticleTicketLinkViewSet, basename="itsm-kb-article-link")
router.register(r"kb", KBBrowseViewSet, basename="itsm-kb-browse")

urlpatterns = router.urls
