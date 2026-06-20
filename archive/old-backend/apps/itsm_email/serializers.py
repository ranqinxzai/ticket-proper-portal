from __future__ import annotations

from rest_framework import serializers

from .models import EmailChannel, EmailRule, InboundEmail


class EmailChannelSerializer(serializers.ModelSerializer):
    """Secrets are write‑only; reads expose only booleans (has_password / oauth_authorized)."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=True, source="password_enc")
    has_password = serializers.SerializerMethodField()
    effective_domain = serializers.CharField(read_only=True)
    is_oauth = serializers.BooleanField(read_only=True)

    class Meta:
        model = EmailChannel
        fields = [
            "id", "name", "project", "address", "domain", "effective_domain", "is_active",
            "protocol", "host", "port", "use_ssl", "username", "folder",
            "auth_method", "is_oauth", "oauth_authorized",
            "password", "has_password",
            "create_users", "default_requestor", "default_priority", "default_group",
            "strip_quotes", "cc_watchers", "reopen_policy", "reopen_window_days",
            "ignore_auto_replies", "max_age_days", "max_size_bytes",
            "loop_window_min", "loop_max_messages", "poll_interval_seconds",
            "last_polled_at", "last_seen_uid", "last_error", "created_at",
        ]
        read_only_fields = [
            "oauth_authorized", "last_polled_at", "last_seen_uid", "last_error", "created_at",
        ]

    def get_has_password(self, obj) -> bool:
        return bool(obj.password_enc)


class EmailRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailRule
        fields = ["id", "channel", "rule_type", "pattern", "is_active", "note", "created_at"]


class InboundEmailListSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True, default=None)

    class Meta:
        model = InboundEmail
        fields = [
            "id", "channel", "from_addr", "from_name", "subject", "status",
            "ignore_reason", "action_taken", "ticket", "ticket_number",
            "attempts", "created_at", "processed_at",
        ]


class InboundEmailDetailSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True, default=None)

    class Meta:
        model = InboundEmail
        fields = [
            "id", "channel", "message_id", "in_reply_to", "references",
            "from_addr", "from_name", "to_addrs", "cc_addrs", "subject",
            "date_header", "size_bytes", "headers", "body_text",
            "status", "ignore_reason", "action_taken",
            "ticket", "ticket_number", "comment", "requestor",
            "attempts", "last_error", "next_attempt_at", "processed_at", "created_at",
        ]
