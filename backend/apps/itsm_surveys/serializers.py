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

    def validate(self, attrs):
        """A comment can only be required while the comment box is shown (B6).
        Explicitly asking for required + no box is a 400; switching the box off
        clears "required" so the survey stays submittable."""
        inst = self.instance
        enabled = attrs.get("comment_enabled", getattr(inst, "comment_enabled", True))
        required = attrs.get("comment_required", getattr(inst, "comment_required", False))
        if required and not enabled:
            if attrs.get("comment_required") is True:
                raise serializers.ValidationError({
                    "comment_required": "A comment can only be required when "
                                        "“Ask for a comment” is on.",
                })
            attrs["comment_required"] = False
        return attrs
