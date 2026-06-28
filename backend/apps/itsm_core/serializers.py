from __future__ import annotations

from rest_framework import serializers

from .models import FieldDefinition, FieldLayout, FieldLayoutItem, FieldOption


class FieldOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldOption
        fields = ["id", "field", "parent", "level", "value", "label", "color",
                  "sort_order", "is_active"]


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
                  "sort_order", "is_hidden", "portal_visible", "is_mandatory", "section",
                  "region", "width", "visibility_rule"]

    def validate(self, attrs):
        from apps.itsm_core.models.fields import FORCE_MAIN_FULL_TYPES
        field = attrs.get("field") or getattr(self.instance, "field", None)
        region = attrs.get("region", getattr(self.instance, "region", "main"))
        width = attrs.get("width", getattr(self.instance, "width", "full"))
        # Rich text is always full width in the main column.
        if getattr(field, "field_type", None) in FORCE_MAIN_FULL_TYPES:
            region, width = "main", "full"
        # Half width is only meaningful in the main column.
        if region == "sidebar":
            width = "full"
        attrs["region"], attrs["width"] = region, width
        return attrs


class FieldLayoutSerializer(serializers.ModelSerializer):
    items = FieldLayoutItemSerializer(many=True, read_only=True)

    class Meta:
        model = FieldLayout
        fields = ["id", "project", "ticket_type", "name", "items"]
