from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from rest_framework import serializers

from .models import ApprovalAction, ApprovalRequest, ApprovalStage, ApprovalWorkflow
from .services import engine

# Which approver FK each type uses. Requestor's manager keeps `approver_user` as an
# optional FALLBACK approver (used when the requestor has no active manager).
_TARGET_FIELD = {
    "specific_user": "approver_user",
    "role": "approver_role",
    "group": "approver_group",
}
_MISSING_MSG = {
    "specific_user": "Pick the user who approves this stage.",
    "role": "Pick the role whose members approve this stage.",
    "group": "Pick the group whose members approve this stage.",
}
_SINGLE_APPROVER_TYPES = {"specific_user", "requestor_manager"}
_ON_FLY_POOLS = {"any_user", "group", "listed_users"}


def _name(user):
    if user is None:
        return None
    return (user.full_name or "").strip() or user.username


class ApprovalStageSerializer(serializers.ModelSerializer):
    # U7: show the person/role/group by name, not just the approver type.
    approver_user_name = serializers.SerializerMethodField()
    approver_role_name = serializers.CharField(source="approver_role.name", read_only=True, default=None)
    approver_group_name = serializers.CharField(source="approver_group.name", read_only=True, default=None)
    # Config-only health check (e.g. "has no approver — nobody active has the role …").
    approver_problem = serializers.SerializerMethodField()
    level = serializers.IntegerField(required=False, min_value=1)
    # On fly: the "Listed users" pool, by name for the editor.
    candidate_users_detail = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalStage
        fields = ["id", "workflow", "name", "level", "approver_type", "approver_user",
                  "approver_user_name", "approver_role", "approver_role_name",
                  "approver_group", "approver_group_name", "approver_problem",
                  "rule", "min_approvals", "on_fly_pool", "candidate_users",
                  "candidate_users_detail"]
        extra_kwargs = {"candidate_users": {"required": False}}
        # Live-level uniqueness is checked in validate() (DRF's auto validator for the
        # conditional UniqueConstraint would make `level` required).
        validators = []

    def get_approver_user_name(self, obj):
        return _name(obj.approver_user)

    def get_candidate_users_detail(self, obj):
        return [{"id": u.id, "name": _name(u), "is_active": u.is_active}
                for u in obj.candidate_users.all()]

    def get_approver_problem(self, obj):
        p = engine.stage_problem(obj)
        return (p[0].upper() + p[1:] + ".") if p else None

    def validate(self, attrs):
        """B1: a stage must name who approves it. Irrelevant approver FKs are cleared
        so a stale target can't linger behind a changed type."""
        inst = self.instance

        def cur(key):
            if key in attrs:
                return attrs[key]
            return getattr(inst, key) if inst is not None else None

        atype = cur("approver_type")
        errors = {}
        target = _TARGET_FIELD.get(atype)
        if target and cur(target) is None:
            errors[target] = [_MISSING_MSG[atype]]
        user = cur("approver_user")
        if user is not None and atype in ("specific_user", "requestor_manager") and not user.is_active:
            errors["approver_user"] = [f"{_name(user)}'s account is deactivated — pick an active user."]
        for key in ("approver_role", "approver_group"):
            obj = cur(key)
            if obj is not None and _TARGET_FIELD.get(atype) == key and (
                    getattr(obj, "is_deleted", False) or not getattr(obj, "is_active", True)):
                errors[key] = ["This one is inactive — pick an active one."]
        min_app = cur("min_approvals") or 1
        if min_app < 1:
            errors["min_approvals"] = ["Must be at least 1."]
        elif atype in _SINGLE_APPROVER_TYPES and min_app != 1 and (cur("rule") or "any") == "any":
            errors["min_approvals"] = ["Only one person can approve this stage, so it must be 1."]
        pool = cur("on_fly_pool") or ""
        if atype == "on_the_fly":
            errors.update(self._validate_on_fly(pool, cur, min_app))
        if errors:
            raise serializers.ValidationError(errors)

        # Normalise: keep only the FK this type uses.
        on_fly_group = atype == "on_the_fly" and pool == "group"
        for key in ("approver_user", "approver_role", "approver_group"):
            keep = (key == target or (key == "approver_user" and atype == "requestor_manager")
                    or (key == "approver_group" and on_fly_group))
            if not keep:
                attrs[key] = None
        if atype != "on_the_fly":
            attrs["on_fly_pool"] = ""
        if not (atype == "on_the_fly" and pool == "listed_users"):
            attrs["candidate_users"] = []

        workflow = cur("workflow")
        level = attrs.get("level")
        if workflow is not None and level is not None:
            clash = ApprovalStage.objects.filter(workflow=workflow, level=level)
            if inst is not None:
                clash = clash.exclude(pk=inst.pk)
            if clash.exists():
                raise serializers.ValidationError({"level": [f"Level {level} is already used by another stage."]})
        return attrs

    def _validate_on_fly(self, pool, cur, min_app) -> dict:
        """On fly: a pool the agent picks from, and a policy nothing starts on its own
        (a transition / catalog start has nobody to pick the approvers)."""
        errors = {}
        if pool not in _ON_FLY_POOLS:
            errors["on_fly_pool"] = ["Pick who the agent can choose approvers from."]
        elif pool == "group":
            group = cur("approver_group")
            if group is None:
                errors["approver_group"] = ["Pick the group the agent chooses approvers from."]
            elif getattr(group, "is_deleted", False) or not getattr(group, "is_active", True):
                errors["approver_group"] = ["This one is inactive — pick an active one."]
        elif pool == "listed_users":
            if "candidate_users" in self.initial_data or self.instance is None:
                people = list(cur("candidate_users") or [])
            else:
                people = list(self.instance.candidate_users.all())
            active = [u for u in people if u.is_active]
            if not active:
                errors["candidate_users"] = ["List at least one active person the agent can pick."]
            elif (cur("rule") or "any") == "any" and min_app > len(active):
                errors["min_approvals"] = [f"Only {len(active)} active people are listed, so it "
                                           f"can be at most {len(active)}."]
        workflow = cur("workflow")
        if workflow is not None:
            sites = engine.policy_start_sites(workflow)
            if sites:
                errors["approver_type"] = [
                    f"“{workflow.name}” is started automatically by {', '.join(sites)}, where "
                    "nobody can pick approvers. Put the On-fly stage in a separate approval "
                    "workflow that agents start with Send for approval."]
        return errors

    @transaction.atomic
    def create(self, validated_data):
        if validated_data.get("level") is None:
            # Next free live level, under a lock on the workflow row (rule 9).
            wf = ApprovalWorkflow.objects.select_for_update().get(pk=validated_data["workflow"].pk)
            top = ApprovalStage.objects.filter(workflow=wf).aggregate(m=Max("level"))["m"] or 0
            validated_data["level"] = top + 1
        return super().create(validated_data)


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    stages = ApprovalStageSerializer(many=True, read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default=None)

    class Meta:
        model = ApprovalWorkflow
        fields = ["id", "name", "description", "helpdesk", "project", "project_name",
                  "mode", "is_active", "pause_sla", "stages"]


class ApprovalActionSerializer(serializers.ModelSerializer):
    approver_name = serializers.SerializerMethodField()
    stage_name = serializers.CharField(source="stage.name", read_only=True, default=None)
    stage_level = serializers.IntegerField(source="stage.level", read_only=True, default=None)

    class Meta:
        model = ApprovalAction
        fields = ["id", "approval_request", "stage", "stage_name", "stage_level", "approver",
                  "approver_name", "decision", "comment", "created_at"]

    def get_approver_name(self, obj):
        return _name(obj.approver)


class ApprovalRequestSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True)
    ticket_summary = serializers.CharField(source="ticket.summary", read_only=True)
    # Deep-link parts for the agent route /agent/w/<helpdesk>/p/<project>/<number>.
    ticket_project_key = serializers.CharField(source="ticket.project.key", read_only=True, default=None)
    ticket_helpdesk_key = serializers.CharField(source="ticket.project.helpdesk.key", read_only=True,
                                                default=None)
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    current_stage_name = serializers.CharField(source="current_stage.name", read_only=True, default=None)
    current_stage_level = serializers.IntegerField(source="current_stage.level", read_only=True, default=None)
    actions = ApprovalActionSerializer(many=True, read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    return_status_name = serializers.CharField(source="return_status.name", read_only=True, default=None)
    waiting_status_name = serializers.CharField(source="waiting_status.name", read_only=True, default=None)

    class Meta:
        model = ApprovalRequest
        fields = ["id", "ticket", "ticket_number", "ticket_summary", "ticket_project_key",
                  "ticket_helpdesk_key", "workflow", "workflow_name", "mode",
                  "current_stage", "current_stage_name", "current_stage_level", "status",
                  "requested_by", "requested_by_name", "decided_at", "actions", "created_at",
                  "source", "note", "return_status_name", "waiting_status_name", "pause_sla"]
        read_only_fields = ["pause_sla"]

    def get_requested_by_name(self, obj):
        return _name(obj.requested_by)

    def to_representation(self, instance):
        from .services import send

        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        # U2: pending_stages (who it waits for), can_decide, blocked_reason.
        data.update(engine.request_state(instance, user))
        data["can_withdraw"] = send.can_withdraw(instance, user)
        return data
