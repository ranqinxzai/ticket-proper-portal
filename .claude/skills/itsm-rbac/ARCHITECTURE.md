# itsm-rbac — Architecture

## Layout
```
itsm_rbac/
  models.py        # Module, SystemRole, RoleModulePermission, RoleAssignment
  registry.py      # MODULES (source of truth), seed_rbac()
  permissions.py   # HasModulePermission, ItsmModelViewSet base class
  services.py      # check_permission, get_user_role, invalidate_permission_cache
  serializers.py   # JWT token + user/permission map + model serializers
  views.py         # login/me + module/role/permission/assignment ViewSets
  urls.py          # router + auth/login|refresh|me
```

## Permission model
- **Tree with inheritance.** `Module.code` is dot-notation; `check_permission` builds the ancestor
  chain (`itsm.tickets.bulk → itsm.tickets → itsm`) and the **closest ancestor with an explicit
  RoleModulePermission row decides** (it does not require a grant on the exact node).
- **Method → action map** lives in `permissions.py`: GET/HEAD/OPTIONS→read, POST→create,
  PUT/PATCH→update, DELETE→delete.
- **Per-action `module_code` override.** `_resolve_module_code` first looks at the handler for the
  current `view.action`; if that handler has a `module_code` attribute it wins over the view-level
  one. This is how private comments (`itsm.tickets.comments_private`) and bulk ops
  (`itsm.tickets.bulk`) get distinct gating from the same ViewSet.
- **Superuser bypass.** `check_permission` returns True for `is_superuser` before any role lookup.
- **No module declared = authenticated-only.** A view with `module_code = None` allows any logged-in
  user (a deliberate fail-soft for utility read endpoints like `MeView`).

## Caching
`check_permission` caches the boolean per `(role.id, module_code, action)` for 5 minutes in
Django's default cache. `invalidate_permission_cache()` calls `cache.clear()` (LocMem has no
pattern delete; a full clear is acceptable for the small admin surface). **Every role/permission
write site calls it** (`SystemRoleViewSet`, `RoleModulePermissionViewSet`, `RoleAssignmentViewSet`,
the bulk `permissions` action).

## Roles & seeding
- `seed_rbac()` (in `registry.py`, called first by `seed_itsm`): upserts all `MODULES`, wires
  parents in a second pass (order-independent), then seeds **Agent** + **Supervisor**.
- **Supervisor** = full CRUD on every module.
- **Agent** = read/create/update (no delete) on `AGENT_RW_MODULES` (ticket modules, canned notes,
  reports, dashboards); read-only on `AGENT_RO_MODULES` (`itsm`, projects, groups, workflows,
  fields, sla); no access elsewhere (admin, notification schemes/templates, sla policies, etc.).
- Idempotent: re-running resets only the two seeded system roles; custom roles are never clobbered.

## JWT auth
- `ItsmLoginView` extends SimpleJWT's `TokenObtainPairView` with `ItsmTokenObtainPairSerializer`,
  which adds a `user` block (id/username/full_name/email/is_superuser/role/permissions) to the
  login response and stamps `username`/`is_superuser` into the access token.
- `build_permission_map(user)` returns `{module_code: {read,create,update,delete}}` for UI gating
  (superusers get the whole tree True).
- `auth/refresh` is SimpleJWT's `TokenRefreshView`; `auth/me` is `MeView` (IsAuthenticated).

## Design decisions
- **`RoleAssignment` OneToOne instead of a FK on User.** Keeps `accounts.User` untouched (ITSM is
  a guest in the host project) and reserves a clean multi-role expansion path. Resolver reads
  `user.itsm_role_assignment`.
- **Registry is code, not data.** `MODULES` in `registry.py` is the canonical tree; the DB is just
  a materialized copy refreshed by the seed. Edit the registry → re-seed.
