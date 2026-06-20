# itsm-helpdesks — Interlinking

## Depends on
- **itsm-core** — `BaseModel`.
- **itsm-rbac** — `ItsmModelViewSet` + module `itsm.admin.helpdesks` (parent `itsm.admin`; in
  `AGENT_RO_MODULES`); `seed_memberships()` reads `RoleAssignment` to find real agents;
  `ItsmUserSerializer.helpdesks` calls `build_helpdesk_membership`.

## Depended on by — the 8 scope guards
Row-level scope is enforced by the shared `services.py` primitives (`accessible_helpdesk_ids`,
`resolve_helpdesk_scope`, `scope_ticket_queryset`, `is_project_accessible`, `helpdesk_member_ids`),
imported wherever tickets are read or written. All 8 leak without their guard:

1. **itsm-tickets / query_builder** — `build_q` / `filtered_tickets` gained an
   `accessible_helpdesk_ids` kwarg that ANDs `project__helpdesk_id__in` (closes saved-filter
   results, widget data, bulk-by-filter).
2. **itsm-tickets** — `TicketViewSet._bulk` **ids** branch clamps `project__helpdesk_id__in`
   (the filter branch is covered by #1).
3. **itsm-tickets** — `TicketViewSet.get_queryset` filters + applies the `?helpdesk` clamp; detail/
   transition/assign/comments derive from it, so a cross-helpdesk id 404s.
4. **itsm-tickets** — `create` / `links` / `apply_template` reject an inaccessible
   project/target/template (**403**, via `is_project_accessible`).
5. **itsm-reporting** — `reports._base` + `sla_compliance` take `helpdesk_ids`;
   `ReportViewSet.retrieve` validates `?project` and keeps the clamp on the TypeError retry.
6. **itsm-dashboards** — `SavedFilter.results` + `WidgetViewSet.data` + `widget_data.resolve`
   thread `accessible_helpdesk_ids`.
7. **itsm-sla** — `SLATrackerViewSet.get_queryset` filters `ticket__project__helpdesk_id__in`.
8. **itsm-tickets** — ticket-comments POST restricts `@mention` user ids to the ticket's helpdesk
   members (`helpdesk_member_ids`).

## Structural FKs added to siblings
- **itsm-projects** — `Project.helpdesk` (non-null, CASCADE, `related_name="projects"`); partial
  `UniqueConstraint(helpdesk, project_type)` for default incident/request; `ProjectSerializer`
  exposes `helpdesk`/`helpdesk_key`/`helpdesk_name`/`project_type`; `ProjectViewSet` scoped + honors
  `?helpdesk`; `perform_create` rejects an inaccessible helpdesk.
- **itsm-groups** — `Group.helpdesk` (nullable, SET_NULL; null = shared/global). Seed makes one
  namespaced Service Desk group per helpdesk plus the 4 shared global teams.

## auth/me payload
`ItsmUserSerializer.helpdesks` → `build_helpdesk_membership(user)` →
`[{id,key,name,icon,color}]` (superuser ⇒ all active). Present in `auth/me` AND the login token
serializer; drives the frontend Home selector + HelpdeskSwitcher.

## Seed order
`seed_itsm` STEPS: RBAC → **Helpdesks** → workflows → SLA → notifications → Groups(per-helpdesk svc
desk) → Projects(per-helpdesk ITINC/ITREQ/HRINC/HRREQ) → templates(per-helpdesk) → email →
**Helpdesk memberships** (last). Workflows / SLA / notifications stay **global** (shared) — looked up
by project with an `is_default` fallback that still fires for per-helpdesk projects.
