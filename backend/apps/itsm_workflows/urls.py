from rest_framework.routers import DefaultRouter

from .views import (
    AutoAssignmentRuleViewSet,
    ReopenRuleViewSet,
    StatusCategoryViewSet,
    StatusViewSet,
    TransitionScreenViewSet,
    TransitionViewSet,
    WorkflowViewSet,
)

router = DefaultRouter()
router.register(r"workflows", WorkflowViewSet, basename="itsm-workflow")
router.register(r"status-categories", StatusCategoryViewSet, basename="itsm-status-category")
router.register(r"statuses", StatusViewSet, basename="itsm-status")
router.register(r"transitions", TransitionViewSet, basename="itsm-transition")
router.register(r"auto-assignment-rules", AutoAssignmentRuleViewSet, basename="itsm-autoassign")
router.register(r"reopen-rules", ReopenRuleViewSet, basename="itsm-reopen-rule")
router.register(r"transition-screens", TransitionScreenViewSet, basename="itsm-transition-screen")

urlpatterns = router.urls
