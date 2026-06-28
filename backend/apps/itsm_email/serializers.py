from __future__ import annotations

from rest_framework import serializers

from .models import EmailChannel, EmailRule, InboundEmail


class EmailChannelSerializer(serializers.ModelSerializer):
    """Secrets are write‑only; reads expose only booleans (has_password / oauth_authorized)."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=True, source="password_enc")
    has_password = serializers.SerializerMethodField()
    smtp_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, source="smtp_password_enc"
    )
    has_smtp_password = serializers.SerializerMethodField()
    # Per-org OAuth app: client id/tenant are readable; the secret is write-only.
    oauth_client_secret = serializers.CharField(
        write_only=True, required=False, allow_blank=True, source="oauth_client_secret_enc"
    )
    has_oauth_client_secret = serializers.SerializerMethodField()
    effective_domain = serializers.CharField(read_only=True)
    is_oauth = serializers.BooleanField(read_only=True)
    field_mappings = serializers.SerializerMethodField()

    class Meta:
        model = EmailChannel
        fields = [
            "id", "name", "project", "address", "domain", "effective_domain", "is_active",
            "protocol", "host", "port", "use_ssl", "username", "folder",
            "auth_method", "is_oauth", "oauth_authorized",
            "oauth_client_id", "oauth_tenant_id", "oauth_client_secret", "has_oauth_client_secret",
            "password", "has_password",
            # outbound SMTP
            "outbound_enabled", "smtp_host", "smtp_port", "smtp_security", "smtp_username",
            "smtp_password", "has_smtp_password", "smtp_from_name",
            # mappings
            "create_users", "default_requestor", "default_priority", "priority_map",
            "default_group", "max_attachment_bytes", "field_mappings",
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

    def get_has_smtp_password(self, obj) -> bool:
        return bool(obj.smtp_password_enc)

    def get_has_oauth_client_secret(self, obj) -> bool:
        return bool(obj.oauth_client_secret_enc)

    def get_field_mappings(self, obj) -> dict:
        """The full email→ticket mapping, surfaced so the config UI can show it all."""
        return {
            "subject": {"label": "Email Subject", "target": "Ticket Summary", "editable": False},
            "body": {"label": "Email Body", "target": "Ticket Description", "editable": False},
            "sender": {
                "label": "Sender (From)", "target": "Requestor", "editable": True,
                "create_if_missing": obj.create_users, "default_requestor": obj.default_requestor_id,
            },
            "cc": {"label": "CC recipients", "target": "Watchers", "editable": True,
                   "enabled": obj.cc_watchers},
            "attachments": {"label": "Attachments", "target": "Attachments", "editable": True,
                            "max_attachment_bytes": obj.max_attachment_bytes},
            "priority": {"label": "Email Priority", "target": "Ticket Priority", "editable": True,
                         "map": obj.priority_map, "default": obj.default_priority},
        }


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
