from __future__ import annotations

from rest_framework import serializers

from .models import FieldDefinition, FieldLayout, FieldLayoutItem, FieldOption


class FieldOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldOption
        fields = ["id", "field", "value", "label", "color", "sort_order", "is_active"]


class FieldDefinitionSerializer(serializers.ModelSerializer):
    options = FieldOptionSerializer(many=True, read_only=True)

    class Meta:
        model = FieldDefinition
        fields = ["id", "project", "key", "name", "description", "field_type",
                  "is_system", "is_multi", "config", "default_json", "options"]


class FieldLayoutItemSerializer(serializers.ModelSerializer):
    field_key = serializers.CharField(source="field.key", read_only=True)
    field_name = serializers.CharField(source="field.name", read_only=True)
    field_type = serializers.CharField(source="field.field_type", read_only=True)

    class Meta:
        model = FieldLayoutItem
        fields = ["id", "layout", "field", "field_key", "field_name", "field_type",
                  "sort_order", "is_hidden", "is_mandatory", "section", "visibility_rule"]


class FieldLayoutSerializer(serializers.ModelSerializer):
    items = FieldLayoutItemSerializer(many=True, read_only=True)

    class Meta:
        model = FieldLayout
        fields = ["id", "project", "ticket_type", "name", "items"]
