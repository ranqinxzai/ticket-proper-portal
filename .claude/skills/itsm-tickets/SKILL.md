# itsm-tickets

## Purpose
The heart of the platform. `Ticket` carries the standard ITIL fields as first-class
(indexed) columns; comments (public/internal), watchers, links, and attachments hang off it;
`ticket_service` is the single write site for create/assign/comment/**update**, and `numbering`
generates `INC-1` style numbers under a row lock. Status changes go through the **workflow
engine**; custom fields live in the **field engine**. *(`CannedNote`/`TicketTemplate` are
planned — see the itsm-canned-notes / itsm-templates skills.)*

## Update (2026-06-28) — Portal "Create Request": auto-skip single-option steps
- **Request:** in the Service Portal, don't make the requestor click through a picker that has
  exactly one choice. When only **one** workspace (helpdesk) is configured, skip the workspace step;
  when the chosen workspace has only **one** active project, skip the project step — landing straight
  on the form. One helpdesk + one project ⇒ "Create Request" opens the form in a single click.
- **Where:** purely the three intake routes under `app/t/[org]/(portal)/portal/create-request/`
  (`page` → `[helpdeskKey]` → `[helpdeskKey]/[projectKey]`). No backend change — the intake endpoints
  already return only create-eligible sets, so a returned length of 1 *is* "one configured option"
  (`GET workspaces/` = active helpdesks with ≥1 eligible project; `GET projects/?helpdesk=` =
  active projects with ≥1 ticket type).
- **Forward skip:** each picker, after its fetch, calls `router.replace(...)` (not `push`) when its
  list has length 1, leaving its list state `null` so the existing loading spinner stays up instead of
  flashing a one-card list. `replace` keeps the history stack clean so the browser Back button returns
  to portal home / the workspace picker, never a page that immediately bounces forward.
- **Back-link correctness:** the in-page "back" controls are derived from the actual counts so they
  never point at a step that auto-skips. New pure helpers in `lib/itsm/nav.ts`:
  `portalCreateRequest`, `portalCreateRequestHelpdesk`, and `createRequestWorkspaceBack(org, soloWorkspace)`
  (→ Home when one helpdesk, else the workspace picker). Step 2's "back" reads **Home** vs **All
  workspaces** off a cheap extra `workspaces()` fetch; Step 3's "Back" skips the project picker
  (`soloProject`, from its existing project fetch) → Home/workspace-picker when there's a single project,
  else the project picker. Failed count fetch defaults to "multiple" (safe: a harmless extra hop, no loop).
- **Unchanged:** 0-workspace / 0-project empty states; the form (step 3) behavior — it's just reached
  sooner. `tsc --noEmit` clean.

## Update (2026-06-28) — Live silent refresh of the ticket queue (Jira-style polling, no new infra)
- **Goal:** the queue/list stays live — a ticket created or transitioned by another agent (or inbound
  email) appears without a hard refresh. Chosen mechanism after fact-checked research: **client-side
  polling + a cheap change-token**, NOT SSE/WebSockets (the app runs **gunicorn 3 sync workers** — a
  long-lived stream would pin a worker each and starve the pool; this is also exactly what Jira's boards
  do — ~30s polling + a "refresh" affordance, *not* push).
- **Backend — new `pulse` action (read-only, additive, no migration).** `GET tickets/pulse/` on
  `TicketViewSet` returns `{version, count}` for the **current filter scope**, computed as
  `filter_queryset(get_queryset()).aggregate(Max(updated_at), Count(id, distinct=True))` →
  `version = "<max_updated_at_epoch>:<count>"`. Reusing `filter_queryset(get_queryset())` inherits the
  full helpdesk/project clamp + saved/ad-hoc `q` + search, so it is **tenant-isolated for free**.
  `updated_at` is `auto_now`, so the token moves on any create/update; `count` catches inserts/removals
  (incl. soft-delete, which drops out of the `is_deleted=False` base). Mirror action on
  `PortalTicketViewSet` (`GET portal/requests/pulse/`) scoped to `requestor=request.user`.
- **Frontend — one shared hook `lib/itsm/use-live-poll.ts` (`useLivePoll`).** Polls `pulse()` every
  **15s**, pauses while the tab is hidden (Page Visibility) and runs one catch-up poll on refocus,
  re-seeds its baseline when the scope `key` changes, and guards against overlapping in-flight polls.
  The manual equivalent of TanStack Query's `refetchInterval` + `refetchOnWindowFocus` + pause-when-hidden,
  no dependency added (same shape as the existing `notification-bell.tsx` 60s poll).
- **Hybrid apply (Jira's "board updated" UX).** On a detected change the list refetches the **current
  page silently** (the user-driven path keeps the spinner; the silent path never flips `loading`).
  It applies in place only when the agent is **idle at the top of page 1 and not hovering a row**
  (`page===1 && !tableHoverRef && scrollY<40`); otherwise it stages the result behind a **"N new tickets ·
  Refresh" pill** so rows never shift under an in-progress action. A monotonic `fetchSeq` drops a slow
  fetch superseded by a newer one.
- **Scope:** agent queue (`components/tickets/ticket-queue.tsx`), end-user **My Requests**
  (`app/t/[org]/(portal)/portal/requests/page.tsx`, same hybrid), and the **dashboard KPIs** (silent
  re-compute, no skeleton — see itsm-dashboards). New FE clients: `ticketsApi.pulse`,
  `portalApi.requestsPulse`; `TicketListParams` gained `helpdesk?` (the dashboard pulse scopes by helpdesk).
- **Future upgrade path (documented, not built):** if 15s ever feels too slow, add a **Mercure hub**
  (one container, no Redis/Channels/ASGI change) and have the same `useLivePoll` consumers subscribe via
  native `EventSource` — publish from the existing `transaction.on_commit` hooks. NOT Django Channels
  (Redis + ASGI + cross-tenant socket-leak risk) and NOT in-Django SSE (3-worker starvation).
- Tests: `apps.itsm_tickets.tests.TicketPulseApiTests` (version/count, change-on-create, `q`-filter
  respect, empty-scope `0:0`, portal requestor-scoping). Full `apps.itsm_tickets` suite (107) + `tsc
  --noEmit` clean.

## Update (2026-06-25) — Watchers UI + attachment upload/delete/preview (Jira-style header icons)
- **Bug (ITINC-614):** the agent detail had **no watcher UI at all** (backend endpoints existed; the
  frontend had no `watchersApi`/`Watcher` type), and ticket attachments were **read-only** (no upload/
  delete/preview from the detail view). Both now live as **top-right icon buttons with count badges**
  in the detail header `ml-auto` cluster (`components/tickets/ticket-detail.tsx`), Jira-style, opening a
  Popover. Two new **module-top-level** components: `WatchersPopover` + `AttachmentsPopover` (with a
  shared `CountIconButton`; all hoisted for focus stability).
- **Watchers (`WatchersPopover`):** lists watchers, a **Watch/Unwatch** self-toggle
  (`ticketsApi.watch`/`unwatch` → `/tickets/{id}/watch/` POST/DELETE, self only), per-row **remove**
  (`watchersApi.remove(w.id)` → `DELETE /watchers/{id}/`, keyed off the **watcher row id**, not the user),
  and **add anyone** via the reused `UserSearchCombobox` → `watchersApi.add(ticket, user)`.
- **Attachments (`AttachmentsPopover`):** image **preview** (content-type/extension → thumbnail `<img>`
  linking to the file; non-images → file chip), **download** link, per-file **delete with
  `window.confirm`** (`ticketAttachmentsApi.remove` → `DELETE /ticket-attachments/{id}/`), and **upload**
  (`ticketAttachmentsApi.upload(t.id, f)` now returns the full row → no reload). `t.id` (UUID) keys the
  attachment endpoints, never the number. The read-only `FieldView` attachment block is kept (stays in
  sync via the single parent `attachments` state).
- **Backend fix — `WatcherSerializer` was create-broken.** `user` was `read_only`, so `POST /watchers/`
  could never set the watcher. Added a write-only **`user_id`** (`PrimaryKeyRelatedField`, `source="user"`);
  the nested `user` stays read-only on the response. So `watchersApi.add` posts `{ticket, user_id}`.
  *(Flag, not fixed: `WatcherViewSet` has no helpdesk scoping — pre-existing.)*
- **New FE clients/types:** `ticketsApi.watchers/watch/unwatch`, module-level `watchersApi`,
  `ticketAttachmentsApi.remove` (+ `list`/`upload` now typed `TicketAttachment`); shared `Watcher` +
  `TicketAttachment` (with `content_type`) types in `lib/itsm/types.ts`.
- **Portal parity** (see itsm-helpdesks): the **end-user portal** detail now also shows watchers
  (add/remove **by email**) + attachments (view/download/upload) + a **Reopen** action — see the portal
  + workflow `portal_allowed` updates.
- Tests: `apps.itsm_tickets.tests` `AgentWatcherApiTests` (self-toggle, add-arbitrary via `user_id`, list,
  remove-by-id) + the portal classes. `tsc --noEmit` clean.

## Update (2026-06-24) — Assigned-Technician picker shows a Lead badge
- **Request:** the **Assigned Technician** dropdown already depends on the selected **Assigned Group**
  (it lists that group's active members, leads first), but leads were flagged with bare "(lead)" text
  inside a native `<select>`, which can't render a styled badge.
- **Fix (frontend only):** `components/tickets/group-member-picker.tsx` was rewritten from a native
  `<select>` to a **click-driven Popover** dropdown (pattern of `user-search-combobox.tsx`). Each option
  shows name + `@username` and a small **Lead** badge for `role_in_group === "lead"`; the trigger shows
  the selected technician (+ Lead badge, + muted email since the ticket's assignee `UserRef` now carries
  email). Unchanged: the **group dependency** (still `GET /groups/{id}/members/`, leads-first sort), the
  **"Set a group first"** empty state, the stale-assignee **"(not in group)"** fallback, "Unassigned",
  and the exact prop/`onChange(UserRef|null)` contract — so both call sites (`ticket-detail.tsx` inline
  edit + `ticket-create-form.tsx`) are untouched. The component stays module-top-level; selection is
  click-based (no native-select focus concern). **No backend change** — `role_in_group` was already on
  the members endpoint. The "(lead)" text in the picker is replaced by the badge.

## Update (2026-06-24) — People show email beside the name
- **Request:** standard ITSM tools show a person's **email** next to their name. Add it everywhere a
  person renders — the ticket-detail **People** panel and the queue's person columns.
- **Backend (one shared field):** `UserBriefField.to_representation` (`apps/itsm_tickets/serializers.py`)
  now returns `email` alongside `id/username/full_name`. Because every ticket-embedded user
  (assignee/requestor/created_by/updated_by, comment author, watcher, audit actor) flows through this
  one serializer, the email appears in **all** of them with no other backend change. (`email` is on
  `accounts.User` via `AbstractUser` — no migration.) The agent people-search endpoint (`/users/?search=`,
  accounts `UserSerializer`) already returned `email`.
- **Frontend:** `UserRef` (`lib/itsm/types.ts`) gained optional `email`. Queue cells render via the
  `person()` helper (`components/tickets/queue-columns.tsx`) — now name + muted email second line;
  the **assignee** cell routes through `person()` too (falls back to group/Unassigned). Detail view
  added a module-level **`personWithEmail()`** used for requestor/assignee read-only values + the
  Created-by/Updated-by meta rows; `InlineUserPicker`'s selected display + result rows and
  `UserSearchCombobox`'s result rows show the email. A user with a blank email renders name-only.

## Update (2026-06-24) — End-user portal "Create Request" intake
- **Request:** the Service Portal needs a self-service intake (Request Catalog deferred): workspace
  tiles → projects → the project's *configured* layout → ticket-number confirmation.
- **Constraint:** requestors have **no helpdesk membership** and can't reach `/helpdesks/`,
  `/projects/`, `/field-layouts/resolve/`, `/fields/`, `/tickets/`, or the ticket-attachment endpoint
  (all agent/admin modules). `PortalTicketViewSet` is read-only. They DO have read+create on
  **`itsm.portal.tickets`**.
- **Track-request detail (enriched).** `PortalTicketViewSet.retrieve` returns the ticket plus its
  **portal_visible** field layout + a `field_values` map (standard columns read off the ticket;
  custom values from the field engine; `user_picker` resolved to a **name**, never an id) — so the
  detail page renders the same fields the requestor submitted, in the project's layout, read-only,
  above the public-comment conversation. Only `portal_visible` items are iterated, and the returned
  `fields` (definitions) are filtered to those items too — so neither internal field values nor
  internal field *metadata* (names/types/options) leak. Adds `ticket_type_name` to
  `PortalTicketSerializer`. Frontend: `components/portal/portal-field-display.tsx`.
- **Backend:** new **`PortalRequestIntakeViewSet`** (`apps/itsm_tickets/portal.py`, module
  `itsm.portal.tickets`) registered at `portal/request-intake`:
  - `GET workspaces/` — active helpdesks that have ≥1 create-eligible project (NOT membership-scoped —
    a deliberate portal clamp; requestors have no membership).
  - `GET projects/?helpdesk=<id|key>` — active projects (with ≥1 ticket type) in that helpdesk
    (`ProjectSerializer`). No `portal_visible` flag yet (follow-up); `status=active` is the gate.
  - `GET layout/?project=&ticket_type=` — `{layout, fields}` in one portal-permitted call (the agent
    resolve + fields endpoints are closed to requestors). Project must be active in an active helpdesk.
  - `POST` (create) — body `{helpdesk?, project, fields:{<field_key>: value}}`. The server resolves each
    key's `config.maps_to` from the project's field definitions → standard column vs custom field, so
    maps_to routing lives in one place and the portal can't spoof assignment. **Forces**
    `requestor=request.user` + `source="portal"`, **nulls** assignment (routing / project default
    applies), runs `field_service.validate_required` (security backstop; unconfigured option fields
    skipped), then the chokepoint `ticket_service.create_ticket`. Returns `{id, ticket_number}`. No
    approval started at create — approvals fire on workflow transitions, same as agent-created tickets.
  - `POST {ticket_number}/attachments/` — ownership-scoped file upload (the agent attachment endpoint is
    `itsm.tickets`, closed to requestors); 10 MB cap.
- **Frontend:** routes under `app/t/[org]/(portal)/portal/create-request/` (`page` → `[helpdeskKey]` →
  `[helpdeskKey]/[projectKey]`). `components/portal/portal-request-form.tsx` reuses the agent form's
  **exported** `FieldControl`/`normRule`/`evalRule`/`mapApiErrors`/`userId` (no behaviour change to the
  agent form) but wires to `portalApi.*`, drops assignment/user-picker fields, falls back to
  Summary+Description when no layout exists, and raises `onCreated`. Confirmation card shows the ticket
  number + "Go to Home" / "Create new ticket" / "Track this request". Portal nav + home swap "Request
  Catalog" → "Create Request" (catalog routes remain, just unlinked).
- **Agent entry into the portal (added 2026-06-24):** agents are employees too — an IT-only agent may
  need to raise a request in a helpdesk they don't staff (e.g. HR). The agent home right rail
  (`(agent)/agent/page.tsx`, above "Needs your attention") shows a **Service Portal** card →
  `portalHome(org)`, gated on `hasPerm("itsm.portal.tickets", "create")` (hidden when the role lacks the
  grant). No backend change needed — intake is not membership-scoped and forces `requestor=self`, and
  `PortalGuard` already admits agents. Enabling it for the Agent role is purely an RBAC grant of
  `itsm.portal.tickets` (read+create) — see itsm-rbac.

## Update (2026-06-24) — Transition note prompt (slide-over) on state movement
- **Request:** moving a ticket through a workflow transition should optionally open a slide-over
  asking for a **mandatory or optional note** (e.g. Put on Hold → "Reason to hold"); the default
  **Resolve** asks for a "Resolution Note". Configured per transition: **Note Type** (Public/Internal),
  **Mandatory/Optional**, **Note Heading**.
- **Backend (`apps/itsm_workflows`):** four new `Transition` fields — `note_prompt`, `note_required`,
  `note_heading`, `note_visibility` (public|private) — migration `0002_transition_note_prompt`. The
  engine `_validate()` rejects a mandatory note left blank (**422**, error key `comment`). Seeded
  defaults ON for **Resolve**/**Fulfil** ("Resolution Note") + **Put on Hold** ("Reason to hold").
  **No new endpoint:** the existing `POST tickets/{id}/transition/` already accepts `comment` +
  `comment_visibility` and posts it via `add_comment` — the note lands as a public/internal **comment**
  (never the `resolution` field). See the **itsm-workflows** skill for the model/engine detail.
- **Frontend (`components/tickets/ticket-detail.tsx`):** `doTransition(tr)` now opens a module-level
  **`TransitionNoteSheet`** (`Sheet`) when `tr.note_prompt`, else moves immediately as before. The
  sheet titles itself with `note_heading`, uses the shared `RichTextEditor` (image-free), tints amber
  for an Internal note, and **disables submit while a mandatory note is empty**. On submit it sends
  `{ transition_id, comment, comment_visibility: tr.note_visibility }`, prefixing the note body with
  the heading (`<p><strong>{heading}</strong></p>…`) so the comment/activity log is self-describing.
- **Config UI (`components/settings/workflow-editor.tsx`):** each transition row gained a **Configure**
  (sliders) button → module-level **`TransitionNoteDialog`** (toggle + heading + Note Type +
  Mandatory/Optional → `workflowsApi.updateTransition`). Rows with a prompt show a `note: <heading>`
  badge. `Transition`/`WorkflowTransition` types gained the four optional `note_*` fields.
- Tests: `apps.itsm_tickets.tests.WorkflowTransitionTests` +3 (seeded-Resolve-prompts,
  mandatory-blocks-without-comment, mandatory-allows-with-comment); existing Resolve-path tests in
  `itsm_tickets`/`itsm_sla` updated to pass a comment. `tsc --noEmit` clean; `makemigrations --check` clean.

## Update (2026-06-24) — Comment composer: rich text + inline images & file attachments
- **Request:** the agent detail-view comment composer should be a **rich-text editor** (it was a plain
  `<textarea>`) with a **provision to attach inline images or files**.
- **Backend (`apps/itsm_tickets`):** the long-dormant **`CommentAttachment`** model is now wired up.
  Migration **`0003_comment_attachment_ticket_kind`** makes `comment` **nullable**, adds a **`ticket`** FK
  and a **`kind`** field (`file` | `image`) — an attachment is uploaded *before* the reply exists (the
  editor needs a URL to embed an inline image / show a file chip), so it's **ticket-scoped with `comment`
  null** until the reply is posted. New **`CommentAttachmentViewSet`** (`/comment-attachments/`, module
  `itsm.tickets.comments`): multipart upload, **10 MB** cap, `kind="image"` must have an `image/*`
  content-type, ticket access checked via `is_project_accessible` (403) and reads clamped to accessible
  helpdesks (mirrors ticket scoping). `add_comment(*, …, attachment_ids=[])` associates the uploads on
  submit — **clamped to the same ticket + still-unattached rows** so a forged id can't hijack another
  comment's/ticket's attachment. `CommentSerializer` gained `attachments` (nested); the `comments` action
  passes **`context={"request": …}`** so `file` URLs are **absolute** (the inline `<img src>` and the
  file-list `<a href>` both need absolute URLs — the FE is cross-origin in dev).
- **Inline images upload, never base64.** `sanitize_html` (bleach) allows `<img>` but only `http/https`
  protocols → a `data:` base64 image is **stripped**. So the editor uploads the file (returns an absolute
  URL) and embeds `<img src="…/media/…">`, which survives sanitisation. (Verified by
  `CommentAttachmentApiTests.test_inline_image_html_survives_sanitise`.)
- **Frontend.** Shared `components/ui/rich-text-editor.tsx` gained an optional **`onImageUpload`** prop:
  always registers `@tiptap/extension-image` (so stored `<img>` round-trips) but only shows the **Insert
  image** toolbar button + **paste/drop** upload when the prop is set (description / custom rich-text
  fields stay image-free). `allowBase64: false` — we upload and embed a URL. `ticket-detail.tsx` composer
  swapped its `<textarea>` for `RichTextEditor` (image upload wired to `commentAttachmentsApi.upload(…,
  "image")`), added an **Attach files** button (`kind="file"` → chips with remove), and renders each
  comment's `kind="file"` attachments as download links under the body. On submit it associates inline
  images **still present in the body** + every file chip via `addComment({ attachment_ids })`. The
  Public/Internal toggle, amber private tint (now via the RTE's `className`), and SLA first-response
  stamping are unchanged.
- Tests: `apps.itsm_tickets.tests.CommentAttachmentApiTests` (5) — upload-is-unattached-then-associates,
  inline-image-survives-sanitise, image-kind-requires-image-content-type, cross-ticket-claim-rejected,
  cross-helpdesk-upload→403. `tsc --noEmit` clean.
- **Scope:** agent detail composer only. The **end-user portal** composer (`portalApi.addComment`) is still
  plain text — not in this pass.

## Update (2026-06-23) — Activity feed shows *what* changed (old → new), not just who/when
- **Bug (ITINC-606):** the detail-view **Activity** tab rendered only `actor` + verb + timestamp — the
  payload (the *what*) was never shown, so every row read "Shekhar updated a field · …" with no field
  name or before/after value. The audit data was already in `AuditEvent.payload`; the renderer just
  dropped it.
- **Fix (frontend, `components/tickets/ticket-detail.tsx`):** three module-level helpers drive each row:
  **`activityVerb(a)`** (special-cases `field_changed` → "changed **{payload.name}**"; unknown actions
  fall back to a de-underscored label), and **`activityDetail(a)`** which returns the "old → new" string
  per action from the payload — `status_changed` (`from`/`to`), `priority_changed` (codes mapped via
  `PRIORITY_LABEL`), `assigned`/`requestor_changed`/`group_changed` (the new `old_label`/`new_label`),
  `field_changed` (`old`/`new`, via `activityValue` which formats bools/arrays/objects), `summary_changed`
  (`new`), `comment_added` ("internal note" when private), `closed`/`reopened`. The `<li>` now renders
  **actor · verb · detail · when**. Added SLA/attachment/watcher/link/template verbs to `ACTION_VERB`.
- **Fix (backend, `services/ticket_service.py`):** the standard-field edit events that previously stored
  only raw ids/empty payloads now capture **human-readable labels at change time** (correct audit
  semantics — survives a later rename). Module helpers **`_user_label(id)`** / **`_group_label(id)`** add
  `old_label`/`new_label` to the `assigned`, `requestor_changed`, `group_changed` payloads (in both
  `update_ticket` **and** the `assign` action), and `summary_changed` now records `{old, new}` (was `{}`).
  No serializer/model/migration change — `AuditEventSerializer` already returns `payload` verbatim.
- **Back-compat:** rows logged *before* this carry no `*_label` → the renderer shows the verb only for
  those three actions (never a misleading "Unassigned → Unassigned"). Custom `field_changed` rows already
  carried `{old, new, name}` so they gain detail retroactively. Custom **user_picker** fields still log
  raw ids (niche; `_serialize` returns the id) — acceptable; rendered as-is.
- Tests: `TicketInlineEditApiTests` +3 (`test_assignee_change_logs_human_label`,
  `test_group_change_logs_human_label`, `test_summary_change_logs_old_and_new`). `itsm_tickets` suite **56**.

## Update (2026-06-23) — Assignment-group whitelist enforced on write paths
- A new write-path guard `ticket_service.ensure_group_allowed(project, group_id)` (sibling of
  `ensure_assignee_in_group`) rejects (400) a group that isn't on the project's whitelist
  (`Project.allowed_group_ids`; empty ⇒ all allowed, default group always folded in). Enforced on the
  same agent paths: view-layer `create`, inline `update_ticket` (when the group changes), the `assign`
  action, and bulk-assign (skips violating tickets). The low-level `create_ticket`/`assign` stay
  permissive. **Create-time routing** (`create_ticket`) also changed: it now fires only when **both**
  group and assignee are unset (an explicit group is no longer overridden), and routes on custom-field
  conditions via `resolve_group_and_assignee(ticket, custom_fields=…)`. See the **itsm-groups** skill.

## Update (2026-06-23) — Frozen (sticky) queue toolbar
- The agent queue **toolbar** — the title/search/Columns/**New ticket** row + the `FilterBar` row at the
  top of `components/tickets/ticket-queue.tsx` (the panel the user highlighted) — is now **frozen below
  the workspace header**, always visible while the long ticket table scrolls behind it. It's the
  top-of-page counterpart to the frozen pager below. The two rows are wrapped in one `<div>` with
  `sticky top-14 z-30` + a full-bleed band: `border-b bg-card/95 backdrop-blur
  supports-[backdrop-filter]:bg-card/80` and negative gutters (`-mx-3 px-3 py-3 sm:-mx-6 sm:px-6 lg:-mx-8
  lg:px-8`) that cancel `<main>`'s padding so the bottom border spans edge-to-edge like the header; inner
  `space-y-3` keeps the two rows spaced.
- **Why `top-14` (don't "fix" it):** the `WorkspaceHeader` is `sticky top-0 z-40` and **56px tall**
  (`h-14`), so `top-14` parks the toolbar **flush under it** with no gap/overlap. `z-30` sits **below**
  the header (z-40 → toolbar slides under it) but **above** table rows. If the header height ever changes
  from `h-14`, update this `top-14` to match. The freeze relies on the **same** invariants as the pager:
  the **window** is the scroll container (`globals.css` keeps `overflow-x-clip`, *not* `hidden`) and the
  toolbar is the **first** child of the queue's `space-y-4` containing block — an `overflow-auto`/
  `-hidden` ancestor or moving it out of that block silently breaks it. The table **column-header** row
  is *not* sticky (only the highlighted toolbar was frozen, by request); it scrolls up under the band.
  Radix popovers (Columns/filter chips/saved-views/add-filter) portal to `body`, so the band's
  `backdrop-blur` stacking context doesn't clip them. CSS/markup-only change — no JS/logic touched.

## Update (2026-06-23) — Comment composer: Public Comment / Internal Note toggle
- **Bug:** the agent detail-view comment composer (`components/tickets/ticket-detail.tsx`) hard-coded
  `visibility: "public"` on every reply — there was **no way to add a private/internal note**, even
  though the `Comment` model, `add_comment` service, and the comments list endpoint have all supported
  `visibility` (public|private) since day one (private reads gated by **`itsm.tickets.comments_private`**).
- **Fix (frontend):** the composer gained a small segmented **visibility selector** above the textarea —
  **Public Comment** (default, `MessageSquare` icon) / **Internal Note** (`Lock` icon, amber). New state
  `commentVisibility` defaults to `"public"`; `submitComment` posts the chosen visibility; the textarea
  placeholder, the submit-button label ("Add comment" → "Add internal note"), the success toast, and the
  textarea tint (amber `border-warning/40 bg-warning/10` when private) all reflect the mode. The selector
  **only renders** when `canPostPrivate = hasPerm("itsm.tickets.comments_private", "read")` — so a user
  without internal-note access sees the old public-only composer (and never an internal note they can't
  read back). Existing private comments already render with the **"Internal"** amber badge.
- **Fix (backend, defense-in-depth):** `TicketViewSet.comments` (POST) now **rejects a forged
  `visibility=private`** with **403** when the caller lacks `itsm.tickets.comments_private` read — it no
  longer silently trusts the body. Mirrors the existing GET-side read filter. The comments action has no
  per-action `module_code` override, so the POST itself is still gated by the view-level `itsm.tickets`
  **create**; this adds the private sub-gate on top. Note `check_permission` inherits down the dotted
  module tree (closest explicit row wins) — an Agent/Supervisor has `comments_private` explicitly; a
  Requestor has no `itsm.tickets` grant at all → denied. A first **public** reply still stamps
  `first_responded_at`; a private note does **not** (see the SLA note below).
- Tests: `apps.itsm_tickets.tests.CommentVisibilityApiTests` (4) — default-public, agent-can-post-private,
  private-note-doesn't-stop-first-response, forged-private-without-grant→403. `itsm_tickets` suite now **53**.

## Update (2026-06-23) — Queue SLA bar shows outcome for a stopped clock
- `SlaBar` (`components/tickets/queue-columns.tsx`) treated only `met`/`stopped` as **done**, so a
  **breached-and-stopped** clock (e.g. a late first response) fell through to the live `remainingLabel`
  and showed an ever-growing "Xh over". `done` now also includes `breached` → a stopped clock shows
  "Met"/"Breached"; only a *running* clock shows the live "Xh left/over". Mirror of the detail-pane fix
  in `sla-panel.tsx`. The first-response clock is stopped by **`add_comment`** (first **public** reply
  stamps `first_responded_at` + `sla_stop("first_response")`); a private note does not. See **itsm-sla**
  SKILL/BUG_LOG (ITINC-605) for the full root-cause.

## Update (2026-06-23) — Frozen (sticky) queue pager
- The agent queue **pager** (the "Showing X–Y of N" + Prev/numbers/Next row at the foot of
  `components/tickets/ticket-queue.tsx`) is now **frozen to the bottom of the viewport** — always
  visible while the long ticket table scrolls behind it, mirroring the **sticky top
  `WorkspaceHeader`**. The wrapper `<div>` gained `sticky bottom-0 z-30` + a footer-bar treatment:
  `border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80` and **full-bleed** negative
  gutters that cancel `<main>`'s padding so the top border spans edge-to-edge like the header
  (`-mx-3 px-3 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8`).
- **Why it works (don't "fix" it):** the **window is the scroll container** (`globals.css` keeps
  `overflow-x-clip`, *not* `hidden`, on html/body precisely so `position: sticky` resolves against the
  viewport), and the whole table sits **above** this last child inside the same `space-y-4` containing
  block — so `bottom-0` pins the pager up until the agent scrolls to the final page, then it rests at
  its natural spot. If a future change wraps the queue in an `overflow-auto`/`-hidden` ancestor, or
  moves the pager out of the table's containing block, the freeze silently breaks. `z-30` sits **below**
  the header's `z-40` (they never overlap) but above table rows; Radix popovers (Columns/filters) portal
  above both.

## Update (2026-06-23) — Whole-row click opens the ticket
- The agent queue table (`components/tickets/ticket-queue.tsx`) now opens the ticket on a click
  **anywhere in the row**, not just the ID/Summary links. Each `<TableRow>` (already `cursor-pointer`)
  got an `onClick` that calls the module-level **`openTicketFromRow(e, () => router.push(href))`** helper,
  where `href` = `` `${base}/${t.ticket_number}` ``.
- `openTicketFromRow` is a **guarded** navigation so it composes with the existing controls instead of
  fighting them: it **bails** on a non-left button, on any modifier (Ctrl/Cmd/Shift/Alt — preserves
  "open in new tab" / text-select), on `e.defaultPrevented`, and when the click target
  `.closest("a, button, input, select, textarea, label, [role='button']")` — so the ID & Summary
  **`<a>` anchors still handle their own clicks** (one navigation, not two) and remain the keyboard/AT
  path + new-tab target. Net: mouse users click the row; keyboard/AT users tab to the in-row links.
- No extra state plumbing — the URL-sync effect already persists queue state to `sessionStorage` before
  navigation, so "return to queue restores filters" is unchanged. The helper is module-top-level (stable
  reference, React focus-stability rule).

## Update (2026-06-23) — Queue remembers the last-used filters (session)
- **Bug:** opening a ticket and returning to the queue **reset the filters to the default view**. The
  queue hydrates its filter/sort/view state **only from the URL**, but the detail **Back to queue** link
  (`ticket-detail.tsx` → `href={base}`) and the row navigation drop the query string — so any return
  path that lands on a param-less `base` re-ran default-view resolution and lost the agent's filters.
- **Fix (self-contained in `ticket-queue.tsx`):** the active query string (`q`/`search`/`ordering`/
  `page`/`view`) is mirrored to **`sessionStorage`** under `itsm:queue:<project.id>` by the same
  URL-sync effect (gated on `ready` so the pre-resolution empty state never clobbers it). On a fresh
  (param-less) visit the once-guarded resolver **restores that stored state first**, a new top
  precedence tier: **last-used (this session) → personal default → project default → product default
  (`open`) → All tickets**. After restore the URL-sync effect rewrites the params, so deep links stay
  shareable. Helpers: module-level `queueStateKey(projectId)` + `readStoredQueueState(projectId)`.
- **Scope:** per-tab session, per project (a new tab / new session falls through to the default view —
  unchanged). A deep-link visit (`?view`/`?q`) is honoured verbatim and *becomes* the new last-used. An
  empty stored string (agent explicitly cleared all filters) is honoured as "no view" rather than
  snapping back to the default. No change to the detail page or row links was needed — this is also the
  `sessionStorage` persistence the whole-row-click note above relies on.

## Update (2026-06-23) — View selector visually distinct from filter chips
- The queue **view selector** (the "Open"/"All tickets" dropdown — `SavedViewsMenu` in
  `components/tickets/filters/saved-views.tsx`) used the **same** `variant="outline"` style as the
  per-field **filter chips** (`FilterChip`), so the primary "which view am I in" control blended into the
  field filters on the agent queue. It's now a **filled `variant="secondary"`** button with a leading
  `LayoutList` icon and a `font-semibold` label, so it reads as a view selector rather than another chip.
- `filter-bar.tsx` also inserts a thin **vertical divider** (`h-5 w-px bg-border`) between the view
  selector and the chip cluster, so row 2 of the toolbar reads as two groups: **[view] | [field
  filters · More filters · Save view · Clear all]**. The chips, **More filters**, **Save view**, and
  **Clear all** styling are unchanged.

## Update (2026-06-23) — Type selector removed from the create form
- The agent **create form** (`components/tickets/ticket-create-form.tsx`) no longer renders the
  standalone **Type** dropdown above the panes. It was a config↔create **mismatch**: Type is neither a
  field on the **Layout** designer nor manageable in project config (the ticket-categories editor was
  removed 2026-06-22), yet it sat prominently atop the form. New tickets now **silently use the
  project's default ticket type** (`is_default`, else the first) — `ticketType` is still resolved into
  the create payload's `ticket_type` and still drives `layoutsApi.resolve(...)`, it's just no longer a
  user control (`useState` with no setter). `TicketType` stays load-bearing elsewhere: the queue
  **Type** filter and detail **Type** row are unchanged.
- Net effect: the create page now renders **exactly** the resolved `FieldLayout` (the WYSIWYG target of
  the Layout designer) plus nothing else. If a project genuinely needs agents to pick among multiple
  types at create time, re-introduce a control deliberately (and surface it in config) — don't restore
  the old always-on dropdown.

## Update (2026-06-23) — Top-right Cancel on the create form
- The new-ticket page (`app/(agent)/agent/w/[helpdeskKey]/p/[projectKey]/new/page.tsx`) now renders a
  **top-right Cancel** button in the header row beside the "New {project} ticket" `<h2>` (the heading +
  button sit in a `flex items-start justify-between` row). It's an `outline`/`sm` `Button` with an `X`
  icon that calls `router.back()` — the **same action** as the existing bottom-of-form Cancel in
  `ticket-create-form.tsx`. Both Cancels coexist (top for a quick escape on a long form, bottom beside
  **Create ticket**). The button lives in the **page** (not the form component) because the heading it
  aligns with is rendered there; the form's own footer Cancel was left untouched.

## Update (2026-06-23) — Wider detail/create sidebar (320→360px) + select overflow guard
- The detail-view and create-form right **Sidebar** widened from **320px → 360px**
  (`lg:grid-cols-[minmax(0,1fr)_360px]` in both `ticket-detail.tsx` and `ticket-create-form.tsx`) —
  long sidebar selects (e.g. "Assigned Group" = "IT Helpdesk Service Desk", "Assigned Technician") were
  spilling past the card border. **Supersedes the 320px figure** in the 2026-06-22 note below.
- Overflow guard (detail view only — its sidebar rows are inline `flex justify-between`, not stacked):
  the editable/read-only `<dd>` rows + the `Row` helper got `min-w-0`; `selectCls` got `max-w-full`; and
  `GroupMemberPicker`'s fixed `w-44` got `max-w-full`. So a native `<select>` now truncates inside the
  card instead of auto-growing past it. The **create form** needed no guard — its sidebar fields are
  stacked with `w-full` selects.

## Update (2026-06-22) — Full-width create form
- The agent **create form** (`components/tickets/ticket-create-form.tsx`) dropped its `max-w-5xl` cap and
  now fills the full-width working surface. Its two-pane grid mirrors the detail view —
  `lg:grid-cols-[minmax(0,1fr)_320px]`: the **Main** column flexes; the **Sidebar** is a fixed **320px**
  (replacing the old `lg:grid-cols-3` + `lg:col-span-2`, which stretched the sidebar to a third of the
  viewport once uncapped). No-sidebar layouts still render a centred `max-w-2xl` single column; the
  standalone **Type** select keeps `max-w-sm`. (Supersedes the "create form keeps `max-w-5xl`" note in the
  2026-06-21 full-width section — see `docs/QA_CHECKLIST.md`.)

## Update (2026-06-22) — Queue default view + per-project view curation
- **Default-view resolution** in `ticket-queue.tsx`: a fresh visit (no `?view`/`?q` in the URL) resolves
  the active view as **personal default → `Project.default_view_key` → product default
  (`PRODUCT_DEFAULT_VIEW_KEY = "open"`, in `services/filter_fields.py`) → All tickets**. A `ready` gate
  holds the first list fetch until resolved (no "All tickets" flash); deep links are honoured verbatim.
- **Per-agent default view** persists in `itsm_dashboards.QueueViewPreference` via owner-scoped
  `/api/v1/itsm/queue-view/` (`queueViewApi`); set from the **star** on each row of the queue's view
  dropdown (`saved-views.tsx`).
- **System views are curated per project** — the dropdown only shows views not in
  `Project.disabled_view_keys` (`enabledSystemViews` in `ticket-queue.tsx`); **All tickets** is always
  shown. Admins toggle these + manage custom shared filters on the project **Filters** settings tab
  (see itsm-projects).

## Update (2026-06-21) — Next-level queue + ticket UX
- **`Ticket.updated_by`** (FK User, SET_NULL) — actor of the most recent mutation; stamped by
  `ticket_service.update_ticket` / `assign` alongside `updated_at`. List + detail serializers expose
  `created_by` / `updated_by` (UserBrief). Detail meta rail shows Created / Created by / Last updated /
  Updated by.
- **List serializer** also returns `requestor` and a compact `sla` payload (`{first_response,
  resolution}`; each `{state, due_at, started_at, target_minutes, breached, paused, rag}`). RAG is
  wall-clock (no per-row business-time read); the viewset prefetches `sla_trackers__metric`.
- **Configurable queue columns** — shared registry `components/tickets/queue-columns.tsx`
  (key↔label↔width↔sortKey). Default layout = old columns + Requestor + Group + Response/Resolution SLA
  bars. Per-project default in `Project.queue_columns` (JSON, **Columns** settings tab); per-agent
  override in `itsm_dashboards.QueueColumnPreference` via owner-scoped `/api/v1/itsm/queue-columns/`
  (queue "Columns" popover `column-picker.tsx`). Resolution: user pref → project default → built-in.
- **Comments + Activity are tabs** at the bottom of the detail main column (JIRA-style; counts in
  labels), reusing `components/ui/tabs.tsx`.
- **Strict, group-scoped assignee** — assignee must be an active member of the assigned group. Enforced
  by `ticket_service.ensure_assignee_in_group` on the agent write paths: `update_ticket` (inline edit) +
  the view-layer create / `assign` action / bulk-assign (400 / skip). The lower-level `create_ticket` /
  `assign` services stay permissive (routing/escalation/portal/seeds). The assignee picker (detail +
  create) draws from `GET /groups/{id}/members/` via `group-member-picker.tsx`.

## Backend app path
`backend/apps/itsm_tickets/`

## Key concepts
- **`Ticket`** — first-class columns: `ticket_number` (unique), `project`/`ticket_type` (PROTECT),
  `summary`, `description_html/_text`, `requestor`, `assigned_group`, `assignee`, `status`/
  `workflow` (PROTECT, snapshot), `priority`/`impact`/`urgency`, `resolution`, lifecycle stamps
  (`due_date`, `first_responded_at`, `assigned_at`, `resolved_at`, `closed_at`), `reopen_count`,
  `source`, `created_by`. Hot-path indexes for queue/SLA/reporting.
- **`TicketSequence`** — per-project counter (OneToOne Project), locked with `select_for_update`.
- **`Comment`** — `visibility` public|private; `body_html` sanitized + `body_text` mirror;
  `MentionRecord`s; `CommentAttachment`s. First public reply stamps `first_responded_at`.
- **`Watcher`** / **`TicketLink`** (relates_to/blocks/duplicates/causes + inverses) /
  **`TicketAttachment`**.
- **`ticket_service`** — `create_ticket`, `assign`, `add_comment`, **`update_ticket`** (atomic;
  log_event + hooks on commit). **`numbering`** — `generate_ticket_number(project)`.
- **Inline detail-view editing.** `update_ticket(*, ticket, user, **changes)` is the single
  write site for editing standard fields from the detail page: touches only the keys supplied
  (`priority`, `summary`, `description_html`, `impact`, `urgency`, `requestor_id`, `assignee_id`,
  `group_id`), logs each change (`priority_changed`/`requestor_changed`/`summary_changed`/
  `description_changed`/`group_changed`/`assigned`), re-emits `Assigned`, stamps `assigned_at`,
  and sanitises the description like `create_ticket`. `TicketViewSet.update` (PATCH/PUT) is the
  HTTP entry: validates `priority`, rejects an empty `summary`, resolves `requestor`/`assignee`
  (integer User PK or null-to-clear) + `assigned_group` (UUID or null) — unknown id → 400.
  Custom (value-backed) fields edit through the existing **`set-fields`** action (`field_service`).
  Status is NOT edited here (workflow `transition`); `ticket_type`/`workflow`/`source` stay
  read-only. RBAC: needs `itsm.tickets:update` (Agent + Supervisor have it; Requestor does not).
- **Helpdesk scoping (every read/write clamped).** All ticket access is intersected with the
  requester's accessible helpdesks (via `itsm_helpdesks.services`; superuser ⇒ unrestricted, advisory
  `?helpdesk=<id|key>` narrows further, never widens): `get_queryset` filters
  `project__helpdesk_id__in` (so detail/transition/assign/comments derived from it 404 cross-helpdesk
  ids); `_bulk` clamps both the ids branch and the saved-filter branch; `create`/`links`/`apply_template`
  reject (403) an inaccessible project/target/template; and a comment POST restricts `@mention` user
  ids to the ticket's helpdesk members. The shared `query_builder.build_q`/`filtered_tickets` take an
  `accessible_helpdesk_ids` kwarg that ANDs the same filter (closing saved-filter results, widget data,
  and bulk-by-filter).

## Frontend path / pages
Agent queue (list): `app/(agent)/agent/w/[helpdeskKey]/p/[projectKey]` →
`components/tickets/ticket-queue.tsx` — the agent's primary **full-width working surface** (filter
bar + sortable, URL-synced, paginated table). It renders **edge-to-edge** inside the full-width
`WorkspaceChrome` `<main>` (no `max-w` cap — see itsm-helpdesks "Full-width responsive working
surface"); the flexible **Summary** column absorbs the extra width and clamps long titles to one line
(`line-clamp-1` + `title` tooltip), while the shadcn table wrapper gives horizontal scroll on mobile.
The toolbar is a compact **2-row** header (2026-06-21): **row 1** = project title + search +
**New ticket**; **row 2** = the `FilterBar` flattened to one wrapping row (saved-views menu + filter
chips + **More filters** + **Save view** + **Clear all**, all left-grouped so the row wraps as one
unit under heavy filtering instead of stranding the actions on a 3rd line). Search was lifted out of
`FilterBar` into the queue's row 1 (its `search`/`onSearchChange` props were removed). Both rows are
wrapped in one **frozen toolbar band** (`sticky top-14 z-30`, full-bleed) so the title/search/filters
stay visible just under the workspace header while the table scrolls; the **pager** at the foot is
likewise **frozen to the bottom of the viewport** (`sticky bottom-0`, full-bleed footer bar) — both
mirror the sticky top header (see the 2026-06-23 "Frozen (sticky) queue toolbar" / "Frozen (sticky)
queue pager" updates).

Agent detail: `app/(agent)/agent/w/[helpdeskKey]/p/[projectKey]/[ticketId]` →
`components/tickets/ticket-detail.tsx` (`TicketDetailView`). **Layout-driven two-pane detail**
(main + sidebar from the resolved `FieldLayout`) with description/comments/activity. `FieldView`
renders each field **read-only OR editable in place** when the user has `itsm.tickets:update`:
priority select, async user pickers (assignee/requestor via `usersApi.search`), group select,
description editor, an inline summary editor in the header, and type-dispatched controls for
custom fields (`CustomFieldEdit`). Standard fields save via `ticketsApi.update` (PATCH); custom
via `ticketsApi.setFields`. All editable controls are module-top-level (React focus stability).

## API clients
`tickets` (+ actions: `available-transitions`, `transition`, `assign`, **`update` (PATCH inline
standard fields)**, **`set-fields` (custom fields)**, `watch`, `watchers`, `comments`,
`activity`, `links`), `comments`, `watchers`, `ticket-links`, `ticket-attachments`,
`comment-attachments` (`commentAttachmentsApi.upload(ticket, file, kind)`).
  ⚠️ The `ticket` arg to the attachment clients is the **UUID pk** (`ticket.id` / `t.id`), NOT the
  readable `ticketId` route token ('ITINC-606'). Unlike the number-or-UUID `TicketNumberLookupMixin`
  routes, these endpoints key off the raw FK; passing the number 400s (list) / 500s (create, now
  hardened to 400). See `docs/BUG_LOG.md` 2026-06-24.

## RBAC module codes
- `TicketViewSet`, `TicketAttachmentViewSet` → **`itsm.tickets`**.
- `CommentViewSet`, `CommentAttachmentViewSet` → **`itsm.tickets.comments`**; private comments gated by
  **`itsm.tickets.comments_private`** (checked in the `comments` list action).
- `WatcherViewSet` → **`itsm.tickets.watchers`**; `TicketLinkViewSet` → **`itsm.tickets.links`**.
  (Bulk ops → `itsm.tickets.bulk`, planned.)

## Key files
- `models.py` — `Ticket`, `TicketSequence`, `Watcher`, `TicketLink`, `TicketAttachment`,
  `Comment`, `CommentAttachment`, `MentionRecord`.
- `services/ticket_service.py` — `create_ticket`, `assign`, `add_comment` (associates
  `attachment_ids` to the reply), `update_ticket`.
- `services/numbering.py` — `generate_ticket_number`.
- `views.py` — `TicketViewSet` (+ `update` override for inline edits + actions;
  `_resolve_user_change`/`_resolve_group_change` helpers, `PRIORITY_CHOICES`) and the four
  resource ViewSets.
- `serializers.py` — list/detail/create serializers, comment/watcher/link/attachment/audit.
  `TicketCreateSerializer.requestor`/`assignee` are `CharField` (User PK is an **integer**, not a
  UUID); `assigned_group` is `UUIDField`. It also accepts `custom_fields` (dict) for the field engine.
- `urls.py` — `tickets`, `comments`, `watchers`, `ticket-links`, `ticket-attachments`,
  `comment-attachments`.
