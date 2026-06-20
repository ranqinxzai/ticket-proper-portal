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
