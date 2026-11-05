from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
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
    approval_waiting_status_name = serializers.CharField(
        source="approval_waiting_status.name", read_only=True, default=None)

    class Meta:
        model = Status
        fields = ["id", "workflow", "name", "key", "category", "category_key", "category_name",
                  "color", "sort_order", "is_initial", "pauses_sla",
                  "allows_send_for_approval", "approval_waiting_status",
                  "approval_waiting_status_name", "canvas_x", "canvas_y"]

    def validate(self, attrs):
        """Send for approval (2026-10-24): never from a Done status, and the waiting
        status is another live, non-Done status of the same workflow."""
        attrs = super().validate(attrs)
        inst = self.instance

        def cur(key):
            if key in attrs:
                return attrs[key]
            return getattr(inst, key) if inst is not None else None

        category = cur("category")
        allows = bool(cur("allows_send_for_approval"))
        waiting = cur("approval_waiting_status")
        if allows and category is not None and category.key == "done":
            raise serializers.ValidationError(
                {"allows_send_for_approval": ["A Done status can't be sent for approval."]})
        if waiting is not None and "approval_waiting_status" in attrs:
            workflow = cur("workflow")
            if inst is not None and waiting.id == inst.id:
                msg = "Pick another status to wait in, or let the ticket stay here."
            elif waiting.is_deleted:
                msg = "That status was deleted."
            elif workflow is not None and waiting.workflow_id != workflow.id:
                msg = "Pick a status of this workflow."
            elif waiting.category.key == "done":
                msg = "A ticket can't wait for approval in a Done status."
            else:
                msg = None
            if msg:
                raise serializers.ValidationError({"approval_waiting_status": [msg]})
        if not allows:
            attrs["approval_waiting_status"] = None
        return attrs


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
    # U4: real display names (the ticket buttons/tooltips used to humanise the key).
    from_status_name = serializers.CharField(source="from_status.name", read_only=True, default=None)
    to_status_name = serializers.CharField(source="to_status.name", read_only=True)
    to_status_category = serializers.CharField(source="to_status.category.key", read_only=True)
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
        fields = ["id", "workflow", "name", "from_status", "from_status_key", "from_status_name",
                  "to_status", "to_status_key", "to_status_name", "to_status_category",
                  "is_global", "sort_order",
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

    def validate(self, attrs):
        """B14: a workflow has ONE create transition (from_status none, not global),
        and it can't lead to a Done status. A from_status-less GLOBAL transition is
        "available from any status" and is always allowed."""
        attrs = super().validate(attrs)
        inst = self.instance

        def pick(key, default=None):
            if key in attrs:
                return attrs[key]
            return getattr(inst, key, default) if inst is not None else default

        workflow = pick("workflow")
        from_status = pick("from_status")
        to_status = pick("to_status")
        is_global = bool(pick("is_global", False))
        for st in (from_status, to_status):
            if st is not None and workflow is not None and st.workflow_id != workflow.id:
                raise serializers.ValidationError("Statuses must belong to this workflow.")
        # Only re-check when this write makes/keeps it a create transition — a PATCH of
        # unrelated settings on a legacy duplicate must still save.
        establishing = inst is None or bool({"from_status", "is_global", "to_status"} & set(attrs))
        if establishing and from_status is None and not is_global and workflow is not None:
            others = Transition.objects.filter(
                workflow=workflow, from_status__isnull=True, is_global=False)
            if inst is not None:
                others = others.exclude(pk=inst.pk)
            first = others.first()
            if first is not None:
                raise serializers.ValidationError(
                    {"from_status": f"This workflow already has a create transition (“{first.name}”). "
                                    "Pick a From status, or “Any status” for a global transition."})
            if to_status is not None and to_status.category.key == "done":
                raise serializers.ValidationError(
                    {"to_status": "The create transition can't lead to a Done status."})
        return attrs

    def validate_post_functions(self, value):
        """A `request_approval` can't name a policy with an On-fly stage: nobody picks
        its approvers on a transition (Send for approval does)."""
        try:
            from apps.itsm_approvals.services.engine import has_on_fly_stage
        except ImportError:  # pragma: no cover
            return value
        for pf in value or []:
            if not isinstance(pf, dict) or pf.get("type") != "request_approval":
                continue
            wid = (pf.get("config") or {}).get("workflow_id")
            try:
                on_fly = bool(wid) and has_on_fly_stage(wid)
            except (ValueError, DjangoValidationError):
                on_fly = False
            if on_fly:
                raise serializers.ValidationError(
                    "This approval workflow has an On-fly stage, so a transition can't start "
                    "it: agents start it with Send for approval.")
        return value

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
    transitions = serializers.SerializerMethodField()

    def get_transitions(self, obj):
        qs = (obj.transitions.select_related("from_status", "to_status__category")
              .prefetch_related("conditions", "screen__fields"))
        return TransitionSerializer(qs, many=True).data

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "base_type", "is_default", "is_active",
                  "version", "statuses", "transitions"]


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
