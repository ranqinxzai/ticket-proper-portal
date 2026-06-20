from __future__ import annotations

from rest_framework import serializers

from .models import Dashboard, SavedFilter, Widget


class SavedFilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedFilter
        fields = ["id", "name", "owner", "is_shared", "query_spec", "created_at"]
        read_only_fields = ["owner"]


class WidgetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Widget
        fields = ["id", "dashboard", "widget_type", "title", "saved_filter",
                  "config", "sort_order", "position"]


class DashboardSerializer(serializers.ModelSerializer):
    widgets = WidgetSerializer(many=True, read_only=True)

    class Meta:
        model = Dashboard
        fields = ["id", "name", "owner", "is_shared", "layout", "widgets", "created_at"]
        read_only_fields = ["owner"]
