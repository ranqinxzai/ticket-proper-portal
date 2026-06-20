# ITSM Skills — Module Map

One-line index of all 15 ITSM module skills. Each is a directory with 7 files
(`SKILL.md`, `ARCHITECTURE.md`, `API_CONTRACTS.md`, `DB_SCHEMA.md`, `BUG_LOG.md`,
`INTERLINKING.md`, `USER_FLOWS.md`). API base for all: `/api/v1/itsm/`.

| Skill | Backend app | One-liner | State |
|---|---|---|---|
| `itsm-core` | `itsm_core` | `BaseModel`, `AuditEvent` + `log_event`, HTML sanitizer, cross-engine hooks. The shared foundation. | built |
| `itsm-rbac` | `itsm_rbac` | Module/role/permission tree, `HasModulePermission`, `check_permission`, JWT login. | built |
| `itsm-helpdesks` | `itsm_helpdesks` | Helpdesk workspaces/departments + memberships; the row-level scope every ticket query is clamped to. | built |
| `itsm-projects` | `itsm_projects` | `Project` (key/type/defaults) + `TicketType`; seeds INC + REQ. | built |
| `itsm-groups` | `itsm_groups` | Teams, memberships, routing rules, round-robin/least-loaded auto-assign. | built |
| `itsm-workflows` | `itsm_workflows` | Statuses/transitions + execution engine (conditions/validators/post-functions) + graph validator. | built |
| `itsm-tickets` | `itsm_tickets` | `Ticket` + comments/watchers/links/attachments; numbering; ticket_service. | built |
| `itsm-sla` | `itsm_sla` | Business calendars, SLA policies, trackers, pause/resume, breach sweep, escalations. | built |
| `itsm-notifications` | `itsm_notifications` | Notification schemes/rules, email templates, in-app inbox, durable outbox + flusher. | built |
| `itsm-fields` | `itsm_core` (`models/fields.py` + `services/fields.py`) | Dynamic custom-field engine + layout designer (CellValue pattern). | built |
| `itsm-canned-notes` | `itsm_tickets` | Reusable comment snippets + categories (composer inserter). | built |
| `itsm-templates` | `itsm_tickets` | Ticket templates + categories (prefill the create wizard). | built |
| `itsm-reporting` | `itsm_reporting` | Live report query services. | built |
| `itsm-dashboards` | `itsm_dashboards` | `SavedFilter` (query_spec→Q) + `Dashboard`/`Widget`/`DashboardShare` grid builder. | built |
| `itsm-email` | `itsm_email` | Bidirectional email: IMAP/POP poll → ticket/comment, OAuth2 (Google/MS), Fernet creds, threaded outbound, inbound log + retry. | built |

Root docs: `_PROJECT_OVERVIEW.md` (the product + stack + run), `_CODING_RULES.md` (conventions).
