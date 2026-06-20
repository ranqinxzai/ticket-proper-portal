# itsm-helpdesks — Architecture

## Layout
```
itsm_helpdesks/
  models.py       # Helpdesk, HelpdeskMembership, HelpdeskStatus, KEY_VALIDATOR
  services.py     # the scoping primitives every ticket-facing query reuses
  serializers.py  # read (HelpdeskSerializer) / write (HelpdeskWriteSerializer) / HelpdeskMembershipSerializer
  views.py        # HelpdeskViewSet (+ member actions), HelpdeskMembershipViewSet
  urls.py         # helpdesks, helpdesk-memberships
  seed.py         # run(): IT + HR · seed_memberships(): enroll role-assigned non-superusers
```

## Design decisions
- **The Helpdesk is a workspace, the Project is still the ticket container.** A helpdesk owns its
  own default Incident + Request projects (seeded as `ITINC`/`ITREQ`/`HRINC`/`HRREQ`). The
  `key` becomes the per-helpdesk ticket-number prefix, so prefixes can never collide across
  departments. Kept ≤ 5 chars so `<key>INC` still satisfies `Project.KEY_VALIDATOR` (≤ 10).
- **Scoping lives in `services.py`, not in one viewset.** Putting the row-level rule only in
  `TicketViewSet.get_queryset` would leak through every other surface (saved filters, widget data,
  reports, bulk-by-filter, SLA tracker). The shared primitives are the single source of truth and
  every consumer imports them. See INTERLINKING for the 8 guards.
- **`None` is the "unrestricted" sentinel, not "no access".** `accessible_helpdesk_ids(user)`
  returns `None` for superusers; callers must treat `None` as "apply no helpdesk filter".
  A regular user with no memberships gets `[]`, which correctly hides everything.
  `scope_ticket_queryset(qs, None)` returns `qs` unchanged.
- **`?helpdesk=` is advisory, intersected, never an authz boundary.** `resolve_helpdesk_scope`
  resolves the param (UUID id or short key, case-insensitive) and narrows to it **only if** the user
  may access it; otherwise it is silently ignored. A forged/foreign value can never widen scope and
  never 403s the request — it's a *view scope*. (403s come from explicit write guards, not from this.)
- **Per-request memoisation.** `accessible_helpdesk_ids_cached(request)` caches the (one) membership
  query on the request object so a single response that touches scope many times pays for it once.
- **Read/write serializer split + member actions.** `HelpdeskViewSet.get_serializer_class` returns
  `HelpdeskWriteSerializer` (no `status` exposure via the member-list read shape; write controls it)
  for create/update, `HelpdeskSerializer` (adds computed `member_count`) for reads. `members` /
  `add_member` (idempotent `update_or_create`) / `remove_member` (soft `is_active=False`) are
  detail actions. `get_queryset` clamps the admin list itself to the caller's accessible helpdesks,
  so the admin list mirrors Home access (superuser sees all).
- **Retire, don't delete.** `status='archived'` drops a helpdesk out of `accessible_helpdesk_ids`
  (active-helpdesks-only filter) without touching its projects/tickets/memberships. Soft delete is
  avoided because `BaseModel.soft_delete()` does not cascade.

## Seeding
`seed.py::run()` runs after RBAC and before groups/projects. It `get_or_create`s IT + HR by `key`
(idempotent). `seed_memberships()` runs **last** (after users/roles/helpdesks exist): it enrolls
every user with an active ITSM `RoleAssignment` (excludes the email bot, which has no role, and
superusers, who get unrestricted access via the `None` sentinel) into all active helpdesks.
