# ITSM Skills — Module Map

One-line index of the ITSM module skills. Each is a directory with 7 files
(`SKILL.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md`, `DB_SCHEMA.md`, `BUG_LOG.md`,
`INTERLINKING.md`, `USER_FLOWS.md`). API base for all: `/api/v1/itsm/`.

| Skill | Backend app | One-liner | State |
|---|---|---|---|
| `itsm-core` | `itsm_core` | `BaseModel`, `AuditEvent` + `log_event`, HTML sanitizer, cross-engine hooks (incl. non-swallowing `begin_approval`, `sla_priority_changed`, `send_password_reset_email`); **admin & security audit log** (`AdminAuditEvent` + `AdminAuditMixin`, `audit-events/` viewer, `itsm.admin.audit`). The shared foundation. | built |
| `itsm-rbac` | `itsm_rbac` | Module/role/permission tree, `HasModulePermission`, `check_permission`, JWT login. | built |
| `itsm-helpdesks` | `itsm_helpdesks` | Helpdesk workspaces/departments + memberships; the row-level scope every ticket query is clamped to. | built |
| `itsm-projects` | `itsm_projects` | `Project` (key/type/defaults) + `TicketType`; seeds INC + REQ; **standard-project catalog** (`standard_projects.py`) imports INC/REQ/**PRB** per helpdesk. | built |
| `itsm-groups` | `itsm_groups` | Teams, memberships, routing rules, round-robin/least-loaded auto-assign. | built |
| `itsm-workflows` | `itsm_workflows` (+ `itsm_approvals`, `itsm_catalog`) | Statuses/transitions + execution engine (conditions/validators/post-functions, create transition, `blocked_reason`) + graph validator + usage/clone; seeds Incident + Request (+ **Rejected**) + **Problem (Known Error)** defaults. Also documents **approvals** (multi-level/parallel, `begin_approval`, `can_decide`, auto-move to Rejected, **Send for approval** + **On-fly** approvers via `itsm_approvals/services/send.py` + `engine.move_for_approval`) and the request catalog. | built |
| `itsm-tickets` | `itsm_tickets` | `Ticket` + comments/watchers/links/attachments; numbering; ticket_service (incl. **`delete_ticket`** — the only delete; quiets SLA/approvals/outbox); **move-between-projects** (`move_ticket` + `TicketNumberAlias` redirect + `tickets/{id}/move`,`move-options`); **ranked search** (`services/search.py`, FTS + pg_trgm); **live detail pulse** (`tickets/{id}/pulse/`) + `expected_updated_at` 409; @mentions (`tickets/{id}/mentionable/`). | built |
| `itsm-sla` | `itsm_sla` | Business calendars, SLA policies, trackers, pause/resume, breach sweep, escalations. | built |
| `itsm-notifications` | `itsm_notifications` | Notification schemes/rules, email templates, in-app inbox, durable outbox + flusher. | built |
| `itsm-fields` | `itsm_core` (`models/fields.py` + `services/fields.py`) | Dynamic custom-field engine + layout designer (CellValue pattern); per-section **Collapsed** flag (`FieldLayout.sections[].collapsed`, agent ticket page only). | built |
| `itsm-canned-notes` | `itsm_tickets` | Reusable comment snippets + categories (composer inserter). | built |
| `itsm-templates` | `itsm_tickets` | Ticket templates + categories (prefill the create wizard). | built |
| `itsm-reporting` | `itsm_reporting` | Live report query services. | built |
| `itsm-dashboards` | `itsm_dashboards` | `SavedFilter` (query_spec→Q) + `Dashboard`/`Widget`/`DashboardShare` grid builder. | built |
| `itsm-email` | `itsm_email` | Bidirectional email: IMAP/POP poll → ticket/comment, OAuth2 (Google/MS), Fernet creds, threaded outbound, inbound log + retry; **one shared mailbox → multi-project keyword routing** within an **allowed-projects whitelist** (`EmailChannelProject` + `EmailRoutingRule`, default + first-match); per-helpdesk outbound transport (`HelpdeskEmailTransport`). | built |
| `itsm-surveys` | `itsm_surveys` | Per-project CSAT surveys: resolve/close trigger → branded email (via the notifications outbox) → portal feedback page → CSAT report + dashboard KPI. | built |
| `itsm-assets` | `itsm_assets` | **Asset Management v1** (basic IT assets): per-helpdesk register, category → sub-category tree with per-category detail fields, configurable statuses mapped to a state type (auto-Expired hourly), org-wide Vendor/Location/Department masters, Excel import (good rows saved, failed rows kept), dashboard + group-by report + export. | built (v1, 2026-10-19) |
| `itsm-automation` | `itsm_automation` | Per-project automation rules: When (created / field updated / status changed) → If (queue FilterSpec) → Then (transition / set field / add comment) as the `automation-bot`; run log + `automation_applied` audit; no chaining (v1). | built |

Root docs: `_PROJECT_OVERVIEW.md` (the product + stack + run), `_CODING_RULES.md` (conventions).
