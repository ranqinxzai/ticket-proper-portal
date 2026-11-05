# itsm-automation: Interlinking

Every inbound edge goes through the lazy `hooks.automation_dispatch`, so none can break a ticket write.

- **itsm-core**
  - `hooks.automation_dispatch` (rule 12).
  - `field_service.set_values(..., notify_automation=)` now returns the changed keys.
  - `AuditEvent.Action.AUTOMATION_APPLIED`.
  - `sanitize_html` for comment bodies.
- **itsm-tickets**
  - Emit points in `create_ticket`, `assign` and `update_ticket` (`_changed_field_keys` maps saved columns to trigger field keys).
  - `add_comment(counts_as_response=False)`.
  - `query_builder.build_q` / `_compile_condition` evaluate and validate conditions.
  - `filter_fields` is the source of `filter_key` metadata.
  - The views `refresh_from_db()` before serializing.
- **itsm-workflows**
  - `engine.transition(preserve_assignee=)`, and the `status_changed` dispatch in `_after_commit`.
  - The transition action reuses every engine guard: approval freeze, conditions, field conditions.
- **itsm-projects**
  - `AutomationRule.project` FK.
  - The **Automation** tab in project settings.
  - Permission reuses `itsm.projects` (read / update).
- **itsm-helpdesks**: `accessible_helpdesk_ids_cached` and `is_project_accessible` clamp the API (rule 15).
- **itsm-groups**: `ensure_assignee_in_group` (set group clears a non-member assignee) and `ensure_group_allowed`, both via `update_ticket`.
- **itsm-canned-notes**: the `add_comment` action can use a shared `CannedNote` (its current `body_html`).
- **itsm-notifications**: no direct edge. Actions emit the normal events (`StatusChanged`, `Assigned`, `CommentAdded…`) through the services they call, so the usual notification rules apply.
- **itsm-sla**
  - Transitions fire the usual SLA hooks.
  - Automated public comments do **not** stop first-response.
  - SLA escalation's `assign(user=None)` can trigger `ticket_updated` rules.

See [[itsm-tickets]], [[itsm-workflows]], [[itsm-projects]], [[itsm-core]], [[itsm-fields]].
