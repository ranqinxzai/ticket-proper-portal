# itsm-rbac — Interlinking

## Provides to everyone
- **`ItsmModelViewSet`** (`permissions.py`) — the base class **every** ITSM ViewSet extends. It
  wires `HasModulePermission` and soft-delete `perform_destroy`.
- **`HasModulePermission`** + **`check_permission`** — the enforcement primitives. e.g.
  `itsm_tickets.views` calls `check_permission(user, "itsm.tickets.comments_private", "read")` to
  decide whether to include private comments in the comments list.
- **`get_user_role(user)`** — used by the workflow engine's `role_in` condition.
- **`build_permission_map` / `ItsmUserSerializer`** — the login + `auth/me` payload the frontend
  guard reads.

## Depends on
- **itsm-core** — `BaseModel` for its models.
- **accounts.User** — the shared login identity (`settings.AUTH_USER_MODEL`); RBAC binds a role to
  it via `RoleAssignment`. ITSM does not modify the User model.

## Module codes consumed by other apps
Every other app's ViewSet names an `itsm.*` module defined in this app's `registry.py`. The
registry is the contract: adding a feature gated by a new module means adding it to `MODULES` and
re-seeding. See each module skill's SKILL.md "RBAC module codes" section.
