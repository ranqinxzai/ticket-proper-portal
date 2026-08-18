from __future__ import annotations

from rest_framework import serializers

from .models import (
    AutoAssignmentRule,
    ReopenRule,
    Status,
    StatusCategory,
    Transition,
    TransitionCondition,
    TransitionScreen,
    TransitionScreenField,
    Workflow,
)


class StatusCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = StatusCategory
        fields = ["id", "key", "name", "color", "sort_order"]


class StatusSerializer(serializers.ModelSerializer):
    category_key = serializers.CharField(source="category.key", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = Status
        fields = ["id", "workflow", "name", "key", "category", "category_key", "category_name",
                  "color", "sort_order", "is_initial", "pauses_sla", "canvas_x", "canvas_y"]


class TransitionConditionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransitionCondition
        fields = ["id", "transition", "condition_type", "config", "negate"]


class ScreenFieldWriteSerializer(serializers.Serializer):
    """One row of a transition's capture screen: a field key + whether it's mandatory.
    Write shape for `TransitionSerializer.screen_fields`; read is injected in
    `to_representation` as the same shape."""

    field_key = serializers.CharField(max_length=80)
    is_mandatory = serializers.BooleanField(required=False, default=True)
    sort_order = serializers.IntegerField(required=False, default=0)


class TransitionSerializer(serializers.ModelSerializer):
    from_status_key = serializers.CharField(source="from_status.key", read_only=True, default=None)
    to_status_key = serializers.CharField(source="to_status.key", read_only=True)
    conditions = TransitionConditionSerializer(many=True, read_only=True)
    # Write-only convenience: toggles an `approval_granted` gate condition on this
    # transition. There is no transition-conditions endpoint and `conditions` is
    # read-only, so this is the API write path. The client derives the *displayed*
    # state from the `conditions` array, so no read field is needed.
    requires_approval = serializers.BooleanField(required=False, write_only=True)
    # Admin-configurable capture fields shown when this transition runs (e.g. Resolve
    # → Root cause / Resolution type). Write here syncs the transition's
    # `TransitionScreen` + `TransitionScreenField` rows (see `_sync_screen`); the read
    # value is injected in `to_representation`. The config UI joins each `field_key`
    # against the project field catalog it already loads for display names/types; the
    # ticket runtime resolves them via `available-transitions` `screen_fields`.
    screen_fields = ScreenFieldWriteSerializer(many=True, required=False, write_only=True)

    # JIRA-style "block with a custom message" validators, stored as a plain writable JSON
    # column on the transition (exactly like `post_functions` — no `_sync`, no create/update
    # handling). Each item is {field_key, operator, value?, message}; the engine enforces
    # them (services/engine.py::_check_field_conditions) while keeping the button visible.
    _FIELD_CONDITION_OPERATORS = {"is_not_empty", "is_empty", "equals", "not_equals"}
    _FIELD_CONDITION_VALUE_OPS = {"equals", "not_equals"}

    class Meta:
        model = Transition
        fields = ["id", "workflow", "name", "from_status", "from_status_key",
                  "to_status", "to_status_key", "is_global", "sort_order",
                  "post_functions", "auto_assign_rule", "screen", "conditions",
                  "note_prompt", "note_required", "note_heading", "note_visibility",
                  "portal_allowed", "requires_approval", "screen_fields", "field_conditions"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        rows = []
        if instance.screen_id:
            rows = [{"field_key": f.field_key, "is_mandatory": f.is_mandatory,
                     "sort_order": f.sort_order}
                    for f in instance.screen.fields.all()]
        data["screen_fields"] = rows
        return data

    def validate_screen_fields(self, rows):
        """Reject a field_key that doesn't resolve to a live FieldDefinition (typo
        guard). Fields are project- or global-scoped; a workflow may serve several
        projects, so existence anywhere in the catalog is the check."""
        from apps.itsm_core.models import FieldDefinition

        keys = [r["field_key"] for r in rows]
        if keys:
            known = set(FieldDefinition.objects.filter(
                key__in=keys, is_deleted=False).values_list("key", flat=True))
            unknown = [k for k in keys if k not in known]
            if unknown:
                raise serializers.ValidationError(
                    f"Unknown field(s): {', '.join(sorted(set(unknown)))}.")
        return rows

    def validate_field_conditions(self, value):
        """Normalize + validate block-with-message rules (fail-closed on write; the engine
        is fail-open on read). Each rule references a live FieldDefinition, uses a known
        operator, carries a value for equals/not_equals, and targets a value-bearing field
        (attachment/value-less types can never be non-empty)."""
        from apps.itsm_core.models import FieldDefinition
        from apps.itsm_core.models.fields import NO_VALUE_TYPES

        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of field conditions.")
        cleaned, keys = [], []
        for i, raw in enumerate(value):
            if not isinstance(raw, dict):
                raise serializers.ValidationError(f"Condition #{i + 1} must be an object.")
            key = (raw.get("field_key") or "").strip()
            op = raw.get("operator")
            if not key:
                raise serializers.ValidationError(f"Condition #{i + 1}: field_key is required.")
            if op not in self._FIELD_CONDITION_OPERATORS:
                raise serializers.ValidationError(
                    f"Condition #{i + 1}: operator must be one of "
                    f"{', '.join(sorted(self._FIELD_CONDITION_OPERATORS))}.")
            item = {"field_key": key, "operator": op, "message": (raw.get("message") or "").strip()}
            if op in self._FIELD_CONDITION_VALUE_OPS:
                if raw.get("value") in (None, ""):
                    raise serializers.ValidationError(
                        f"Condition #{i + 1}: a value is required for '{op}'.")
                item["value"] = raw["value"]
            cleaned.append(item)
            keys.append(key)
        if keys:
            live = list(FieldDefinition.objects.filter(key__in=keys, is_deleted=False))
            known = {fd.key for fd in live}
            unknown = [k for k in keys if k not in known]
            if unknown:
                raise serializers.ValidationError(
                    f"Unknown field(s): {', '.join(sorted(set(unknown)))}.")
            unsupported = sorted({fd.key for fd in live if fd.field_type in NO_VALUE_TYPES})
            if unsupported:
                raise serializers.ValidationError(
                    f"Field(s) not supported as a condition: {', '.join(unsupported)}.")
        return cleaned

    def _sync_screen(self, transition, rows):
        """Create/replace the transition's capture screen to match `rows`. Empty ⇒
        detach (and soft-delete a screen no other transition uses). Idempotent."""
        if not rows:
            screen = transition.screen
            if screen is not None:
                still_used = screen.transitions.exclude(pk=transition.pk).exists()
                transition.screen = None
                transition.save(update_fields=["screen", "updated_at"])
                if not still_used:
                    screen.fields.all().delete()
                    screen.soft_delete()
            return

        screen = transition.screen
        if screen is None:
            screen = TransitionScreen.objects.create(
                workflow=transition.workflow, name=f"{transition.name} fields")
            transition.screen = screen
            transition.save(update_fields=["screen", "updated_at"])

        desired = {}
        for i, row in enumerate(rows):
            desired[row["field_key"]] = {
                "is_mandatory": row.get("is_mandatory", True),
                "sort_order": row.get("sort_order", i),
            }
        existing = {f.field_key: f for f in screen.fields.all()}
        for key, f in existing.items():
            if key not in desired:
                f.delete()
        for key, spec in desired.items():
            f = existing.get(key)
            if f is None:
                TransitionScreenField.objects.create(
                    screen=screen, field_key=key,
                    is_mandatory=spec["is_mandatory"], sort_order=spec["sort_order"])
            elif (f.is_mandatory, f.sort_order) != (spec["is_mandatory"], spec["sort_order"]):
                f.is_mandatory = spec["is_mandatory"]
                f.sort_order = spec["sort_order"]
                f.save(update_fields=["is_mandatory", "sort_order", "updated_at"])

    def _sync_approval_gate(self, transition, requires):
        """Create or remove the `approval_granted` condition to mirror `requires`.
        Idempotent — same keying as itsm_approvals/seed.py."""
        qs = transition.conditions.filter(condition_type="approval_granted")
        if requires and not qs.exists():
            TransitionCondition.objects.create(
                transition=transition, condition_type="approval_granted",
                config={}, negate=False,
            )
        elif not requires:
            qs.delete()

    def create(self, validated_data):
        requires = validated_data.pop("requires_approval", None)
        screen_fields = validated_data.pop("screen_fields", None)
        instance = super().create(validated_data)
        if requires:
            self._sync_approval_gate(instance, requires)
        if screen_fields is not None:
            self._sync_screen(instance, screen_fields)
        return instance

    def update(self, instance, validated_data):
        requires = validated_data.pop("requires_approval", None)
        screen_fields = validated_data.pop("screen_fields", None)
        instance = super().update(instance, validated_data)
        if requires is not None:
            self._sync_approval_gate(instance, requires)
        if screen_fields is not None:
            self._sync_screen(instance, screen_fields)
        return instance


class WorkflowSerializer(serializers.ModelSerializer):
    status_count = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "base_type", "is_default", "is_active",
                  "version", "status_count", "created_at"]

    def get_status_count(self, obj):
        return obj.statuses.count()


class WorkflowGraphSerializer(serializers.ModelSerializer):
    statuses = StatusSerializer(many=True, read_only=True)
    transitions = TransitionSerializer(many=True, read_only=True)

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "base_type", "is_active", "version",
                  "statuses", "transitions"]


class AutoAssignmentRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutoAssignmentRule
        fields = ["id", "name", "strategy", "target_group", "fixed_user", "config"]


class ReopenRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReopenRule
        fields = ["id", "workflow", "reopen_to_status", "window_days", "requires_comment"]


class TransitionScreenSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransitionScreen
        fields = ["id", "workflow", "name"]
