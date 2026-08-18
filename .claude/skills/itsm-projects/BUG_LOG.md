# itsm-projects — Bug Log / Gotchas

- **Project-settings tab bar must be `h-auto` when it wraps (fixed 2026-07-02).** The shared
  `TabsList` (`components/ui/tabs.tsx`) is a fixed one-row **`h-9`**; the project settings page
  (`.../settings/projects/[projectKey]/page.tsx`) has 11 triggers + `flex-wrap`, so the last tab
  (**Priority Matrix**, Incident-only) wrapped to a second row that overflowed *below* the muted
  bar and read as a stray "Priority Matrix" heading on **every** tab (looked un-clickable → "the
  setting is missing"). Fix = add **`h-auto`** to that page's `TabsList` (twMerge overrides the base
  `h-9`) so the bar grows to fit the wrapped row. Don't put a fixed height on a wrapping `TabsList`.

- **A project with no `default_workflow` can't create tickets.** `ticket_service.create_ticket`
  raises `ValueError("Project has no default workflow configured.")`. The seed wires it; a custom
  project created via the API must set one before tickets can be opened.
- **`default_workflow` is PROTECT.** Deleting a workflow that any project uses as its default is
  blocked at the DB level. Re-point the project first.
- **`key` is immutable in spirit.** It prefixes every ticket number. Changing a project's `key`
  after tickets exist would make new tickets use the new prefix while old `ticket_number`s keep the
  old — there's no rename migration. Treat `key` as write-once.
- **Config FKs aren't on the model yet.** `sla_policy`/`notification_scheme`/`field_layout`/
  `calendar` are planned additions (M3/M5/M6). Don't assume `project.sla_policy` exists today.
- **Soft delete doesn't cascade to tickets.** Soft-deleting a project hides it from `objects` but
  its tickets (PROTECT FK to project) remain; you can't hard-delete a project with tickets.
- **`TicketType.is_default` isn't enforced unique per project.** Two types could both be
  `is_default=True`; the create wizard should pick the first. Set carefully in seeds/admin.
