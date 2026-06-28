from __future__ import annotations

from rest_framework import serializers

from .models import (
    EmailTemplate,
    InAppNotification,
    NotificationChannel,
    NotificationRule,
    NotificationScheme,
)
from .services.recipients import NAMED_SELECTOR_KEYS


class EmailTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailTemplate
        fields = ["id", "name", "event_type", "subject_template",
                  "body_html_template", "body_text_template", "is_system"]
        read_only_fields = ["is_system"]

    def validate_body_html_template(self, value):
        # Never trust client HTML — bleach it so the stored markup is safe to render
        # with dangerouslySetInnerHTML (the editor preview) and to email.
        from apps.itsm_core.services.html import sanitize_html
        return sanitize_html(value)


class NotificationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationRule
        fields = ["id", "scheme", "event_type", "recipients", "channels",
                  "email_template", "notify_actor", "is_active"]

    def validate_channels(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("channels must be a list.")
        valid = set(NotificationChannel.values)
        bad = [c for c in value if c not in valid]
        if bad:
            raise serializers.ValidationError(
                f"Unknown channel(s): {', '.join(map(str, bad))}."
            )
        return value

    def validate_recipients(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("recipients must be a list.")
        for sel in value:
            if isinstance(sel, dict):
                # Forward-compatible dict selectors ({"users": [...]} / {"role": "code"})
                # are allowed but not surfaced in the v1 UI.
                if not ({"users", "role"} & set(sel)):
                    raise serializers.ValidationError(
                        "Recipient objects must have a 'users' or 'role' key."
                    )
                continue
            if sel not in NAMED_SELECTOR_KEYS:
                raise serializers.ValidationError(f"Unknown recipient selector: {sel!r}.")
        return value


class NotificationSchemeSerializer(serializers.ModelSerializer):
    rules = NotificationRuleSerializer(many=True, read_only=True)

    class Meta:
        model = NotificationScheme
        fields = ["id", "name", "description", "project", "is_default", "rules"]


class InAppNotificationSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True, default=None)

    class Meta:
        model = InAppNotification
        fields = ["id", "event_type", "ticket", "ticket_number", "title", "body_text",
                  "link", "is_read", "read_at", "created_at"]
