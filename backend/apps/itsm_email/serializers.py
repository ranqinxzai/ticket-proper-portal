from __future__ import annotations

from rest_framework import serializers

from .models import (
    EmailChannel,
    EmailRoutingRule,
    EmailRule,
    HelpdeskEmailTransport,
    InboundEmail,
)


class EmailRoutingRuleSerializer(serializers.ModelSerializer):
    """A keyword → project rule for a shared mailbox. Project-only (group/priority stay
    mailbox-level). ``target_project`` is constrained to the channel's helpdesk."""

    target_project_name = serializers.CharField(source="target_project.name", read_only=True)

    class Meta:
        model = EmailRoutingRule
        fields = [
            "id", "channel", "order", "name", "match_in", "match_type", "keywords",
            "target_project", "target_project_name", "is_active", "created_at",
        ]

    def validate_keywords(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Keywords must be a list of words/phrases.")
        cleaned = [str(k).strip() for k in value if str(k).strip()]
        if not cleaned:
            raise serializers.ValidationError("Add at least one keyword for the rule to match.")
        # de-dupe (case-insensitively) while preserving order
        seen, out = set(), []
        for kw in cleaned:
            low = kw.lower()
            if low not in seen:
                seen.add(low)
                out.append(kw)
        return out

    def validate(self, attrs):
        # PATCH-safe: fall back to the stored instance for a side not in the payload.
        channel = attrs.get("channel") or getattr(self.instance, "channel", None)
        target = attrs.get("target_project") or getattr(self.instance, "target_project", None)
        if channel is not None and target is not None:
            if target.is_deleted:
                raise serializers.ValidationError(
                    {"target_project": "That project no longer exists."})
            if target.helpdesk_id != channel.project.helpdesk_id:
                raise serializers.ValidationError(
                    {"target_project": "The target project must belong to the mailbox's helpdesk."})
            # A rule can only route to a project the mailbox is allowed to serve.
            from .services import routing
            if target.id not in {p.id for p in routing.allowed_projects(channel)}:
                raise serializers.ValidationError({"target_project":
                    "This project isn't in the mailbox's allowed projects — add it there first."})
        return attrs


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
    # Multi-project routing. `allowed_projects` is the WHITELIST — the only projects this
    # mailbox may create/serve tickets in; `project` above is the *default* (fallback) and
    # must be one of them; `routing_rules` route matching mail among them by keyword.
    # `allowed_projects` is read+write: written as a list of project ids (synced to the
    # EmailChannelProject join in create/update); read is injected in `to_representation`.
    routing_rules = EmailRoutingRuleSerializer(many=True, read_only=True)
    allowed_projects = serializers.ListField(
        child=serializers.UUIDField(), required=False, write_only=True,
    )

    class Meta:
        model = EmailChannel
        fields = [
            "id", "name", "project", "routing_rules", "allowed_projects",
            "address", "domain", "effective_domain", "is_active",
            "protocol", "host", "port", "use_ssl", "username", "folder",
            "auth_method", "is_oauth", "oauth_authorized",
            "oauth_client_id", "oauth_tenant_id", "oauth_client_secret", "has_oauth_client_secret",
            "password", "has_password",
            # outbound SMTP
            "outbound_enabled", "smtp_host", "smtp_port", "smtp_security", "smtp_username",
            "smtp_password", "has_smtp_password", "smtp_from_name",
            # auto-detected send capability (read-only; set by the probe / self-heal)
            "outbound_send_verified", "outbound_verified_at", "outbound_verify_error",
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
            "outbound_send_verified", "outbound_verified_at", "outbound_verify_error",
        ]

    def get_has_password(self, obj) -> bool:
        return bool(obj.password_enc)

    def get_has_smtp_password(self, obj) -> bool:
        return bool(obj.smtp_password_enc)

    def get_has_oauth_client_secret(self, obj) -> bool:
        return bool(obj.oauth_client_secret_enc)

    def to_representation(self, instance):
        """Inject the read-side `allowed_projects` (the write field is write-only).

        Reads from the prefetched `allowed_project_links`; falls back to the single default
        project for a legacy channel that predates the whitelist / its backfill.
        """
        data = super().to_representation(instance)
        ids = [str(link.project_id) for link in instance.allowed_project_links.all()]
        if not ids and instance.project_id:
            ids = [str(instance.project_id)]
        data["allowed_projects"] = ids
        return data

    def validate(self, attrs):
        """Enforce the whitelist invariants: a non-empty set, all in the mailbox's helpdesk,
        the default `project` among them, and no active rule stranded by shrinking the set."""
        from apps.itsm_projects.models import Project

        instance = self.instance
        project = attrs.get("project") or getattr(instance, "project", None)
        raw = attrs.get("allowed_projects", None)

        if raw is None:
            if instance is None:  # create without an explicit whitelist ⇒ just the default
                attrs["allowed_projects"] = [str(project.id)] if project else []
            return attrs  # (PATCH not touching the whitelist ⇒ leave it as-is)

        ids = [str(x) for x in raw]
        if not ids:
            raise serializers.ValidationError({"allowed_projects": "Select at least one project."})
        projects = list(Project.objects.filter(id__in=ids, is_deleted=False))
        if len(projects) != len(set(ids)):
            raise serializers.ValidationError(
                {"allowed_projects": "One or more selected projects don't exist."})
        hd_id = project.helpdesk_id if project else None
        if hd_id is not None and any(p.helpdesk_id != hd_id for p in projects):
            raise serializers.ValidationError(
                {"allowed_projects": "All allowed projects must belong to the mailbox's helpdesk."})
        allowed = {str(p.id) for p in projects}
        if project is not None and str(project.id) not in allowed:
            raise serializers.ValidationError(
                {"project": "The default project must be one of the allowed projects."})
        if instance is not None:
            stray = [r.target_project_id for r in
                     instance.routing_rules.filter(is_active=True, is_deleted=False)
                     if str(r.target_project_id) not in allowed]
            if stray:
                raise serializers.ValidationError({"allowed_projects":
                    "Remove or retarget the routing rules pointing at a project you're excluding first."})
        attrs["allowed_projects"] = ids
        return attrs

    def create(self, validated_data):
        allowed = validated_data.pop("allowed_projects", None)
        channel = super().create(validated_data)
        self._sync_allowed(channel, allowed)
        return channel

    def update(self, instance, validated_data):
        allowed = validated_data.pop("allowed_projects", None)
        channel = super().update(instance, validated_data)
        if allowed is not None:
            self._sync_allowed(channel, allowed)
        return channel

    @staticmethod
    def _sync_allowed(channel, allowed_ids):
        """Reconcile the EmailChannelProject whitelist rows to `allowed_ids`.

        `all_objects.update_or_create` revives a previously soft-deleted link (the
        `(channel, project)` unique constraint spans soft-deleted rows); excluded links are
        soft-deleted. A `None`/empty set defaults to the channel's own fallback project so a
        mailbox always has at least itself allowed.
        """
        from .models import EmailChannelProject

        want = {str(x) for x in (allowed_ids or [])}
        if not want and channel.project_id:
            want = {str(channel.project_id)}
        for pid in want:
            EmailChannelProject.all_objects.update_or_create(
                channel=channel, project_id=pid,
                defaults={"is_deleted": False, "deleted_at": None, "deleted_by": None},
            )
        channel.allowed_project_links.exclude(project_id__in=want).update(is_deleted=True)

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


class HelpdeskEmailTransportSerializer(serializers.ModelSerializer):
    """Per-helpdesk outbound notification transport. Secrets are write-only; reads
    expose only ``has_*`` booleans + ``oauth_authorized``. Send capability
    (``send_verified``) is server-managed by the probe/self-heal, never client-set."""

    smtp_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, source="smtp_password_enc"
    )
    has_smtp_password = serializers.SerializerMethodField()
    oauth_client_secret = serializers.CharField(
        write_only=True, required=False, allow_blank=True, source="oauth_client_secret_enc"
    )
    has_oauth_client_secret = serializers.SerializerMethodField()
    is_oauth = serializers.BooleanField(read_only=True)

    class Meta:
        model = HelpdeskEmailTransport
        fields = [
            "id", "helpdesk", "mode",
            "address", "smtp_from_name",
            "auth_method", "is_oauth", "outbound_enabled",
            "smtp_host", "smtp_port", "smtp_security", "smtp_username",
            "smtp_password", "has_smtp_password",
            "oauth_client_id", "oauth_tenant_id",
            "oauth_client_secret", "has_oauth_client_secret", "oauth_authorized",
            "send_verified", "verified_at", "verify_error",
            "created_at",
        ]
        read_only_fields = [
            "oauth_authorized", "send_verified", "verified_at", "verify_error", "created_at",
        ]

    def get_has_smtp_password(self, obj) -> bool:
        return bool(obj.smtp_password_enc)

    def get_has_oauth_client_secret(self, obj) -> bool:
        return bool(obj.oauth_client_secret_enc)


class EmailRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailRule
        fields = ["id", "channel", "rule_type", "pattern", "is_active", "note", "created_at"]


class InboundEmailListSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True, default=None)
    matched_rule_name = serializers.CharField(source="matched_rule.name", read_only=True, default=None)

    class Meta:
        model = InboundEmail
        fields = [
            "id", "channel", "from_addr", "from_name", "subject", "status",
            "ignore_reason", "action_taken", "ticket", "ticket_number",
            "matched_rule", "matched_rule_name",
            "attempts", "created_at", "processed_at",
        ]


class InboundEmailDetailSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True, default=None)
    matched_rule_name = serializers.CharField(source="matched_rule.name", read_only=True, default=None)

    class Meta:
        model = InboundEmail
        fields = [
            "id", "channel", "message_id", "in_reply_to", "references",
            "from_addr", "from_name", "to_addrs", "cc_addrs", "subject",
            "date_header", "size_bytes", "headers", "body_text",
            "status", "ignore_reason", "action_taken",
            "ticket", "ticket_number", "matched_rule", "matched_rule_name",
            "comment", "requestor",
            "attempts", "last_error", "next_attempt_at", "processed_at", "created_at",
        ]
