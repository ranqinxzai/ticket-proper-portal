from rest_framework.routers import DefaultRouter

from .views import CatalogBrowseViewSet, CatalogCategoryViewSet, CatalogItemAdminViewSet

router = DefaultRouter()
router.register(r"catalog-categories", CatalogCategoryViewSet, basename="itsm-catalog-category")
router.register(r"catalog-items", CatalogItemAdminViewSet, basename="itsm-catalog-item")
router.register(r"catalog", CatalogBrowseViewSet, basename="itsm-catalog")

urlpatterns = router.urls
