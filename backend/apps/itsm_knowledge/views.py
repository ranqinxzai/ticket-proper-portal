from __future__ import annotations

from django.db.models import F
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_core.services.html import html_to_text, sanitize_html
from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet

from .models import Article, ArticleTicketLink, KBCategory
from .serializers import (
    ArticleListSerializer,
    ArticleSerializer,
    ArticleTicketLinkSerializer,
    KBCategorySerializer,
)


class KBCategoryViewSet(ItsmModelViewSet):
    queryset = KBCategory.objects.filter(is_deleted=False)
    serializer_class = KBCategorySerializer
    module_code = "itsm.knowledge.authoring"
    filterset_fields = ["helpdesk", "parent"]
    search_fields = ["name"]


class ArticleAdminViewSet(ItsmModelViewSet):
    """Authoring surface: agents see drafts + internal articles, can publish."""

    queryset = Article.objects.filter(is_deleted=False).select_related("category", "author")
    module_code = "itsm.knowledge"
    filterset_fields = ["category", "helpdesk", "status", "visibility"]
    search_fields = ["title", "body_text", "summary"]

    def get_serializer_class(self):
        return ArticleListSerializer if self.action == "list" else ArticleSerializer

    def _save_body(self, serializer, **extra):
        body = serializer.validated_data.get("body_html", "")
        serializer.save(body_html=sanitize_html(body), body_text=html_to_text(body), **extra)

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        self._save_body(serializer, author=user, created_by=user)

    def perform_update(self, serializer):
        self._save_body(serializer)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        article = self.get_object()
        article.status = "published"
        if article.published_at is None:
            article.published_at = timezone.now()
        article.save(update_fields=["status", "published_at", "updated_at"])
        return Response(ArticleSerializer(article).data)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        article = self.get_object()
        article.status = "draft"
        article.save(update_fields=["status", "updated_at"])
        return Response(ArticleSerializer(article).data)


class KBBrowseViewSet(viewsets.ReadOnlyModelViewSet):
    """Portal/agent reading surface: only published, portal-visible articles."""

    queryset = Article.objects.filter(
        is_deleted=False, status="published", visibility="portal"
    ).select_related("category")
    permission_classes = [HasModulePermission]
    module_code = "itsm.knowledge"
    filterset_fields = ["category", "helpdesk"]
    search_fields = ["title", "body_text", "summary", "tags"]

    def get_serializer_class(self):
        return ArticleListSerializer if self.action == "list" else ArticleSerializer

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        Article.objects.filter(pk=instance.pk).update(view_count=F("view_count") + 1)
        instance.refresh_from_db(fields=["view_count"])
        return Response(ArticleSerializer(instance).data)

    @action(detail=False, methods=["get"])
    def categories(self, request):
        cats = KBCategory.objects.filter(is_deleted=False).order_by("sort_order", "name")
        return Response(KBCategorySerializer(cats, many=True).data)


class ArticleTicketLinkViewSet(ItsmModelViewSet):
    queryset = ArticleTicketLink.objects.filter(is_deleted=False).select_related("article")
    serializer_class = ArticleTicketLinkSerializer
    module_code = "itsm.knowledge"
    filterset_fields = ["ticket", "article", "link_type"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)
