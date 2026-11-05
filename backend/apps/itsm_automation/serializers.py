from __future__ import annotations

import uuid

from rest_framework import serializers

from apps.itsm_core.services import sanitize_html

from .models import MAX_ACTIONS, ActionType, AutomationRule, AutomationRun, TriggerType
from .services.actions import _CHOICES, COMMENT_VISIBILITIES, AutomationError, clean_column_value
from .services.catalog import field_catalog


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


class AutomationRunSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source="ticket.ticket_number", read_only=True)

    class Meta:
        model = AutomationRun
        fields = ["id", "rule", "ticket", "ticket_number", "event", "status", "message",
                  "actions_result", "created_at"]
        read_only_fields = fields


class AutomationRuleSerializer(serializers.ModelSerializer):
    """Validates the JSON payloads against the rule's project, so a saved rule can
    only reference that project's workflow, statuses and fields."""

    created_by_name = serializers.SerializerMethodField()
    # {user_id: display name} for every person a rule references (condition values,
    # set_field assignee/user values), so the editor never shows raw ids.
    user_labels = serializers.SerializerMethodField()

    class Meta:
        model = AutomationRule
        fields = ["id", "project", "name", "description", "is_active", "order", "triggers",
                  "conditions", "actions", "stop_processing", "last_run_at", "run_count",
                  "failure_count", "created_by", "created_by_name", "user_labels",
                  "created_at", "updated_at"]
        read_only_fields = ["last_run_at", "run_count", "failure_count", "created_by",
                            "created_by_name", "user_labels", "created_at", "updated_at"]

    def get_created_by_name(self, obj):
        u = obj.created_by
        return (getattr(u, "full_name", "") or u.username) if u else None

    def get_user_labels(self, obj):
        from django.contrib.auth import get_user_model

        ids = set()
        for c in (obj.conditions or {}).get("conditions") or []:
            vals = c.get("value") if isinstance(c.get("value"), list) else [c.get("value")]
            ids.update(str(v) for v in vals if str(v).isdigit())
        for a in obj.actions or []:
            if a.get("type") == ActionType.SET_FIELD:
                v = (a.get("config") or {}).get("value")
                if v is not None and str(v).isdigit():
                    ids.add(str(v))
        if not ids:
            return {}
        users = get_user_model().objects.filter(pk__in=[int(i) for i in ids])
        return {str(u.pk): (getattr(u, "full_name", "") or u.username) for u in users}

    # ── helpers ──────────────────────────────────────────────────────────────
    def _project(self, attrs):
        project = attrs.get("project") or getattr(self.instance, "project", None)
        if project is None:
            raise serializers.ValidationError({"project": "A project is required."})
        return project

    def _catalog(self, project):
        if not hasattr(self, "_catalog_cache"):
            self._catalog_cache = field_catalog(project)
        return self._catalog_cache

    @staticmethod
    def _workflow_status_ids(project):
        from apps.itsm_workflows.models import Status

        if not project.default_workflow_id:
            return set()
        return {str(s) for s in Status.objects.filter(
            workflow_id=project.default_workflow_id, is_deleted=False).values_list("id", flat=True)}

    # ── field validation ─────────────────────────────────────────────────────
    def validate_project(self, project):
        if self.instance is not None and project.pk != self.instance.project_id:
            raise serializers.ValidationError("A rule can't be moved to another project.")
        return project

    def validate(self, attrs):
        project = self._project(attrs)
        if "triggers" in attrs or self.instance is None:
            attrs["triggers"] = self._clean_triggers(attrs.get("triggers"), project)
        if "conditions" in attrs:
            attrs["conditions"] = self._clean_conditions(attrs.get("conditions"))
        if "actions" in attrs or self.instance is None:
            attrs["actions"] = self._clean_actions(attrs.get("actions"), project)
        return attrs

    def _clean_triggers(self, triggers, project):
        if not isinstance(triggers, list) or not triggers:
            raise serializers.ValidationError({"triggers": "Pick at least one trigger."})
        watchable = {f["key"] for f in self._catalog(project)["update_fields"]}
        status_ids = self._workflow_status_ids(project)
        seen, out = set(), []
        for t in triggers:
            ttype = (t or {}).get("type")
            if ttype not in TriggerType.values:
                raise serializers.ValidationError({"triggers": f"Unknown trigger “{ttype}”."})
            if ttype in seen:
                raise serializers.ValidationError({"triggers": f"“{ttype}” is listed twice."})
            seen.add(ttype)
            cfg = (t or {}).get("config") or {}
            clean = {}
            if ttype == TriggerType.TICKET_UPDATED:
                fields = [str(f) for f in cfg.get("fields") or []]
                bad = [f for f in fields if f not in watchable]
                if bad:
                    raise serializers.ValidationError(
                        {"triggers": f"These fields aren't on this project: {', '.join(bad)}."})
                clean["fields"] = list(dict.fromkeys(fields))
            elif ttype == TriggerType.STATUS_CHANGED:
                for key in ("from_status_ids", "to_status_ids"):
                    ids = [str(s) for s in cfg.get(key) or []]
                    if any(s not in status_ids for s in ids):
                        raise serializers.ValidationError(
                            {"triggers": "A status isn't in this project's workflow."})
                    clean[key] = ids
            out.append({"type": ttype, "config": clean})
        return out

    def _clean_conditions(self, spec):
        from apps.itsm_tickets.services.query_builder import MAX_CONDITIONS, _compile_condition

        if spec in (None, "", {}):
            return {}
        if not isinstance(spec, dict):
            raise serializers.ValidationError({"conditions": "Conditions must be an object."})
        conds = spec.get("conditions") or []
        if not isinstance(conds, list) or len(conds) > MAX_CONDITIONS:
            raise serializers.ValidationError({"conditions": "Too many conditions."})
        for c in conds:
            if not isinstance(c, dict):
                raise serializers.ValidationError({"conditions": "Malformed condition."})
            # "Me" has no meaning for a rule (it runs as the automation bot).
            vals = c.get("value") if isinstance(c.get("value"), list) else [c.get("value")]
            if "me" in vals:
                raise serializers.ValidationError(
                    {"conditions": "“Me” can't be used in an automation rule; pick a person."})
            # A condition the queue compiler would silently drop would widen the rule.
            if _compile_condition(c, None) is None:
                raise serializers.ValidationError(
                    {"conditions": f"The condition on “{c.get('field')}” is incomplete or invalid."})
        return {"match": "any" if spec.get("match") == "any" else "all", "conditions": conds}

    def _clean_actions(self, actions, project):
        if not isinstance(actions, list) or not actions:
            raise serializers.ValidationError({"actions": "Add at least one action."})
        if len(actions) > MAX_ACTIONS:
            raise serializers.ValidationError({"actions": f"A rule can have at most {MAX_ACTIONS} actions."})
        return [self._clean_action(a, project) for a in actions]

    def _clean_action(self, action, project):
        atype = (action or {}).get("type")
        cfg = (action or {}).get("config") or {}
        if atype == ActionType.TRANSITION:
            return {"type": atype, "config": self._clean_transition(cfg, project)}
        if atype == ActionType.SET_FIELD:
            return {"type": atype, "config": self._clean_set_field(cfg, project)}
        if atype == ActionType.ADD_COMMENT:
            return {"type": atype, "config": self._clean_comment(cfg)}
        raise serializers.ValidationError({"actions": f"Unknown action “{atype}”."})

    def _clean_transition(self, cfg, project):
        from apps.itsm_workflows.models import Transition

        tid = cfg.get("transition_id")
        tr = None
        if _is_uuid(tid):
            tr = Transition.objects.filter(pk=tid, is_deleted=False,
                                           workflow_id=project.default_workflow_id).first()
        if tr is None:
            raise serializers.ValidationError(
                {"actions": "Pick a transition from this project's workflow."})
        if tr.from_status_id is None and not tr.is_global:
            raise serializers.ValidationError(
                {"actions": "The create transition can't be run by automation."})
        # keep_assignee is redundant since 2026-10-18 (auto_assign never overwrites an
        # assignee — engine B17c); kept for API/stored-data compatibility.
        return {"transition_id": str(tr.pk), "keep_assignee": bool(cfg.get("keep_assignee", True))}

    def _clean_set_field(self, cfg, project):
        from apps.itsm_core.services import fields as field_service
        from apps.itsm_groups.models import Group

        field = cfg.get("field")
        entry = next((f for f in self._catalog(project)["set_fields"] if f["key"] == field), None)
        if entry is None:
            raise serializers.ValidationError({"actions": f"“{field}” can't be set by automation."})
        value = cfg.get("value")
        ftype = entry.get("field_type")

        def bad(msg):
            return serializers.ValidationError({"actions": msg})

        def live_options():
            # This project's definition: several projects share a key such as "category".
            fd = next((d for d in field_service.get_field_definitions(project) if d.key == field[3:]), None)
            return fd.options.filter(is_active=True, is_deleted=False) if fd else None

        if field in _CHOICES:
            if value not in _CHOICES[field]:
                raise serializers.ValidationError({"actions": f"Pick a valid {entry['label']}."})
        elif field == "assignee":
            if value not in (None, ""):
                try:
                    value = int(value)
                except (TypeError, ValueError) as exc:
                    raise serializers.ValidationError({"actions": "Pick a valid assignee."}) from exc
            else:
                value = None
        elif field == "assigned_group":
            if not _is_uuid(value) or not Group.objects.filter(pk=value, is_deleted=False).exists():
                raise serializers.ValidationError({"actions": "Pick a valid group."})
            value = str(value)
        elif not field.startswith("cf:"):
            # An ITIL column: users_affected, resolution_code, major_incident, …
            try:
                value = clean_column_value(field, value)
            except AutomationError as exc:
                raise bad(str(exc)) from exc
        elif ftype in ("dropdown", "radio") and value not in (None, ""):
            opts = live_options()
            if opts is None or not opts.filter(value=value).exists():
                raise bad(f"Pick a valid {entry['label']} option.")
        elif ftype == "multiselect":
            picked = [str(v) for v in (value if isinstance(value, list) else [value]) if v not in (None, "")]
            opts = live_options()
            if not picked:
                raise bad(f"Pick at least one {entry['label']} option.")
            if opts is None or set(picked) - set(opts.filter(value__in=picked).values_list("value", flat=True)):
                raise bad(f"Pick valid {entry['label']} options.")
            value = list(dict.fromkeys(picked))
        elif ftype == "cascade":
            # A path from a top-level node down, each node a child of the one before
            # (the catalog's tree is this project's field).
            path = [str(v) for v in value] if isinstance(value, list) else []
            nodes = {o["value"]: o for o in (entry.get("cascade") or {}).get("options", [])}
            parent = None
            for v in path:
                node = nodes.get(v)
                if node is None or node["parent"] != parent:
                    raise bad(f"Pick a valid {entry['label']}.")
                parent = node["id"]
            if not path:
                raise bad(f"Pick a {entry['label']}.")
            value = path
        elif ftype == "group_picker":
            gid = value[0] if isinstance(value, list) and len(value) == 1 else value
            if not _is_uuid(gid) or not Group.objects.filter(pk=gid, is_deleted=False).exists():
                raise bad(f"Pick a valid {entry['label']} group.")
            value = str(gid)
        return {"field": field, "value": value}

    def _clean_comment(self, cfg):
        from apps.itsm_tickets.models import CannedNote

        visibility = cfg.get("visibility") or "private"
        if visibility not in COMMENT_VISIBILITIES:
            raise serializers.ValidationError({"actions": "Comment visibility must be public or private."})
        note_id = cfg.get("canned_note_id")
        if note_id:
            if not _is_uuid(note_id) or not CannedNote.objects.filter(
                    pk=note_id, is_shared=True, is_deleted=False).exists():
                raise serializers.ValidationError({"actions": "Pick a shared canned response."})
            return {"canned_note_id": str(note_id), "visibility": visibility}
        body = sanitize_html(cfg.get("body_html") or "")
        if not body.strip():
            raise serializers.ValidationError({"actions": "The comment can't be empty."})
        return {"body_html": body, "visibility": visibility}
