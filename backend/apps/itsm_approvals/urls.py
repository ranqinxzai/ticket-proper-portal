from rest_framework.routers import DefaultRouter

from .views import ApprovalRequestViewSet, ApprovalStageViewSet, ApprovalWorkflowViewSet

router = DefaultRouter()
router.register(r"approval-workflows", ApprovalWorkflowViewSet, basename="itsm-approval-workflow")
router.register(r"approval-stages", ApprovalStageViewSet, basename="itsm-approval-stage")
router.register(r"approval-requests", ApprovalRequestViewSet, basename="itsm-approval-request")

urlpatterns = router.urls
