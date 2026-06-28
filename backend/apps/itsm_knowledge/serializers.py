from __future__ import annotations

from rest_framework import serializers

from .models import Article, ArticleTicketLink, KBCategory


class KBCategorySerializer(serializers.ModelSerializer):
    helpdesk_key = serializers.CharField(source="helpdesk.key", read_only=True, default=None)

    class Meta:
        model = KBCategory
        fields = ["id", "name", "slug", "description", "parent", "helpdesk", "helpdesk_key", "sort_order"]


class ArticleListSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)

    class Meta:
        model = Article
        fields = ["id", "title", "slug", "summary", "category", "category_name", "helpdesk", "status",
                  "visibility", "tags", "view_count", "published_at", "updated_at"]


class ArticleSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    author_name = serializers.CharField(source="author.full_name", read_only=True, default=None)

    class Meta:
        model = Article
        fields = ["id", "category", "category_name", "helpdesk", "title", "slug", "body_html",
                  "summary", "status", "visibility", "tags", "author", "author_name",
                  "published_at", "view_count", "helpful_count", "not_helpful_count", "created_at"]
        read_only_fields = ["body_text", "view_count", "published_at"]


class ArticleTicketLinkSerializer(serializers.ModelSerializer):
    article_title = serializers.CharField(source="article.title", read_only=True)
    article_slug = serializers.CharField(source="article.slug", read_only=True)

    class Meta:
        model = ArticleTicketLink
        fields = ["id", "article", "article_title", "article_slug", "ticket", "link_type", "created_at"]
