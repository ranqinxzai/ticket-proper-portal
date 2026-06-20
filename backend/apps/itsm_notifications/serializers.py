from __future__ import annotations

from rest_framework import serializers

from .models import (
    EmailTemplate,
    InAppNotification,
    NotificationRule,
    NotificationScheme,
)


class EmailTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailTemplate
        fields = ["id", "name", "event_type", "subject_template",
                  "body_html_template", "body_text_template", "is_system"]


class NotificationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationRule
        fields = ["id", "scheme", "event_type", "recipients", "channels",
                  "email_template", "notify_actor", "is_active"]


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
