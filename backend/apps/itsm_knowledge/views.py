from __future__ import annotations

from django.db.models import F
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.filters import OrderingFilter
from rest_framework.response import Response

from apps.itsm_core.services.html import html_to_text, sanitize_html
from apps.itsm_rbac.permissions import HasModulePermission, ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

from . import services
from .models import Article, ArticleTicketLink, KBCategory
from .search import ArticleSearchFilter
from .serializers import (
    ArticleListSerializer,
    ArticleSerializer,
    ArticleTicketLinkSerializer,
    KBCategorySerializer,
)

# Search runs AFTER ordering so it can re-order by relevance on the default sort (G6).
KB_FILTER_BACKENDS = [DjangoFilterBackend, OrderingFilter, ArticleSearchFilter]


def can_author_kb(user) -> bool:
    """Mirrors the frontend `useCanAuthorKb`: create/update on the KB article or
    authoring module (superusers bypass inside `check_permission`). Requestors hold
    only `itsm.knowledge:read`, so they are NOT authors."""
    return any(
        check_permission(user, module, perm)
        for module in ("itsm.knowledge", "itsm.knowledge.authoring")
        for perm in ("create", "update")
    )


class KBCategoryViewSet(ItsmModelViewSet):
    queryset = KBCategory.objects.filter(is_deleted=False)
    serializer_class = KBCategorySerializer
    module_code = "itsm.knowledge.authoring"
    # `helpdesk__isnull=true` = the Organisation-wide scope (was filtered client-side
    # from page 1 only).
    filterset_fields = {"helpdesk": ["exact", "isnull"], "parent": ["exact"]}
    search_fields = ["name"]

    def perform_destroy(self, instance):
        # Articles become uncategorised + sub-categories move to the top level.
        services.delete_category(
            instance, user=self.request.user if self.request.user.is_authenticated else None)


class ArticleAdminViewSet(ItsmModelViewSet):
    """Authoring surface: authors see drafts + internal + archived articles.

    Non-authors (e.g. requestors, who hold `itsm.knowledge:read` for the portal) only
    ever see published, portal-visible articles here — the same set as `/kb/`.
    The list hides archived articles unless `?status=` is given."""

    queryset = Article.objects.filter(is_deleted=False).select_related("category", "author")
    module_code = "itsm.knowledge"
    filter_backends = KB_FILTER_BACKENDS
    filterset_fields = {"category": ["exact"], "helpdesk": ["exact", "isnull"],
                        "status": ["exact"], "visibility": ["exact"]}
    search_fields = ["title", "body_text", "summary", "tags"]

    def get_queryset(self):
        qs = super().get_queryset()
        if not can_author_kb(self.request.user):
            return qs.filter(status=Article.Status.PUBLISHED, visibility=Article.Visibility.PORTAL)
        if self.action == "list" and not self.request.query_params.get("status"):
            qs = qs.exclude(status=Article.Status.ARCHIVED)
        return qs

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

    # Lifecycle actions are POST ⇒ `itsm.knowledge:create` (agents yes, requestors no);
    # archive is reversible, so it sits with publish/unpublish. Delete stays
    # supervisor-only (DELETE ⇒ `itsm.knowledge:delete`).
    def _lifecycle(self, fn):
        article = self.get_object()
        try:
            fn(article)
        except services.LifecycleError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(ArticleSerializer(article).data)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        return self._lifecycle(services.publish)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        return self._lifecycle(services.unpublish)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._lifecycle(services.archive)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return self._lifecycle(services.restore)


class KBBrowseViewSet(viewsets.ReadOnlyModelViewSet):
    """Portal/agent reading surface: only published, portal-visible articles."""

    queryset = Article.objects.filter(
        is_deleted=False, status="published", visibility="portal"
    ).select_related("category")
    permission_classes = [HasModulePermission]
    module_code = "itsm.knowledge"
    filter_backends = KB_FILTER_BACKENDS
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
    """Article ↔ ticket links. Authors only (requestors used to read every link,
    leaking internal/draft article titles and ticket ids), clamped to the tickets the
    caller can reach (helpdesk + project scope, rule 15)."""

    queryset = (ArticleTicketLink.objects.filter(is_deleted=False, ticket__is_deleted=False)
                .select_related("article").order_by("-created_at"))
    serializer_class = ArticleTicketLinkSerializer
    module_code = "itsm.knowledge"
    filterset_fields = ["ticket", "article", "link_type"]

    def _ticket_scope(self, qs, prefix):
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from apps.itsm_projects.services import accessible_project_ids_cached
        hd = accessible_helpdesk_ids_cached(self.request)
        pj = accessible_project_ids_cached(self.request)
        if hd is not None:
            qs = qs.filter(**{f"{prefix}project__helpdesk_id__in": hd})
        if pj is not None:
            qs = qs.filter(**{f"{prefix}project_id__in": pj})
        return qs

    def get_queryset(self):
        qs = super().get_queryset()
        if not can_author_kb(self.request.user):
            return qs.none()
        return self._ticket_scope(qs, "ticket__")

    def perform_create(self, serializer):
        from apps.itsm_tickets.models import Ticket
        ticket = serializer.validated_data.get("ticket")
        if ticket is None or not self._ticket_scope(
                Ticket.objects.filter(pk=ticket.pk, is_deleted=False), "").exists():
            raise PermissionDenied("You do not have access to this ticket.")
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)
