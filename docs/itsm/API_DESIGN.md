# API Design — ITSM Platform

All routes under **`/api/v1/itsm/`**. DRF routers + custom `@action`s. Auth = JWT (`djangorestframework-simplejwt`). OpenAPI via drf‑spectacular. Endpoints marked **(built)** exist today (M0/M1); **(planned)** land at the noted milestone.

- **Schema:** `GET /api/v1/itsm/schema/`
- **Swagger UI:** `GET /api/v1/itsm/docs/`

---

## 1. Authentication Flow **(built)**

| Method | Path | Body / Result |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `{access, refresh, user}` |
| POST | `/auth/refresh` | `{refresh}` → `{access}` (rotation on) |
| GET | `/auth/me` | → current user `{id, username, full_name, email, is_superuser, role, permissions}` |

- **JWT:** `Authorization: Bearer <access>`. Access TTL 8 h, refresh 7 d, `ROTATE_REFRESH_TOKENS=True`.
- The **`user`** payload (login + `/me`) embeds a flattened **permission map**: `{ "itsm.tickets": {"read":true,"create":true,"update":true,"delete":false}, … }` for UI gating. Superusers get all‑true for every module.
- Access claims include `username` and `is_superuser`.

```jsonc
// POST /auth/login → 200
{
  "access": "eyJ…", "refresh": "eyJ…",
  "user": {
    "id": "…", "username": "asmith", "full_name": "A. Smith",
    "is_superuser": false,
    "role": {"code": "agent", "name": "Agent"},
    "permissions": { "itsm.tickets": {"read":true,"create":true,"update":true,"delete":false}, "…": {} }
  }
}
```

## 2. Conventions

### 2.1 Permissions
Every ViewSet declares a `module_code`. HTTP method → CRUD action → `check_permission` (GET=read, POST=create, PUT/PATCH=update, DELETE=delete). A `@action` may override its module (private comments, bulk). See `ROLES_PERMISSIONS_MATRIX.md`.

### 2.2 Pagination
Page‑number pagination (`StandardPagination`): `?page=`, `?page_size=` (default **25**, max **500**). Response:

```jsonc
{ "count": 142, "next": "…?page=2", "previous": null, "results": [ … ] }
```
Some catalogue endpoints (`modules`, `status-categories`) set `pagination_class = None` and return a bare list.

### 2.3 Filtering / search / ordering
`DjangoFilterBackend` + `SearchFilter` + `OrderingFilter`:
- **Filter:** per‑resource `filterset_fields` (e.g. tickets: `project`, `ticket_type`, `status`, `status__category`, `priority`, `assignee` (+ `isnull`), `assigned_group`, `created_at__gte/lte`).
- **Search:** `?search=` over `search_fields` (tickets: `ticket_number`, `summary`, `description_text`).
- **Order:** `?ordering=` over `ordering_fields` (tickets: `created_at`, `updated_at`, `priority`, `due_date`, `ticket_number`; prefix `-` for desc). Default `-created_at`.

### 2.4 Error shapes
| Status | When | Body |
|---|---|---|
| **400** Bad Request | Serializer / domain validation (`ValueError`). | `{"detail": "…"}` or field errors `{ "summary": ["This field is required."] }` |
| **401** Unauthorized | Missing/invalid JWT. | `{"detail": "Authentication credentials were not provided."}` |
| **403** Forbidden | RBAC denied, or a **transition condition** (guard) failed. | `{"detail": "You do not have permission…"}` / `{"detail": "You are not allowed to perform this transition."}` |
| **404** Not Found | Object missing / soft‑deleted. | `{"detail": "Not found."}` |
| **409** Conflict | **Stale transition** — `from_status` ≠ ticket's current status (button stale). | `{"detail": "Ticket has already moved; refresh and retry."}` |
| **422** Unprocessable | **Transition validators** — mandatory screen fields missing (all collected). | `{"detail": "Mandatory fields missing.", "errors": {"resolution": ["This field is required for this transition."]}}` |

> 409 and 422 are produced by `engine.transition()` via `TransitionError(status_code=…)` and surfaced verbatim by `TicketViewSet.transition`.

## 3. Resource Index

### 3.1 RBAC / auth **(built)** — `itsm_rbac`
| Resource | Methods | Module |
|---|---|---|
| `/modules` | GET (RO, unpaginated) | `itsm.admin.roles` |
| `/roles` | GET, POST, PUT/PATCH, DELETE; `PUT /roles/{id}/permissions` | `itsm.admin.roles` |
| `/role-permissions` | GET, POST, PUT/PATCH, DELETE | `itsm.admin.roles` |
| `/role-assignments` | GET, POST, PUT/PATCH, DELETE | `itsm.admin.roles` |

### 3.2 Projects **(built)** — `itsm_projects`
| Resource | Methods | Module |
|---|---|---|
| `/projects` | GET, POST, PUT/PATCH, DELETE | `itsm.projects` |
| `/ticket-types` | GET, POST, PUT/PATCH, DELETE | `itsm.projects.config` |

### 3.3 Groups **(built)** — `itsm_groups`
| Resource | Methods | Module |
|---|---|---|
| `/groups` | GET, POST, PUT/PATCH, DELETE; `GET {id}/members`, `POST {id}/add_member`, `POST {id}/remove_member` | `itsm.groups` |
| `/group-memberships` | GET, POST, PUT/PATCH, DELETE | `itsm.groups` |
| `/routing-rules` | GET, POST, PUT/PATCH, DELETE | `itsm.groups` |

### 3.4 Workflows **(built)** — `itsm_workflows`
| Resource | Methods | Module |
|---|---|---|
| `/workflows` | GET, POST, PUT/PATCH, DELETE; `GET {id}/graph`, `POST {id}/validate` | `itsm.workflows` |
| `/status-categories` | GET (RO‑ish, unpaginated) | `itsm.workflows` |
| `/statuses` | GET, POST, PUT/PATCH, DELETE (filter `workflow`) | `itsm.workflows.transitions` |
| `/transitions` | GET, POST, PUT/PATCH, DELETE (filter `workflow`, `from_status`) | `itsm.workflows.transitions` |
| `/auto-assignment-rules` | GET, POST, PUT/PATCH, DELETE | `itsm.workflows.transitions` |
| `/reopen-rules` | GET, POST, PUT/PATCH, DELETE | `itsm.workflows.transitions` |
| `/transition-screens` | GET, POST, PUT/PATCH, DELETE | `itsm.workflows.transitions` |

> **Builder round‑trip (planned, M4):** `GET /workflows/{id}/graph` returns nodes+edges; a `PUT` persists them atomically; `POST {id}/validate` (built) and `publish/` (planned) finalize a version (copy‑on‑publish).

### 3.5 Tickets **(built)** — `itsm_tickets`
| Resource | Methods | Module |
|---|---|---|
| `/tickets` | GET (list), POST (create), GET (retrieve), PUT/PATCH, DELETE (soft) | `itsm.tickets` |
| `/comments` | GET, POST, PUT/PATCH, DELETE | `itsm.tickets.comments` |
| `/watchers` | GET, POST, PUT/PATCH, DELETE | `itsm.tickets.watchers` |
| `/ticket-links` | GET, POST, PUT/PATCH, DELETE | `itsm.tickets.links` |
| `/ticket-attachments` | GET, POST (multipart), DELETE | `itsm.tickets` |

### 3.6 Email channel **(built)** — `itsm_email`
| Resource | Methods | Module |
|---|---|---|
| `/email-channels` | GET, POST, PUT/PATCH, DELETE; `POST {id}/test-connection`, `POST {id}/poll-now`, `POST {id}/oauth/start` | `itsm.email.channels` |
| `/email/oauth/callback` | GET (top-level; provider redirect → token exchange) | `itsm.email.channels` |
| `/email-rules` | GET, POST, PUT/PATCH, DELETE (allow/block lists) | `itsm.email.channels` |
| `/inbound-emails` | GET (RO list/retrieve); `POST {id}/retry` | `itsm.email.logs` |

> Secrets (basic password, OAuth tokens) are **write-only** and masked on read; credentials are
> Fernet-encrypted at rest. Inbound polling creates tickets (`source="email"`) / comments via
> `ticket_service`; outbound notification mail is threaded via `email_thread_headers`. See
> `EMAIL_CHANNEL.md`. RBAC: `itsm.email.channels` (Supervisor-only), `itsm.email.logs` (Agent RO).

### 3.7 Engine resources **(planned)**
- **SLA (M5):** `/sla-policies`, `/sla-metrics`, `/business-calendars`, `/holidays`, `/sla-trackers` (RO), `/escalation-rules`.
- **Notifications (M6):** `/notification-schemes`, `/notification-rules`, `/email-templates`, `/notifications` (inbox) with `{id}/read`, `mark-all-read`, `unread-count`.
- **Fields (M3):** `/field-definitions`, `/field-options`, `/field-layouts`.
- **Canned/templates (M7):** `/canned-notes` (+categories), `/ticket-templates` (+categories).
- **Dashboards (M10):** `/saved-filters`, `/dashboards`, `/widgets`.
- **Reports (M9):** `/reports/...` (RO actions returning chart‑ready JSON).

## 4. Key Ticket Custom Actions **(built unless noted)**

| Action | Method · Path | Purpose |
|---|---|---|
| **Create** | `POST /tickets` | Routes through `ticket_service.create_ticket` (numbering, routing, audit, SLA/notify hooks). Returns the detail representation. |
| **Available transitions** | `GET /tickets/{id}/available-transitions` | Transitions valid from the current status whose conditions pass for the caller. |
| **Transition** | `POST /tickets/{id}/transition` | `{transition_id, fields?, comment?, comment_visibility?}` → runs the engine pipeline. 409/422/403 per §2.4. Optional inline comment is posted on success. |
| **Assign** | `POST /tickets/{id}/assign` | `{assignee?, group?}` → locked re‑assignment; logs `group_changed` / `assigned`. |
| **Watch** | `POST` / `DELETE /tickets/{id}/watch` | Add/remove current user as watcher. |
| **Watchers** | `GET /tickets/{id}/watchers` | List watchers. |
| **Comments** | `GET` / `POST /tickets/{id}/comments` | List (private filtered by `comments_private` grant) / add `{body_html, visibility, mention_user_ids?}`. |
| **Activity** | `GET /tickets/{id}/activity` | Last 200 `AuditEvent` rows. |
| **Links** | `GET` / `POST /tickets/{id}/links` | List / add `{target_ticket, link_type}`. |
| **Reopen** *(planned)* | `POST /tickets/{id}/reopen` | Guarded reopen transition (`ReopenRule`). |
| **Apply template** *(planned, M7)* | `POST /tickets/{id}/apply-template` | Apply a `TicketTemplate`. |
| **Bulk** *(planned, M2)* | `POST /tickets/bulk` | Bulk update/assign/transition; gated by `itsm.tickets.bulk`. |
| **SLA** *(planned, M5)* | `GET /tickets/{id}/sla` | Countdown payload (`due_at`, `state`, `rag`, paused remaining). |

### 4.1 Create example
```jsonc
// POST /tickets
{
  "project": "<uuid>", "ticket_type": "<uuid>",
  "summary": "VPN down for finance team",
  "description_html": "<p>Users in finance cannot reach the VPN.</p>",
  "priority": "high", "impact": "high", "urgency": "high",
  "requestor": "<uuid|null>", "assigned_group": "<uuid|null>",
  "assignee": "<uuid|null>", "source": "agent"
}
// → 201; returns TicketDetailSerializer incl. ticket_number e.g. "INC-1"
```
Server side: `create_ticket` picks the project's `default_workflow` + initial status, generates `INC‑N` under a locked sequence, applies the first matching `RoutingRule` (when no assignee given), stamps `assigned_at`, and on commit logs `ticket_created` + fires `TicketCreated` / `Assigned` hooks.

### 4.2 Transition example
```jsonc
// POST /tickets/{id}/transition
{ "transition_id": "<uuid>", "fields": {"resolution": "Restarted VPN concentrator"},
  "comment": "<p>Fixed.</p>", "comment_visibility": "public" }
// success → 200 TicketDetail
// stale  → 409 {"detail":"Ticket has already moved; refresh and retry."}
// guard  → 403 {"detail":"You are not allowed to perform this transition."}
// missing→ 422 {"detail":"Mandatory fields missing.","errors":{"resolution":["…"]}}
```

## 5. Representative Payloads

```jsonc
// GET /tickets (list item — TicketListSerializer)
{
  "id":"…","ticket_number":"INC-1","project":"…","project_key":"INC",
  "ticket_type":"…","ticket_type_name":"Incident","summary":"VPN down",
  "status":"…","status_name":"In Progress","status_category":"in_progress","status_color":"#3b82f6",
  "priority":"high",
  "assignee":{"id":"…","username":"asmith","full_name":"A. Smith"},
  "assigned_group":"…","assigned_group_name":"Network Team",
  "due_date":null,"created_at":"…","updated_at":"…","resolved_at":null
}

// GET /tickets/{id} adds: description_html/text, requestor, created_by, workflow(+name),
//                         impact, urgency, resolution, source,
//                         first_responded_at, assigned_at, closed_at, reopen_count

// POST /tickets/{id}/comments
{ "body_html":"<p>Looking into it.</p>", "visibility":"private", "mention_user_ids":["<uuid>"] }
// → 201 CommentSerializer {id, ticket, author{…}, visibility, body_html, body_text, edited_at, created_at}
```

## 6. Notes & Guarantees
- Rich text (`description_html`, `body_html`) is **sanitized server‑side** (`bleach`) on save; a `*_text` plain mirror is stored for search/preview.
- All ticket writes funnel through `ticket_service` / `workflow_service`; side‑effects (audit, SLA, notifications) run in `transaction.on_commit`.
- DELETE is **soft** for `BaseModel` resources (`ItsmModelViewSet.perform_destroy` calls `soft_delete`).
- Do not assume endpoints beyond this list for built apps; planned endpoints are flagged and may change to match the engine implementation.

## 7. Update 2026-10-18 — bug-fix batch: new and changed endpoints
All paths are under `/api/v1/[t/<org>/]itsm/` unless noted.

| Endpoint | Method | Module | Purpose |
|---|---|---|---|
| `tickets/{id}/pulse/` | GET | `itsm.tickets` | Per-ticket change token for live detail: `{version, updated_at, comment_count, attachment_count, last_event_id, last_actor}`. Scoped like the detail GET. |
| `tickets/{id}/mentionable/?term=` | GET | `itsm.tickets.comments` | Agents who can be @mentioned: active helpdesk-member agents, max 200. |
| `workflows/{id}/usage/` | GET | `itsm.workflows` | `{project_count, projects[], hidden_count, is_default, base_type}`. |
| `workflows/{id}/clone/` | POST | `itsm.workflows` create (+ `itsm.projects:update` to link) | `{project?, name?}` → 201 copy + `automation: {repointed, unmatched}`. |
| `kb-articles/{id}/archive/`, `…/restore/` | POST | `itsm.knowledge` create | Lifecycle (with `publish/` and `unpublish/`). `status` is read-only on PATCH. |
| `auth/password-reset/` | POST | none (public, per org) | `{login}` → generic 200; emails a 60-min single-use link. |
| `auth/password-reset/validate/` | POST | none | `{uid, token}` → `{valid}`. |
| `auth/password-reset/confirm/` | POST | none | `{uid, token, new_password}` → 200, or 400 with the reason. |
| `audit-events/` | GET | `itsm.admin.audit` | Admin & security audit log. Filters `date_from/date_to/actor/area/action/q`. |
| `audit-events/facets/` | GET | `itsm.admin.audit` | Filter-picker values. |
| `audit-events/export/` | GET | `itsm.admin.audit` | CSV (10k cap; `X-Audit-Export-Total` / `-Truncated`; formula-escaped; logged). |

**Changed behaviour:**
- **Stale-write guard.**
  - `PATCH tickets/{id}/` and `POST tickets/{id}/set-fields/` accept an optional `expected_updated_at`.
  - If the row changed since → **409** `{detail, code: "stale_write", updated_at}`; a bad value → 400.
  - System writers (automation, email, bulk, transition, assign, portal) never send it. Extends §2.4: 409 is no longer only the stale-transition case.
- **Ticket create:** 403 without `itsm.tickets.create`. Agent create returns 400 `{<field_key>: [msg]}` for missing visible Required fields.
- **Comments:** 403 `{invalid_mention_ids}` for mentions outside `mentionable`.
- **Search:** `GET tickets/?search=` is ranked FTS + trigram + number/alias + comment search.
- **Transitions:**
  - 400 for the create transition on an existing ticket, a transition into a deleted status, or an approval that can't start (rolled back).
  - `available-transitions` rows carry `blocked_reason`. The transitions serializer adds `to_status_name`, `to_status_category` and `from_status_name`.
- **Approval requests:**
  - `start/` needs `itsm.approvals` create + project access (404 otherwise).
  - List/retrieve are clamped (helpdesk/project + own + approver), and add `mode`, `stage_ids`, `pending_stages[]`, `can_decide`, `blocked_reason` and approver names.
  - `reject/` requires `comment` (400).
  - `my-pending/`, `approve/` and `reject/` need `itsm.portal.approvals` read for roled users.
  - *(2026-10-24)* `GET send-options/?ticket=`, `POST send/` `{ticket, workflow, approvers:{stage_id:[user_id]}, note}` (201; 400 not allowed / pick problems; 409 pending) and `POST {id}/withdraw/` `{reason?}` (sent requests only) need `itsm.approvals.send`. Requests add `source`, `note`, `requested_by_name`, `return_status_name`, `waiting_status_name`, `can_withdraw`. Stages add `on_fly_pool`, `candidate_users`; statuses add `allows_send_for_approval`, `approval_waiting_status`. See `.claude/skills/itsm-workflows/API_CONTRACTS.md`.
- **Reports:** SLA reports need `itsm.reports.sla`; `agent-performance` needs `itsm.reports.agent` (403).
- **`canned-notes/?for_helpdesk=<id>`:** helpdesk + org-wide + own personal.
- **`saved-filters/`:** scoped by `?project` / `?helpdesk`. `queue-view/` with `view_key: ""` clears.
- **Legacy `/api/v1/[t/<org>/]users/`** (outside `itsm/`): **read-only, agent-only** (`itsm.tickets` read) minimal directory `{id, username, full_name, email}`. Writes → 405. The legacy session `auth/login|logout|me` routes are removed; JWT `itsm/auth/login/` is the only login.

## 8. Update 2026-10-19 — Asset Management v1 (`itsm_assets`)
All under `/api/v1/[t/<org>/]itsm/`. Full contracts: `.claude/skills/itsm-assets/API_CONTRACTS.md`.

| Endpoint | Method | Module | Purpose |
|---|---|---|---|
| `assets/` · `assets/{id}/` | CRUD | `itsm.assets` | The register. Filters `category, sub_category, status, state_type, location, department, vendor, assigned_user, import, warranty, expiry, purchased_from/to, search`; `ordering`. Validation errors → 400 `{detail, errors:{field|details.<key>: [msg]}}`. |
| `assets/{id}/history/` | GET | `itsm.assets` | `AssetEvent` timeline. |
| `assets/summary/` · `assets/report/?group_by=` | GET | `itsm.assets` | Dashboard numbers · grouped counts + cost. |
| `assets/export/?helpdesk=` | GET | `itsm.assets` | xlsx (Summary + Assets). |
| `assets/form-fields/?category=&sub_category=` | GET | `itsm.assets` | Detail fields that apply. |
| `asset-imports/` (+ `validate/`, `template/`, `{id}/rows/`, `{id}/failed-rows/`) | GET/POST | `itsm.assets.import` | Excel import: good rows saved, failed rows kept; check-only dry run; `create_missing` also needs `itsm.assets.config:create`. |
| `asset-statuses/`, `asset-vendors/`, `asset-locations/`, `asset-departments/` | CRUD | `itsm.assets.config` (GET also with `itsm.assets` read) | Org-wide lists, unpaginated. Delete in use → 400. |
| `asset-categories/` (+ `load-starter/`), `asset-fields/`, `asset-category-fields/` | CRUD | `itsm.assets.config` (GET also with `itsm.assets` read) | Per-helpdesk category tree and detail fields. |
| `asset-users/?search=` | GET | `itsm.assets` or `.config` read | User picker `{id, username, full_name, email}`. |

## 9. Update 2026-10-23 — tickets ↔ assets
| Endpoint | Method | Module | Purpose |
|---|---|---|---|
| `tickets/` | POST | `itsm.tickets.create` | `assets: [ids]` (first = primary); 400 `{"asset":[…]}` |
| `tickets/{id}/assets/` | GET / POST | `itsm.tickets` (POST checked as **update**) | List / add linked assets `{assets:[ids], expected_updated_at?}` → `{assets, updated_at}` |
| `tickets/{id}/assets/unlink/`, `…/assets/primary/` | POST | `itsm.tickets` update | `{asset}`; 409 `stale_write` |
| `portal/request-intake/my-assets/?project=` | GET | `itsm.portal.tickets` | The requestor's own active assets; intake `fields.asset` is owner-checked |
| `assets/{id}/tickets/` | GET | `itsm.assets` | Tickets linked to an asset (scope-clamped, open first) |

