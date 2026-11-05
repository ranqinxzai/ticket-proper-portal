from rest_framework.routers import DefaultRouter

from .views import (
    AssetCategoryFieldViewSet,
    AssetCategoryViewSet,
    AssetFieldViewSet,
    AssetImportViewSet,
    AssetStatusViewSet,
    AssetUserViewSet,
    AssetViewSet,
    DepartmentViewSet,
    LocationViewSet,
    VendorViewSet,
)

# Every prefix starts with "asset" — the ITSM apps share one URL namespace and
# e.g. `statuses/` already belongs to workflows.
router = DefaultRouter()
router.register(r"assets", AssetViewSet, basename="itsm-asset")
router.register(r"asset-imports", AssetImportViewSet, basename="itsm-asset-import")
router.register(r"asset-categories", AssetCategoryViewSet, basename="itsm-asset-category")
router.register(r"asset-fields", AssetFieldViewSet, basename="itsm-asset-field")
router.register(r"asset-category-fields", AssetCategoryFieldViewSet, basename="itsm-asset-category-field")
router.register(r"asset-statuses", AssetStatusViewSet, basename="itsm-asset-status")
router.register(r"asset-vendors", VendorViewSet, basename="itsm-asset-vendor")
router.register(r"asset-locations", LocationViewSet, basename="itsm-asset-location")
router.register(r"asset-departments", DepartmentViewSet, basename="itsm-asset-department")
router.register(r"asset-users", AssetUserViewSet, basename="itsm-asset-user")

urlpatterns = router.urls
