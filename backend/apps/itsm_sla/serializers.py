from __future__ import annotations

from rest_framework import serializers

from .models import (
    BusinessCalendar,
    BusinessHours,
    EscalationRule,
    Holiday,
    SLAMetric,
    SLAPolicy,
    SLATarget,
    SLATracker,
)
from .services import sla_engine


class BusinessHoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessHours
        fields = ["id", "calendar", "weekday", "start_time", "end_time"]

    def validate(self, attrs):
        # On PATCH, fall back to the instance values for any field not supplied.
        start = attrs.get("start_time") or getattr(self.instance, "start_time", None)
        end = attrs.get("end_time") or getattr(self.instance, "end_time", None)
        if start and end and end <= start:
            raise serializers.ValidationError({"end_time": "end_time must be after start_time."})
        return attrs


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "calendar", "date", "name", "recurring_annually"]


class BusinessCalendarSerializer(serializers.ModelSerializer):
    hours = BusinessHoursSerializer(many=True, read_only=True)
    holidays = HolidaySerializer(many=True, read_only=True)

    class Meta:
        model = BusinessCalendar
        fields = ["id", "name", "timezone", "is_default", "hours", "holidays"]


class SLATargetSerializer(serializers.ModelSerializer):
    class Meta:
        model = SLATarget
        fields = ["id", "metric", "priority", "target_minutes"]


class EscalationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = EscalationRule
        fields = ["id", "metric", "threshold_pct", "action", "config"]


class SLAMetricSerializer(serializers.ModelSerializer):
    targets = SLATargetSerializer(many=True, read_only=True)
    escalations = EscalationRuleSerializer(many=True, read_only=True)

    class Meta:
        model = SLAMetric
        fields = ["id", "policy", "kind", "name", "pause_statuses", "targets", "escalations"]


class SLAPolicySerializer(serializers.ModelSerializer):
    metrics = SLAMetricSerializer(many=True, read_only=True)

    class Meta:
        model = SLAPolicy
        fields = ["id", "name", "description", "project", "calendar", "is_default",
                  "is_active", "applies_to", "metrics"]


class SLATrackerSerializer(serializers.ModelSerializer):
    countdown = serializers.SerializerMethodField()

    class Meta:
        model = SLATracker
        fields = ["id", "ticket", "metric", "state", "due_at", "breached", "countdown"]

    def get_countdown(self, obj):
        return sla_engine.countdown_payload(obj)
