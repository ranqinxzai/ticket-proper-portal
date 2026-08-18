from __future__ import annotations

from rest_framework import serializers

from .models import SCALES, SurveyConfig


class SurveyConfigSerializer(serializers.ModelSerializer):
    """Config for the Survey settings tab (Supervisor-only). ``project``/``is_default``
    are set at provisioning time and never edited through the API."""

    project_key = serializers.CharField(source="project.key", read_only=True, default=None)

    class Meta:
        model = SurveyConfig
        fields = [
            "id", "project", "project_key", "is_default", "enabled", "trigger",
            "scale_type", "question_text", "intro_text", "scale_labels",
            "comment_enabled", "comment_prompt", "comment_required", "thank_you_text",
            "email_subject", "email_body_html", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "project", "project_key", "is_default",
                            "created_at", "updated_at"]

    def validate_scale_labels(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("scale_labels must be a list of strings.")
        return [str(v) for v in value]

    def validate_scale_type(self, value):
        if value not in SCALES:
            raise serializers.ValidationError("Unknown scale type.")
        return value
