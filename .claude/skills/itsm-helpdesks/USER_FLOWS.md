# itsm-helpdesks — User Flows

## Flow A — Agent logs in → Home selector → pick helpdesk → scoped queue
1. Agent logs in. The login token serializer + `GET auth/me` return `helpdesks`
   (`build_helpdesk_membership` → `[{id,key,name,icon,color}]`, only the agent's active memberships).
2. Root `/` redirects to `/home`. Home renders a **card per accessible helpdesk** plus a right-side
   **attention panel** sourced from existing data only: assigned-to-me, SLA-at-risk (approximated via
   `due_date`), unread notifications. No approval engine this phase.
3. Agent clicks a helpdesk card (e.g. IT). `HelpdeskProvider`/`useSelectedHelpdesk`
   (`lib/itsm/helpdesk.tsx`, localStorage) records the selection; the `ItsmShell` HelpdeskSwitcher
   dropdown reflects it. The selection is **advisory** — sent as `?helpdesk=<id|key>`.
4. The queue + create wizard scope projects to the selected helpdesk (the create wizard auto-selects
   that helpdesk's **Incident** project). `GET tickets/?helpdesk=IT` returns only IT tickets.
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

## Flow C — Seeded bootstrap
`seed_itsm` creates IT + HR helpdesks, each with its own ITINC/ITREQ (HRINC/HRREQ) projects and
Service Desk group, then `seed_memberships()` enrolls every role-assigned non-superuser into all
active helpdesks — so the product is multi-department and demoable right after migrate + seed.
Superusers need no membership: they get unrestricted access via the `None` sentinel.
