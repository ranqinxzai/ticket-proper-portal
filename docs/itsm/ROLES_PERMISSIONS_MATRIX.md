# Roles & Permissions Matrix — ITSM Platform

Grounded in `backend/apps/itsm_rbac/` (`registry.py`, `models.py`, `permissions.py`, `services.py`). Two seeded `SystemRole`s — **Agent** and **Supervisor** — plus the full `itsm.*` module registry.

---

## 1. RBAC Model (how it works)

- A **`Module`** is a dot‑notation permission node (e.g. `itsm.tickets.bulk`) with an optional `parent`. Permissions **inherit down the tree**.
- A **`SystemRole`** (Agent, Supervisor, or custom) holds one **`RoleModulePermission`** row per module, granting four CRUD bits: `can_read`, `can_create`, `can_update`, `can_delete`.
- A user is bound to **one** role via **`RoleAssignment`** (`OneToOne` user → role) for v1.
- Every DRF ViewSet declares a **`module_code`**. `HasModulePermission` maps the HTTP method to a CRUD action and calls `check_permission`:

  | HTTP method | CRUD action |
  |---|---|
  | GET / HEAD / OPTIONS | `read` |
  | POST | `create` |
  | PUT / PATCH | `update` |
  | DELETE | `delete` |

- **Resolution** (`check_permission`): superusers bypass everything. Otherwise the resolver walks the **module chain** from the requested code up to the root (`itsm.tickets.bulk → itsm.tickets → itsm`) and the **closest ancestor with an explicit `RoleModulePermission` row decides** the bit. Result cached 5 min per `(role, module, action)`; `invalidate_permission_cache()` (a cache clear) is called after any role/permission edit.
- A ViewSet **without** a `module_code` permits any authenticated user (used for read‑only utility endpoints that opt out).

## 2. The `itsm.*` Module Registry

Exact list from `registry.py` (`code`, `name`, `parent`, `sort_order`):

| Code | Name | Parent | Sort |
|---|---|---|---|
| `itsm` | Service Management | — | 10 |
| `itsm.dashboard` | Dashboards | `itsm` | 20 |
| `itsm.tickets` | Tickets | `itsm` | 100 |
| `itsm.tickets.queue` | Ticket Queue | `itsm.tickets` | 101 |
| `itsm.tickets.create` | Create Ticket | `itsm.tickets` | 102 |
| `itsm.tickets.bulk` | Bulk Operations | `itsm.tickets` | 103 |
| `itsm.tickets.comments` | Comments | `itsm.tickets` | 104 |
| `itsm.tickets.comments_private` | Internal Comments | `itsm.tickets` | 105 |
| `itsm.tickets.watchers` | Watchers | `itsm.tickets` | 106 |
| `itsm.tickets.links` | Ticket Links | `itsm.tickets` | 107 |
| `itsm.tickets.templates` | Ticket Templates | `itsm.tickets` | 108 |
| `itsm.canned_notes` | Canned Notes | `itsm.tickets` | 110 |
| `itsm.projects` | Projects | `itsm` | 200 |
| `itsm.projects.config` | Project Configuration | `itsm.projects` | 201 |
| `itsm.groups` | Groups / Teams | `itsm` | 210 |
| `itsm.workflows` | Workflows | `itsm` | 300 |
| `itsm.workflows.transitions` | Transitions / Builder | `itsm.workflows` | 301 |
| `itsm.fields` | Custom Fields | `itsm` | 310 |
| `itsm.fields.layouts` | Layout Designer | `itsm.fields` | 311 |
| `itsm.sla` | SLA Management | `itsm` | 400 |
| `itsm.sla.policies` | SLA Policies | `itsm.sla` | 401 |
| `itsm.sla.calendars` | Business Calendars | `itsm.sla` | 402 |
| `itsm.notifications` | Notifications | `itsm` | 500 |
| `itsm.notifications.schemes` | Notification Schemes | `itsm.notifications` | 501 |
| `itsm.notifications.templates` | Email Templates | `itsm.notifications` | 502 |
| `itsm.notifications.inbox` | My Notifications | `itsm.notifications` | 503 |
| `itsm.reports` | Reports | `itsm` | 600 |
| `itsm.reports.sla` | SLA Compliance Reports | `itsm.reports` | 601 |
| `itsm.reports.agent` | Agent Performance | `itsm.reports` | 602 |
| `itsm.dashboards` | Dashboards (config) | `itsm` | 610 |
| `itsm.admin` | ITSM Administration | `itsm` | 900 |
| `itsm.admin.roles` | Roles & Permissions | `itsm.admin` | 901 |

## 3. Seeded Default Grants

`seed_rbac()` assigns:
- **Supervisor** → full CRUD (`read+create+update+delete`) on **every** module.
- **Agent** → three tiers:
  - **RW** (`read+create+update`, **no delete**): `itsm.dashboard`, `itsm.tickets` (+ `.queue`, `.create`, `.bulk`, `.comments`, `.comments_private`, `.watchers`, `.links`, `.templates`), `itsm.canned_notes`, `itsm.reports` (+ `.sla`, `.agent`), `itsm.dashboards`.
  - **RO** (`read` only): `itsm`, `itsm.projects`, `itsm.groups`, `itsm.workflows`, `itsm.fields`, `itsm.sla`.
  - **No access** (all bits false): everything else — notably `itsm.projects.config`, `itsm.workflows.transitions`, `itsm.fields.layouts`, `itsm.sla.policies`, `itsm.sla.calendars`, `itsm.notifications*` (except inbox via inheritance considerations), `itsm.admin*`.

> Note: Agent has **no explicit row** for `itsm.notifications` or `itsm.notifications.inbox` in the seed; because the closest ancestor with a row is `itsm` (read‑only for Agent), an Agent can **read** their own inbox but not configure schemes/templates. Supervisor has explicit full CRUD on all notification modules.

## 4. Agent vs Supervisor Capability Matrix

C=create, R=read, U=update, D=delete. ✓ = granted, — = denied.

| Module (capability) | Agent C | Agent R | Agent U | Agent D | Supervisor (CRUD) |
|---|:--:|:--:|:--:|:--:|:--:|
| Tickets — queue / list (`itsm.tickets.queue`) | — | ✓ | — | — | ✓✓✓✓ |
| Tickets — create (`itsm.tickets.create` / `itsm.tickets`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Tickets — update/transition/assign (`itsm.tickets`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Tickets — delete (`itsm.tickets` delete) | — | — | — | — | ✓ |
| Tickets — bulk ops (`itsm.tickets.bulk`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Public comments (`itsm.tickets.comments`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Internal comments (`itsm.tickets.comments_private`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Watchers (`itsm.tickets.watchers`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Ticket links (`itsm.tickets.links`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Ticket templates (`itsm.tickets.templates`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Canned notes (`itsm.canned_notes`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Projects (`itsm.projects`) | — | ✓ | — | — | ✓✓✓✓ |
| Project config / ticket types (`itsm.projects.config`) | — | — | — | — | ✓✓✓✓ |
| Groups / routing (`itsm.groups`) | — | ✓ | — | — | ✓✓✓✓ |
| Workflows (`itsm.workflows`) | — | ✓ | — | — | ✓✓✓✓ |
| Workflow builder / transitions (`itsm.workflows.transitions`) | — | — | — | — | ✓✓✓✓ |
| Custom fields (`itsm.fields`) | — | ✓ | — | — | ✓✓✓✓ |
| Layout designer (`itsm.fields.layouts`) | — | — | — | — | ✓✓✓✓ |
| SLA (`itsm.sla`) | — | ✓ | — | — | ✓✓✓✓ |
| SLA policies (`itsm.sla.policies`) | — | — | — | — | ✓✓✓✓ |
| Business calendars (`itsm.sla.calendars`) | — | — | — | — | ✓✓✓✓ |
| Notification schemes (`itsm.notifications.schemes`) | — | — | — | — | ✓✓✓✓ |
| Email templates (`itsm.notifications.templates`) | — | — | — | — | ✓✓✓✓ |
| In‑app inbox (`itsm.notifications.inbox`) | — | ✓¹ | — | — | ✓✓✓✓ |
| Reports — SLA (`itsm.reports.sla`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Reports — agent (`itsm.reports.agent`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Dashboards (`itsm.dashboards` / `itsm.dashboard`) | ✓ | ✓ | ✓ | — | ✓✓✓✓ |
| Administration (`itsm.admin`) | — | — | — | — | ✓✓✓✓ |
| Roles & permissions (`itsm.admin.roles`) | — | — | — | — | ✓✓✓✓ |

¹ Agent inbox read is granted via inheritance from `itsm` (read‑only), not an explicit row.

**Summary:** Agent = read/create/update on ticket‑work modules (no delete, no config/admin); Supervisor = everything an Agent does **plus** delete and full config/admin. **Admin** holds the same full CRUD as Supervisor (the owner tier). So **ticket delete** (`itsm.tickets` delete) is the default of the **lead (Supervisor) + Admin** tiers only — a grantable RBAC bit (editable per role in the roles matrix), never hardcoded, and backfilled into existing tenants by `itsm_rbac/0008_grant_ticket_delete_lead_admin`.

## 5. Per‑Action `module_code` Overrides

A custom `@action` can override its module by setting a `module_code` attribute on the handler. `_resolve_module_code()` prefers the per‑action override over the view‑level `module_code`. This enables two key fine‑grained gates:

### 5.1 Private comments
The `TicketViewSet.comments` action lists comments. When listing, the view filters out private comments for users **without** the private grant:

```python
qs = ticket.comments.filter(is_deleted=False).select_related("author")
if not check_permission(request.user, "itsm.tickets.comments_private", "read"):
    qs = qs.filter(visibility="public")
```

So visibility of internal comments is enforced at the data layer keyed on `itsm.tickets.comments_private`, independent of the view's default `itsm.tickets` module. (Both Agent and Supervisor hold this grant in the seed; remove it from a custom role to make a "public‑only" agent.)

### 5.2 Bulk operations
Bulk endpoints (M2) are gated by `itsm.tickets.bulk` via a per‑action `module_code` override, so a role can be allowed single‑ticket edits while being denied destructive/bulk fan‑out — or vice‑versa.

## 6. Admin Surface for Roles

| Endpoint | Module | Notes |
|---|---|---|
| `GET /modules` | `itsm.admin.roles` | Read‑only module catalogue (drives the role editor tree), unpaginated. |
| `… /roles` (CRUD) | `itsm.admin.roles` | `is_system` roles are read‑only on that flag and cannot be deleted. |
| `PUT /roles/{id}/permissions` | `itsm.admin.roles` | Bulk‑set a role's grants; clears the permission cache. |
| `… /role-permissions` (CRUD) | `itsm.admin.roles` | Single‑row grant edits; clears cache on update. |
| `… /role-assignments` (CRUD) | `itsm.admin.roles` | Bind users to roles; clears cache. |

The login response and `/auth/me` embed a **flattened permission map** (`{module_code: {read,create,update,delete}}`) built by `build_permission_map()`, used by the frontend to gate nav and controls.

## 7. Update 2026-10-18 — bug-fix batch (S6, S7, R1, G8, S8)

### 7.1 The four previously unchecked modules are enforced (S7)
| Module | Enforced at | Notes |
|---|---|---|
| `itsm.tickets.create` | `TicketViewSet.create` (+ Create menu / New ticket in the UI) | Portal, email and catalog intake are untouched. |
| `itsm.reports.sla` | `itsm_reporting.views.REPORT_MODULES`: `sla-compliance`, `sla-breach-list`, `sla-at-risk-list`, `sla-breached-open-list` (+ exports) | Dashboard SLA tiles hidden without it. |
| `itsm.reports.agent` | `agent-performance` (+ export) | Leaderboard hidden without it. |
| `itsm.portal.approvals` | `permissions.CanUseApprovalInbox` on `approval-requests/my-pending`, `approve`, `reject` | Read. Users with **no ITSM role** are exempt (data-driven approver check only); superusers bypass. The portal nav, portal home card and agent approvals bell follow it. |

Migration `itsm_rbac/0014_backfill_enforced_module_grants` writes **explicit** rows equal to each role's current effective access (inherited bits made explicit; soft-deleted rows revived). Nobody gains or loses access on deploy. `build_permission_map` emits explicit rows only.

UI gates now match the API. The Layout tab uses `itsm.fields.layouts:update`; Routing uses `itsm.groups` create/delete.

### 7.1b `itsm.approvals.send` — Send for approval (added 2026-10-24)
| Module | Enforced at | Admin | Supervisor | Agent | Requestor / custom |
|---|---|---|---|---|---|
| `itsm.approvals.send` | `approval-requests/send-options` (read), `send/` + `withdraw/` (create); `send.can_withdraw` (delete = others' requests) | CRUD | CRUD | R C U | none (explicit row) |

Migration `itsm_rbac/0015_seed_approvals_send_module` (create-only). The ticket header's **Send for approval** button follows create; anyone can withdraw what they sent.

### 7.2 `itsm.admin.audit` (G8)
New module (migration `itsm_core/0016_audit_module`) gating the admin & security audit log (`GET audit-events/`, `facets/`, `export/`).
- **Admin:** CRUD.
- **Supervisor, Agent, Requestor:** explicit deny.
- **Custom roles:** inherit from `itsm.admin`.

Users re-fetch `/auth/me` to see it.

### 7.3 Deleted roles grant nothing (R1)
`services.get_user_role` ignores a soft-deleted (or inactive) role as well as a soft-deleted assignment. Before deploying, list users still assigned to a deleted role (SQL in `docs/QA_CHECKLIST.md` "Bug-fix batch"); they lose access.

### 7.4 Backend guards (S6)
- **Roles:**
  - Built-in (`is_system`) roles can't be deleted, and their `code` / `is_active` are read-only.
  - A role still assigned to users → 400 on delete. Roles expose `user_count`.
- **Users:** `set_active` refuses superusers and system bots (`is_system_account`) with a 400. The permission cache is invalidated on role-permission create/destroy.
- **Console:** `tenants.services.org_user_guard` keeps ≥1 active superuser per org and protects the bots.

### 7.5 Legacy `/users/` (S8)
`/api/v1/[t/<org>/]users/` is read-only and needs `itsm.tickets` read (`IsItsmAgent`). It returns a minimal directory (`id, username, full_name, email`; active users, no bots). User writes only go through `itsm.admin.roles` (Users admin). The legacy session login routes are removed.

### 7.6 Other scoping fixes
- `approval-requests/start/` needs `itsm.approvals` create + project access (A1). The list is clamped to accessible helpdesks + own + approver (A2).
- `/kb-articles/`: non-authors see only published portal articles. `/kb-article-links/` is authors-only (K1).
- Routing rules are clamped to the caller's helpdesks; global rules are superuser-only writes (R3).
- Widget data is limited to own or shared dashboards (R2).
- Saved views are scoped to their queue/helpdesk (S5). Owners can delete their own views without the queue-module Delete bit (C6).

## 8. Update 2026-10-19 — Asset Management modules
| Code | Name | Parent | Sort | Category | Admin | Supervisor | Agent | Requestor / custom roles |
|---|---|---|---|---|---|---|---|---|
| `itsm.assets` | Assets | `itsm` | 260 | Screens | CRUD | CRUD | read, create, update | none |
| `itsm.assets.import` | Asset Import | `itsm.assets` | 261 | Screens | CRUD | CRUD | none | none |
| `itsm.assets.config` | Asset Configuration | `itsm.assets` | 262 | Settings | CRUD | CRUD | read | none |

- Existing orgs are backfilled by `itsm_assets/0003_rbac_modules`: create-only, explicit rows for every live role (custom roles get no access, matching the frontend's exact-key `hasPerm`). A hand-edited row is never overwritten.
- The configuration lists (statuses, masters, categories, fields) and the `asset-users/` picker are readable with **either** `itsm.assets` or `itsm.assets.config` read (`AssetLookupPermission`).
- Import's "create missing vendors, locations and departments" needs `itsm.assets.config` create as well.
- Config writes are in the admin audit log (`AUDITED_AREAS["itsm.assets.config"]`).

