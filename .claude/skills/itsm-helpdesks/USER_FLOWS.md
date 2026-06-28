# itsm-helpdesks — User Flows

## Flow A — Agent logs in → Home selector → pick helpdesk → scoped queue
1. Agent logs in. The login token serializer + `GET auth/me` return `helpdesks`
   (`build_helpdesk_membership` → `[{id,key,name,icon,color}]`, only the agent's active memberships).
2. Agent lands on `/agent` (the **Home**). Under the *minimal* top bar (company logo + "One Helpdesk"
   wordmark + profile menu) Home renders **"Select Helpdesk"** — a **card per accessible helpdesk**
   (each card shows the seeded `helpdesk.icon` via `lib/itsm/icon-map.tsx`) plus a right-side
   **attention rail**: assigned-to-me, SLA-at-risk (approximated via `due_date`), unread notifications.
3. Agent clicks a helpdesk card (e.g. IT) → navigates to `/agent/w/IT`. The **route param is the
   selection** (no localStorage); `WorkspaceProvider`/`useWorkspace` resolves the helpdesk + its
   projects. AgentShell drops its bar and the **consolidated workspace header** takes over
   (app-switcher · IT icon+name · Dashboard + Incident/Request tabs · Create · approvals · config ·
   profile). Switching helpdesk / going Home is the app-switcher dropdown.
4. The queue + create flow scope projects to the selected helpdesk (the Create dropdown lists that
   helpdesk's projects → each project's new-ticket form). The helpdesk key threads to the API as the
   advisory `?helpdesk=<key>`; `GET tickets/?helpdesk=IT` returns only IT tickets.
5. The server **always re-clamps**: `resolve_helpdesk_scope` intersects `?helpdesk` with the agent's
   accessible set. If the agent forges `?helpdesk=HR`, it's ignored — they see their own helpdesks
   only, never an HR ticket. Cross-helpdesk ticket id ⇒ 404; cross-helpdesk create/link ⇒ 403.

## Flow B — Supervisor defines a helpdesk in /admin/helpdesks + adds members
1. Supervisor opens `/admin/helpdesks` (module `itsm.admin.helpdesks`; agents see it read-only).
2. **Create:** `POST helpdesks` `{ name:"Facilities Helpdesk", key:"FAC", color, icon }`. `key` is
   validated (uppercase, 2–5) and must be unique; `created_by` is stamped server-side.
3. (Seeding/admin then provisions the helpdesk's default Incident + Request projects `FACINC`/
   `FACREQ` and its namespaced Service Desk group; workflows/SLA/notifications stay global and are
   resolved by `is_default` fallback.)
4. **Add members:** `POST helpdesks/{id}/add_member` `{ user, role_in_helpdesk:"lead"? }`
   (idempotent — re-adds a previously removed member). `GET helpdesks/{id}/members` lists them.
5. **Remove:** `POST helpdesks/{id}/remove_member` `{ user }` → soft (`is_active=False`). The user
   immediately loses access to that helpdesk's tickets on their next request.
6. **Retire a helpdesk:** `PATCH helpdesks/{id}` `{ status:"archived" }` — drops it out of every
   accessible set without deleting its projects/tickets. Never soft-delete (doesn't cascade).

## Flow D — Admin manages helpdesks from Home (`/agent/admin/helpdesks`)
1. A manager (superuser, or `itsm.admin.helpdesks:update/create`) sees a **gear** in the Home bar
   (`agent-shell.tsx`); plain agents don't. It links to `/agent/admin/helpdesks`.
2. The page (`components/admin/helpdesks-admin.tsx`) lists **all** helpdesks — managers' `get_queryset`
   is unclamped, so `inactive`/`archived` ones show too (agents who reach the URL get a read-only,
   membership-scoped list + `ReadOnlyBanner`).
3. **Create** → `helpdesk-create-dialog.tsx` `POST helpdesks` (name/key/icon/colour/desc); `order` is
   auto-assigned max+1. **Disable/enable** → a `Switch` `PATCH {status:'inactive'|'active'}`. **Reorder**
   → drag (`@dnd-kit`) `POST helpdesks/reorder {order:[ids]}`.
4. Each change calls `refreshUser()` (re-fetches `auth/me`) so the admin's own Home cards update
   immediately; other agents pick up the new order/visibility on their next `auth/me`.

## Flow C — Seeded bootstrap
`seed_itsm` creates IT + HR helpdesks, each with its own ITINC/ITREQ (HRINC/HRREQ) projects and
Service Desk group, then `seed_memberships()` enrolls every role-assigned non-superuser into all
active helpdesks — so the product is multi-department and demoable right after migrate + seed.
Superusers need no membership: they get unrestricted access via the `None` sentinel.
