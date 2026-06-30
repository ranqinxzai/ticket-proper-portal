# itsm-rbac — Bug Log / Gotchas

- **"User of org A could see org B's data" was a STALE BROWSER SESSION, not a server leak
  (fixed 2026-06-28).** The DB/API were already isolated (schema-per-org + the `tenant` JWT
  claim → 401 on cross-org access). The real cause: the ITSM client stored tokens in a *single
  global* localStorage slot (`itsm_access`, …), so a browser previously logged into another org
  carried that org's *live* session — the "org-A user" was literally still authenticated as
  org B. Fix = namespace session keys per org (`orgKey()` in `client.ts` → `itsm_access:<org>`).
  Lesson: server isolation isn't enough — **client session storage must be org-scoped too**, or
  one browser blurs two orgs. Don't chase a phantom backend leak when the symptom is "normal use,
  same browser, only one account": check localStorage first.
- **The token-refresh endpoint bypassed the tenant check until 2026-06-28.** `auth/refresh/` used
  the stock `TokenRefreshView`, which validates only the signature (the endpoint is anonymous —
  refresh token in the body). A cross-org refresh token would mint a fresh access token. Now
  `apps.tenants.jwt.TenantAwareTokenRefreshView` checks the refresh token's `tenant` claim.
  **Put it in `jwt.py`, NEVER `auth.py`** — `auth.py` is imported during DRF settings init, and
  importing `rest_framework_simplejwt.views` there is a circular import (`manage.py check` dies
  with "Module apps.tenants.auth does not define a TenantAwareJWTAuthentication attribute").
- **Session/Basic auth skip the tenant check — keep them out of prod (2026-06-28).** Only
  `TenantAwareJWTAuthentication` enforces the org binding. `DEFAULT_AUTHENTICATION_CLASSES` now
  drops Session+Basic when `DEBUG=False` (`_AUTH_CLASSES` in `settings.py`); they return only
  under DEBUG for the browsable API. Don't re-add them globally.
- **Login was case-sensitive on the email/username (fixed 2026-06-24).** The JWT login goes through
  simplejwt → Django `authenticate()` → default `ModelBackend`, which matches `USERNAME_FIELD`
  **case-sensitively**. Since logins are email-shaped, `Shekhar@ticket.com` failed against a stored
  `shekhar@ticket.com`. Fixed with `apps.accounts.backends.CaseInsensitiveModelBackend` in
  `settings.AUTHENTICATION_BACKENDS` (exact → `username__iexact` → `email__iexact`). The legacy
  session `LoginView` already had an `email__iexact` fallback; the JWT path did not. Don't "fix" this
  per-serializer — the backend covers ITSM JWT, platform-admin JWT, and session login at once.
- **Closest ancestor wins — a grant on a parent satisfies children.** `check_permission` stops at
  the first ancestor in the chain that has an explicit `RoleModulePermission` row. So granting
  `itsm.tickets` (read=true) covers `itsm.tickets.comments` even with no row on the child. Watch
  this when you intend to *deny* a child: you must add an explicit child row that denies, because
  an inherited parent grant would otherwise allow it.
- **Cache must be invalidated on every permission write.** `check_permission` caches for 5 min.
  Any code path that edits roles/grants/assignments must call `invalidate_permission_cache()`
  (clears the whole cache). The built-in ViewSets do; new admin write paths must too, or stale
  grants linger up to 5 minutes.
- **`module_code = None` allows any authenticated user.** Intentional for utility endpoints
  (`MeView`), but don't forget to set `module_code` on real resources or you've opened them up.
- **Private comments / bulk rely on the per-action override.** Gating for those depends on the
  handler carrying its own `module_code` attribute (e.g. `@action ... ; comments.module_code =
  "itsm.tickets.comments_private"`). If the override isn't set, the view-level `itsm.tickets`
  module is used and private comments leak to anyone with ticket read.
- **Plan vs code: it's `RoleAssignment`, not a `system_role` FK on User.** Anything referencing
  `user.system_role` is wrong; use `user.itsm_role_assignment.role` / `get_user_role(user)`.
- **One role per user.** `RoleAssignment.user` is OneToOne — a second assignment for the same user
  raises an IntegrityError. Multi-role is a future expansion.
- **`role` on assignment is PROTECT.** You can't delete a `SystemRole` that still has assignments;
  reassign users first.
- **Superusers always pass** and report `role = supervisor` in `auth/me` even without an
  assignment — they bypass the resolver entirely.
