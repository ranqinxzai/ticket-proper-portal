# QA Checklist — Ticketing System

Use this on every change. Adapted from the OneMed EHR QA bible — multi-tenant items dropped (single tenant), everything else applies.

## Before Any Code Change

- [ ] Read the relevant `docs/SKILL_*.md` for the module you're touching
- [ ] Read `docs/BUG_LOG.md` to avoid repeating known bugs
- [ ] Identify which apps + frontend pages the change affects

## After Any Backend Change

- [ ] Soft delete used where applicable (no hard delete on user-visible content like comments)
- [ ] `permission_classes` set on every ViewSet (default `AllowAny` is for dev only — production routes must opt in to `HasAppAccess.for_app(...)`)
- [ ] Serializer split into List / Detail / Create where it makes sense
- [ ] No `print()` — use Django logging
- [ ] No `\n` inside f-strings (Python 3.12 SyntaxError)
- [ ] Number / order generation wrapped in `transaction.atomic` and `select_for_update` if concurrent
- [ ] API response shape matches what the frontend `lib/pm.ts` (or equivalent) expects
- [ ] If you added a write site, you also called `log_activity(...)` from `apps.project_management.activity` (PM module only)

## After Any Frontend Change

- [ ] `"use client"` on any page using state / hooks / event handlers
- [ ] `useParams<{ id: string; boardId: string }>()` for dynamic segments
- [ ] All API calls go through `lib/api.ts` (`api.get / post / patch / del / upload`) — never raw `fetch`
- [ ] Errors surfaced via `toast.error(...)` from sonner (now installed) — not `alert()` and not silent
- [ ] Loading states (`<Loader2 className="animate-spin" />` or skeleton blocks)
- [ ] No broken imports or unused variables
- [ ] TypeScript types match API response (`PmItem.comment_count`, `PmComment.body_html`, …)

## React Component Stability (CRITICAL — prevents focus loss)

- [ ] **Never** define a function component inside another component's body — every parent re-render creates a new component reference, React unmounts + remounts the subtree, and any focused `<Input>` / `<Textarea>` / Tiptap editor loses focus + IME state. Hoist to module scope, wrap with `React.memo`, or inline as a JSX-valued `const`.
- Symptoms: "cursor disappears after one character", "I have to re-click to type", "letters appear inverted / jumbled" (IME composition replayed on a fresh DOM node).

## Security Checks

- [ ] No XSS — any rich-text body rendered with `dangerouslySetInnerHTML` MUST come from a server endpoint that already sanitised it via `bleach` (PM comments do this).
- [ ] No SQL injection — only ORM access; no raw SQL with string interpolation.
- [ ] Auth required on every PM endpoint that mutates data (`HasAppAccess.for_app("pm")`).
- [ ] No `console.log()` of user data in production code.

## UI / UX Checks

- [ ] Buttons are clickable + show a busy state while the request is in flight
- [ ] Forms validate before submit and show errors inline
- [ ] Empty states render when a list is empty
- [ ] Modals / sheets close on Esc + click-outside
- [ ] Drawer keyboard focus is trapped (Radix Sheet handles this for free)
- [ ] Pagination visible when count > page size

## Module-Specific Checklists

### Project Management — Comments + Activity Log on Items (added 2026-05-10)

- [ ] **Server sanitises rich text** — POST a comment whose body contains `<script>alert(1)</script>` and confirm it is stripped from `body_html` before save. Repeat with `<img src=x onerror=alert(1)>` — `onerror` attribute is removed.
- [ ] **`comment_count` matches reality** — `Item` serializer's `comment_count` equals `ItemComment.objects.filter(item=..., is_deleted=False).count()` for that item.
- [ ] **Icon flips without reload** — after posting the first comment from the drawer, the comment-bubble icon on the row immediately switches from outline to filled-violet with `1` (no full board reload).
- [ ] **No-op cell edits don't pollute the feed** — PATCH `/items/{id}/cells/{column_id}/` with the same value the cell already holds → confirm no new `ItemActivity` row.
- [ ] **Cell-change diff is captured** — change a `status` cell from `todo` → `done`. The `ItemActivity` row carries `action=cell_changed`, `payload.old.value="todo"`, `payload.new.value="done"`, `payload.column_name="Status"`.
- [ ] **Attachment add/remove logged** — uploading or deleting any attachment (cell-attachment OR comment-attachment) writes one `ItemActivity` row.
- [ ] **Soft-deleted comment** — DELETE `/api/v1/pm/comments/<id>/` flips `is_deleted=True` (does NOT row-delete) and writes a `comment_deleted` activity. Body is blanked so soft-deleted comments don't leak via `?is_deleted=true` queries.
- [ ] **Deleted user fallback** — when an `actor` or `author` is hard-deleted from `accounts.User`, `actor_name` / `author_name` resolves to "(deleted user)" — no NPE in the activity feed.
- [ ] **Drawer geometry** — Sheet width is `40vw` clamped to `[480px, 720px]`. Closes on Esc and on click-outside.
- [ ] **Tiptap toolbar** — bold / italic / strike / bullet-list / ordered-list / link / heading buttons toggle on selection. Markdown shortcuts (`**bold**`, `# heading`) work via StarterKit.
- [ ] **Paste image** — pasting an image into the composer attaches it as a `CommentAttachment`, NOT inlined as base64 in `body_html`.
- [ ] **Files tab union** — calls `GET /api/v1/pm/items/<id>/files/`, response includes both `source="cell"` and `source="comment"` rows, each with a `source_label` (column name or "Comment by …"). Sorted newest-first.
- [ ] **Activity entry rendering** — `cell_changed` rows show old → new chips that match the column's status / priority colours. Other entries fall back to plain text via the server-rendered `summary` field.
- [ ] **Edit-own gating** — edit + delete buttons on a comment only render when `comment.author === currentUser.id`. Non-author payload edits return 403 from the backend.
- [ ] **Bleach allowlist** — `<script>`, `<iframe>`, `onload`/`onerror` attributes, `javascript:` URLs are all stripped. Allowed: `p, br, strong, em, u, s, code, pre, ul, ol, li, h1..h4, blockquote, a (href, rel, target), img (src, alt)`.
- [ ] **Permission gating** — a user without `pm` in their `app_access` gets `403` on every `/api/v1/pm/...` endpoint.
- [ ] **No regression** — existing `CellAttachment` upload (PATCH `/api/v1/pm/attachments/`), virtualised scroll on `BoardView`, primary-text-cell → `Item.name` mirroring all still work.

### Project Management — Column Filters (added 2026-05-10)

- [ ] **Filter icon visible** on every filterable column header. Outline on hover for inactive, persistent violet (with fill-violet-200 fill) when a filter is set. `file` columns have NO filter icon (no operator makes sense).
- [ ] **Multi-select for status / dropdown / priority** — picking two `Status` options (e.g. `To Do` + `Working on it`) shows items whose status is either. Empty selection clears the filter.
- [ ] **Person filter** — populates from `GET /api/v1/users/?page_size=200`. Search box narrows the list by `full_name` or `username`. Multi-select.
- [ ] **Date filter is inclusive on `to`** — selecting `to=2026-05-10` includes items dated `2026-05-10 23:59`, not just `2026-05-10 00:00`.
- [ ] **Text / long_text "contains" is case-insensitive** — filtering `contains="urgent"` matches "Urgent fix" and "URGENT call".
- [ ] **Number range** — `min` only, `max` only, and both bounds all work; non-numeric cells are excluded.
- [ ] **Checkbox filter** is exact: `Checked` only matches `value_bool=True`, `Unchecked` only matches `value_bool=False`. NULL cells (never set) are excluded from both.
- [ ] **Filter chips render above the header bar** with the column name + a human-readable summary (e.g. `Status: To Do, Working on it`, `Priority: High +2` for >2 values). `x` button on the chip clears just that filter; "Clear all" clears every filter.
- [ ] **Group counts reflect filtered set** — group header shows "Dr · 3 items" when 3 of the original 5 are visible.
- [ ] **Empty groups hidden while filtering** — a group with zero matching items disappears from the table (returns when filters are cleared).
- [ ] **Inline `+ Add item` row hidden while filtering** — preventing the confusion of typing into a row that would immediately vanish when the filter excludes the new item.
- [ ] **Filters are pure-client and don't persist** — refreshing the page resets to no filter; URL doesn't change. (Acceptable v1; URL persistence is a future iteration.)
- [ ] **Combined filters AND together** — applying `Status=Done` + `Priority=High` shows only items that match BOTH (intersection, not union).
- [ ] **Filter setting one column doesn't drop another's filter** — adding a Status filter while a Priority filter is already active leaves both intact.
- [ ] **Comments + Activity icon column is unaffected** — the comment-bubble column has no filter icon and is never hidden by filtering. Filtering by Status doesn't change which item shows the bubble.

### Project Management — Group Summary Row (added 2026-05-10)

- [ ] **Summary row appears at the foot of every non-collapsed, non-empty group**, between the last item and the inline `+ Add item` row.
- [ ] **Empty groups don't render a summary row** — a group with zero matching items shows just the (hidden via filter) header or no row at all.
- [ ] **Filter ⇒ summary shrinks** — apply a Status=`Done` filter; summary distribution recomputes from the filtered subset, not the full group.
- [ ] **Status / Priority / Dropdown** — colour bar widths are proportional to count. Two equal-count options render as 50/50 segments. Options with zero count don't render a segment.
- [ ] **Status "% complete" caption** — when any option's `id` or `label` matches `/done|complete|closed|finish/i`, the tooltip header shows "<X>% complete" in emerald. Default seed values (`Done`) trigger this.
- [ ] **Blank cells get a grey segment** when at least one item in the group has no value for that status/dropdown/priority column.
- [ ] **Checkbox column** — green progress bar from 0–100%, percentage text right-aligned next to the bar.
- [ ] **Number column** — `Σ <sum> · x̄ <avg>` inline; tooltip adds Sum / Average / Min / Max plus filled-vs-total. Decimals respect `column.settings.decimals`; `prefix` / `suffix` (e.g. `$`, `kg`) are applied.
- [ ] **Person column** — shows `<N> people` + tiny coloured dots (max 4 visible, rest as `+N`) + "<M> blank" when any item has no assignee.
- [ ] **Date column** — shows earliest – latest range. If every value falls on the same day, only that date renders. Rose "<N> overdue" badge appears when at least one date is in the past.
- [ ] **Text / Long text** — "X / Y filled" count (long_text always; text only when NOT the primary cell, since primary mirrors `Item.name`).
- [ ] **File column** — "<N> files" total. Tooltip shows total files + items-with-files.
- [ ] **Hover tooltip works on every summary cell** — including blank `Empty` cells (which render `—`). Tooltips are positioned `top` and don't escape the viewport.
- [ ] **Collapsed groups** don't render a summary row (the body is hidden, summary is too).
- [ ] **`+ Add item` row still appears below the summary** when no filter is active. With a filter active, both the summary AND the add-item row hide consistently (summary stays; add-item hides — already in `flatRows` logic).
- [ ] **Primary text column shows blank** — no `0 / N filled` noise on the Item-name column.
- [ ] **Performance** — adding 200 items to a group renders the summary in <16ms (no jank). All summary computations are O(N · cols) per render and only run for `visibleItems`.

### Project Management — Freeze + Resize + Overflow Tooltips (added 2026-05-10)

#### Excel-style freeze (horizontal scroll)

- [ ] **Action menu (…), comment column, and primary `Item` column stay visible** while the rest of the columns scroll horizontally. Verifiable on a board with ≥ 5 dynamic columns: scrolling the table to the right does not move the leftmost three cells.
- [ ] **Frozen primary column matches the column header's name** — even after scrolling, the primary column header reads "Item" (or whatever the primary is named) and the cell content lines up underneath.
- [ ] **2-px box-shadow on the primary column's right edge** appears once the user has scrolled right (CSS box-shadow is always rendered; in practice it's only visible against the scrolling content).
- [ ] **Body row hover (`bg-muted/20`) still works on the frozen cells** — `group-hover:bg-muted/20` on action / comment / primary cells stays in sync with the hovered row.
- [ ] **Group header content stays visible** during horizontal scroll (chevron + group name + count + kebab menu wrapped in a `sticky left:0` inner div).
- [ ] **Summary row's `Σ`, comment slot, and primary slot freeze** along with the rest of the row.
- [ ] **`+ Add item` row's input is anchored** in the primary column's slot when scrolled right (no more flex-1 stretched input that disappears off-screen).
- [ ] **No stacking-context bugs** — the sticky header still overlays sticky body cells (top-left intersection looks correct). The filter popover, kebab dropdown, and resize handle all open ABOVE the sticky cells.
- [ ] **Existing virtualised scroll** (200 items per page) still performs without jank when scrolling horizontally then vertically.

#### Column resize

- [ ] **Every column header has a draggable 6-px handle** on its right edge. Cursor turns to `col-resize` on hover; handle highlights violet on hover and deeper violet while dragging.
- [ ] **Live resize during drag** — table re-renders cell widths in real time (no jump on pointerup).
- [ ] **Min width 80px** — dragging far left clamps to 80px; cell never collapses to zero.
- [ ] **Persist on pointerup** — `PATCH /api/v1/pm/columns/<id>/` is called with `{ width }`. Refreshing the page preserves the new width.
- [ ] **Primary column is resizable** — drag works on the (frozen) primary header. Width updates the sticky cell + all body rows in lockstep.
- [ ] **Resize doesn't trigger filter popover or kebab menu** (handle stops propagation on pointerdown / click).
- [ ] **Resize while filter is active** — works without breaking the filter chip bar or the active filter icon.
- [ ] **Resize doesn't break the virtualizer** — vertical scroll is still smooth after a column resize.
- [ ] **Backend tolerates the PATCH** — `pm.updateColumn` sends `{ width: <number> }` and the server accepts it (`ColumnSerializer.fields` includes `width`, no readonly).

#### Overflow tooltips

- [ ] **Hover any truncated cell** in the visible viewport shows a native browser tooltip with the full value. Cells covered: text, long_text, number, status (label), dropdown (label), priority (label), date (formatted), person (full_name or username). Checkbox + file cells have nothing to tooltip (no overflow).
- [ ] **Empty cells don't show a `—` tooltip** — the title attribute is omitted when the value is empty (browser shows no tooltip on hover, not "—").
- [ ] **Status / Priority pill tooltips work** — even though the pill is a colored background button, the title attribute on the button surfaces the option label on hover.
- [ ] **Tooltip respects edits** — after editing a text cell to a long value, hovering the cell shows the updated value.

### Project Management — General

- [ ] Every new ViewSet has `permission_classes = PM_PERMS`
- [ ] `Column.is_primary=True` rows cannot be deleted (HTTP 400)
- [ ] `apply_cell_value` + `serialize_cell` from `serializers.py` are the only place cell values are read/written — do not duplicate the type-dispatch logic
- [ ] When you change `Item.name` you also update the primary text cell value (already wired in `views.py:223-247`)

### One Helpdesk — Helpdesk scoping (added 2026-06-20)

The "One Helpdesk" (formerly ITSM) product now hosts multiple departments (IT, HR, …) on one platform, each a **Helpdesk**. A user only sees tickets in helpdesks they're an active member of. Row-level scoping lives in the **shared services** (`apps.itsm_helpdesks.services.accessible_helpdesk_ids`), not only in `TicketViewSet.get_queryset` — every entry below leaks today without its guard, so test each surface independently. The sentinel `None` from `accessible_helpdesk_ids` means **unrestricted** (superuser); a member of no active helpdesk gets `[]` (sees nothing).

**The 8 guard points** (each maps to one shared-service touchpoint):

- [ ] **Guard 1 — saved-filter / widget / bulk-by-filter results** — `query_builder.build_q` / `filtered_tickets` AND `project__helpdesk_id__in`. Run a saved filter whose `query_spec` would match tickets in another helpdesk → those rows are absent. (Covered by `test_saved_filter_results_are_clamped`.)
- [ ] **Guard 2 — bulk by explicit ids** — `POST` a bulk op (`TicketViewSet._bulk`) with a list of ticket ids that includes one from a helpdesk you're not a member of → the foreign id is silently clamped out (`project__helpdesk_id__in`), never mutated. (Covered by `test_bulk_by_ids_cannot_touch_other_helpdesk`.)
- [ ] **Guard 3 — list + detail + derived actions** — list endpoint omits other helpdesks' tickets; `GET /tickets/<foreign-id>/` and every id-derived action (transition / assign / comments) return **404** (not 403 — the row is simply not in `get_queryset`). (Covered by `test_list_excludes_other_helpdesk`, `test_detail_cross_helpdesk_is_404`.)
- [ ] **Guard 4 — create / links / apply_template reject inaccessible targets** — `POST /tickets/` into a project in a helpdesk you can't access → **403**. Same for adding a link to a foreign ticket and applying a foreign template. (Covered by `test_create_in_other_helpdesk_is_403`.)
- [ ] **Guard 5 — reports** — `itsm_reporting` `reports._base` / `sla_compliance` take `helpdesk_ids`; `ReportViewSet.retrieve` validates `?project=` belongs to an accessible helpdesk and keeps the clamp on the `TypeError` retry path. A report with no `?project` is scoped to the caller's accessible set by default. (Covered by `test_reports_reject_foreign_project`, `test_reports_default_base_is_scoped`.)
- [ ] **Guard 6 — dashboards** — `SavedFilter.results`, `WidgetViewSet.data`, and `widget_data.resolve` all thread `accessible_helpdesk_ids` → no widget shows counts/rows from a non-member helpdesk.
- [ ] **Guard 7 — SLA trackers** — `SLATrackerViewSet.get_queryset` filters `ticket__project__helpdesk_id__in` → the SLA list/at-risk surface never exposes a foreign ticket's clock.
- [ ] **Guard 8 — comment @mentions** — `POST` a comment whose `@mention` ids include a user who is NOT a member of that ticket's helpdesk → those ids are dropped (mention set is restricted to the ticket's helpdesk members), so no cross-helpdesk notification leaks.

**Transport / clamp & identity:**

- [ ] **Forged `?helpdesk=` can't widen scope** — `?helpdesk=<id|key>` is advisory only; `resolve_helpdesk_scope` intersects it with the server-computed accessible set. Passing a helpdesk id/key you're not a member of returns YOUR scope (or empty), never that helpdesk's tickets, and never a 403. (Covered by `test_helpdesk_param_cannot_widen_scope`.)
- [ ] **Superuser sees all** — a superuser (sentinel `None`) sees tickets across every active helpdesk; `auth/me`.helpdesks lists all active helpdesks. (Covered by `test_superuser_sees_all_helpdesks`, `test_me_lists_only_member_helpdesks`.)
- [ ] **Agent with no membership sees nothing** — a role-assigned agent enrolled in zero active helpdesks gets an empty queue everywhere (list, reports, dashboards, SLA), no errors. (Covered by `test_agent_without_membership_sees_nothing`.)
- [ ] **Per-helpdesk ticket-number prefix** — a ticket created in the IT Incident project is numbered `ITINC-1` (helpdesk `key` + project, not global `INC-1`); HR Request → `HRREQ-1`. Numbering stays unique per project. (Covered by `test_ticket_number_uses_helpdesk_prefix`.)
- [ ] **`auth/me` + login token carry `helpdesks`** — `ItsmUserSerializer.helpdesks` returns `[{id,key,name,icon,color}]` for the caller's active memberships (all active helpdesks for a superuser); appears in both `auth/me` and the login token payload, so the frontend HelpdeskSwitcher only lists reachable helpdesks.

**Greenfield seed verification:**

- [ ] **`seed_itsm` is re-runnable** — running it twice produces no duplicate helpdesks, projects, groups, or memberships (idempotent). Default helpdesks **IT** + **HR** seeded; per-helpdesk projects `ITINC` / `ITREQ` / `HRINC` / `HRREQ` exist; one namespaced Service Desk group per helpdesk (e.g. `it-service-desk` / "IT Helpdesk Service Desk") plus the 4 shared global teams.
- [ ] **Old global INC/REQ are gone** — after migrating a previously-seeded DB, the legacy global `INC` / `REQ` projects no longer exist (dropped by `itsm_projects` migration `0002_drop_legacy_global_projects`); every project now has a non-null `helpdesk` FK. On a fresh DB, `0002` simply no-ops.
- [ ] **Workflows / SLA / notifications stay global** — they're looked up by project with an `is_default` fallback that still fires for per-helpdesk projects (no per-helpdesk schema this phase).

**Backend test status:** `apps.itsm_helpdesks.tests.HelpdeskScopingTests` adds **12** isolation tests covering the points above; with the existing suites the ITSM backend is **44 tests pass**.
