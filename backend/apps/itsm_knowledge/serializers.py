from __future__ import annotations

from rest_framework import serializers

from .models import Article, ArticleTicketLink, KBCategory


class KBCategorySerializer(serializers.ModelSerializer):
    helpdesk_key = serializers.CharField(source="helpdesk.key", read_only=True, default=None)

    class Meta:
        model = KBCategory
        fields = ["id", "name", "slug", "description", "parent", "helpdesk", "helpdesk_key", "sort_order"]

    def validate(self, attrs):
        """One level of nesting, enforced server-side (B16). Checked on create and when
        ``parent`` changes, so editing other fields of a legacy row never 400s."""
        attrs = super().validate(attrs)
        if "parent" not in attrs:
            return attrs
        parent = attrs["parent"]
        inst = self.instance
        if inst is not None and (parent.pk if parent else None) == inst.parent_id:
            return attrs  # parent unchanged
        if parent is None:
            return attrs
        if inst is not None and parent.pk == inst.pk:
            raise serializers.ValidationError({"parent": ["A category can't be its own parent."]})
        if parent.parent_id:
            raise serializers.ValidationError({"parent": [
                f"“{parent.name}” is already a sub-category. Pick a top-level category: "
                "only one level of nesting is allowed."]})
        if inst is not None and inst.children.filter(is_deleted=False).exists():
            raise serializers.ValidationError({"parent": [
                f"“{inst.name}” has sub-categories, so it must stay top-level. "
                "Move or delete its sub-categories first."]})
        return attrs


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
        # `status` changes only via the publish/unpublish/archive/restore actions
        # (services.py) — a plain PATCH can't (B16: "save" never flips visibility).
        read_only_fields = ["status", "body_text", "view_count", "published_at"]


class ArticleTicketLinkSerializer(serializers.ModelSerializer):
    article_title = serializers.CharField(source="article.title", read_only=True)
    article_slug = serializers.CharField(source="article.slug", read_only=True)

    class Meta:
        model = ArticleTicketLink
        fields = ["id", "article", "article_title", "article_slug", "ticket", "link_type", "created_at"]
