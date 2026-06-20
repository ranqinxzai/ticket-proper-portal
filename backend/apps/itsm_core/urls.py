from rest_framework.routers import DefaultRouter

from .views import (
    FieldDefinitionViewSet,
    FieldLayoutItemViewSet,
    FieldLayoutViewSet,
    FieldOptionViewSet,
)

router = DefaultRouter()
router.register(r"field-definitions", FieldDefinitionViewSet, basename="itsm-field-definition")
router.register(r"field-options", FieldOptionViewSet, basename="itsm-field-option")
router.register(r"field-layouts", FieldLayoutViewSet, basename="itsm-field-layout")
router.register(r"field-layout-items", FieldLayoutItemViewSet, basename="itsm-field-layout-item")

urlpatterns = router.urls
