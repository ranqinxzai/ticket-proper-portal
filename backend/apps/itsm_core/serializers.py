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

    def validate(self, attrs):
        # Return a clean 400 (not a raw IntegrityError) when the (project, key)
        # slot is already held by a LIVE field. `FieldDefinition.objects` is the
        # soft-delete manager, so a key freed by deleting its old field is reusable.
        key = attrs.get("key", getattr(self.instance, "key", None))
        project = attrs.get("project", getattr(self.instance, "project", None))
        if key:
            dupes = FieldDefinition.objects.filter(project=project, key=key)
            if self.instance is not None:
                dupes = dupes.exclude(pk=self.instance.pk)
            if dupes.exists():
                raise serializers.ValidationError(
                    {"key": "A field with this key already exists in this project."}
                )
        return attrs


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

    def validate_visibility_rule(self, value):
        """``null`` / ``{}`` clears the rule. Otherwise a condition field AND a
        non-empty value are required — an empty-value rule can never match the way
        the admin expects, so it's rejected rather than silently stored or dropped.
        The legacy ``{field, equals}`` shape is accepted and normalised."""
        if value in (None, {}, ""):
            return None
        if not isinstance(value, dict):
            raise serializers.ValidationError("Expected a rule object.")
        field = str(value.get("field") or "").strip()
        raw = value.get("value")
        if raw is None:
            raw = value.get("equals")
        val = "" if raw is None else str(raw).strip()
        if not field:
            raise serializers.ValidationError("Choose the field the condition checks.")
        if not val:
            raise serializers.ValidationError("Choose a value for the condition, or turn the rule off.")
        return {
            "action": "readonly" if value.get("action") == "readonly" else "show",
            "field": field,
            "operator": "neq" if value.get("operator") == "neq" else "eq",
            "value": val,
        }


class FieldLayoutSerializer(serializers.ModelSerializer):
    items = FieldLayoutItemSerializer(many=True, read_only=True)

    class Meta:
        model = FieldLayout
        fields = ["id", "project", "ticket_type", "name", "sections", "items"]

    def validate_sections(self, value):
        """Declared sections (incl. empty ones), in display order:
        ``[{region: "main"|"sidebar", name, collapsed?}]``. Names are trimmed, 1–80
        chars (the item ``section`` max_length); invalid entries and duplicates are
        rejected. ``collapsed`` (bool) = the section starts collapsed on the agent
        ticket page; it is kept only when true."""
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of sections.")
        out, seen = [], set()
        for entry in value:
            if not isinstance(entry, dict):
                raise serializers.ValidationError("Each section needs a region and a name.")
            region = entry.get("region")
            name = str(entry.get("name") or "").strip()
            if region not in ("main", "sidebar"):
                raise serializers.ValidationError("A section's region must be main or sidebar.")
            if not name:
                raise serializers.ValidationError("A section needs a name.")
            if len(name) > 80:
                raise serializers.ValidationError("Section names can be at most 80 characters.")
            collapsed = entry.get("collapsed", False)
            if not isinstance(collapsed, bool):
                raise serializers.ValidationError("A section's collapsed flag must be true or false.")
            if (region, name) in seen:
                continue
            seen.add((region, name))
            out.append({"region": region, "name": name, **({"collapsed": True} if collapsed else {})})
        return out
