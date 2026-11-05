# Bug Log — Ticketing System

Append-only log of fixed bugs. Newest first. Each entry: date, module, summary, root cause, fix location.

Format:

```
## YYYY-MM-DD — Module — One-line summary

**Symptom:** what the user saw.
**Root cause:** the actual bug.
**Fix:** file:line + what changed.
**QA hook:** which checklist item should have caught it (and now does).
```

---

## 2026-11-05 — Transitions + Modern menu + queue — "Resolution note" label, capture fields ignoring "show when" rules, rail flicker, two-line status chips (batch 2026-11-05c)

**Symptom 1 (GridCrest):** The "Put on Hold" transition's Note heading is "Reason to hold", but the agent's slide-over labelled the note editor "Resolution note" (the title and the saved comment were right).

**Root cause 1:** `TransitionNoteSheet` hard-coded `{screenFields.length ? "Resolution note" : heading}` — written in July when only Incident Resolve had a capture screen; any transition with capture fields got the Resolve label.

**Fix 1:** `frontend/components/tickets/ticket-detail.tsx` `TransitionNoteSheet` — the label is always the heading.

**Symptom 2 (GridCrest):** "Reason" has the rule "show when Pending Reason = other" (Fields → Settings → Conditional rule), but on the Put on Hold slide-over it was always shown and required.

**Root cause 2:** The rule lives on the ticket's layout (`FieldLayoutItem.visibility_rule`); the slide-over never received it and required every mandatory screen field, and the server (`engine._validate`) also returned 422 for any missing mandatory screen field regardless of the rule — so a browser-only fix would still have failed.

**Fix 2:** `backend/apps/itsm_workflows/services/engine.py` — `screen_layout_rules` + `_screen_rule_states` evaluate the rule with `field_service.visibility_state` (values = submitted overlay on the ticket's current ones, `status` = target status); `_validate` skips hidden / locked fields and `transition()` drops their submitted values. `itsm_tickets/views.py _resolve_screen_fields` returns `visibility_rule`; the slide-over evaluates it live with `evalRule`. Tests `itsm_workflows.tests.ScreenFieldLayoutRuleTests`.

**Symptom 3 (Modern):** Clicking the avatar at the foot of the menu and moving onto the user's name made the menu open and close repeatedly.

**Root cause 3:** The account menu is a modal Radix menu: it sets `pointer-events: none` on `<body>`, so moving the cursor fired `pointerleave` on the rail, which folded after 220 ms; the trigger shrank, the menu re-anchored under the cursor, and React's portal events (pointerenter / focus of a menu item) expanded the rail again — a loop. The helpdesk switcher in the menu head had the same problem.

**Fix 3:** `components/agent/workspace/modern-rail.tsx` — `useRailState.hold(open)` keeps the rail open while a rail menu is open (`UserMenu` / `AppSwitcher` gained an additive `onOpenChange`); on close it folds unless hovered or keyboard-focused; focus opens the rail only when `:focus-visible`, and Esc inside a menu no longer blurs the rail.

**Symptom 4 (Modern):** In a narrow window the queue's status chip wrapped ("In / Progress") onto two lines.

**Root cause 4:** The chip had no `white-space: nowrap`; the auto-layout table shrank the Status column to the chip's narrowest wrap.

**Fix 4:** `StatusBadge truncate` (one line, 104px max, name in a `truncate` span; tooltip has the full name), passed only by the Modern queue cells.

**Also logged (pre-existing, not changed generally):** `sla_engine.resume()` never refreshes `Ticket.due_date`, so a resumed resolution clock leaves the queue's due date stale until the next priority change / restart; the new approval sync (`sync_pauses`) does refresh it.

**QA hook:** QA_CHECKLIST "Batch 2026-11-05c" (capture rules, label, flicker sampling, chip height at 1240px).

---

## 2026-11-05 — Queue (Modern B3/B4) — Infinite scroll loaded every batch at once; P2 chips under 4.5:1 on the docked stage (caught in QA, never shipped)

**Symptom 1:** In the Modern queue the footer read "52 of 52 tickets" right after arrival instead of "25 of 52": every batch loaded back to back without scrolling.

**Root cause 1:** The load effect trusted `nearEnd`, the IntersectionObserver flag for the sentinel row. After an append the effect re-ran (new `tickets.length`) before the observer's next callback, so `nearEnd` was still `true` from before the append, and it loaded again, and again.

**Fix 1:** `frontend/components/tickets/ticket-queue.tsx` — the effect re-measures the sentinel (`getBoundingClientRect` against the pane) and loads only while it really is within `LOOK_AHEAD_PX` (120). The look-ahead was also cut from 200px, so a 1440×900 screen opens on one batch.

**Symptom 2:** axe flagged P2 priority chips (`bg-warning/15 text-warning`) in the docked queue at 4.48:1.

**Root cause 2:** The workbench stage behind the docked list was full `--muted` (#F0F1F2); the 15% warning tint over it lost just enough contrast.

**Fix 2:** a `--wb-stage` token (60% `--muted` mixed into `--card`) for the stage and the docked list header (`globals.css`, `modern-workbench.tsx`).

**QA hook:** QA_CHECKLIST "Modern interface — step B3 queue" (opens on "25 of N") and "step B4" (axe on the docked view). Rule of thumb: an observer flag is one callback stale after you change the DOM it watches; re-measure before acting on it.

---

## 2026-11-05 — Shell (Modern B2) — Pages with a description crashed with React error #185 in Modern (caught in QA, never shipped)

**Symptom:** In the Modern interface, Configuration, Tenant Settings → Users and Tenant Settings → Interface showed "Application error: a client-side exception"; the console said minified React error #185 (maximum update depth exceeded). The dashboard, which has no page description, rendered.

**Root cause:** `HeaderSlotProvider` built `setTitle` inside its `useMemo`, so it got a new identity whenever the title state changed. The teleported `PageHeader` has an effect on `[setTitle, titleText]` that sets the title and clears it on cleanup. Each title change → new `setTitle` → cleanup (`false`) + effect (`true`) → a new state object → re-render → new `setTitle` → … With an ⓘ (Radix tooltip) in the teleported title the loop ran inside a synchronous update and React aborted with #185; without one it spun quietly in passive effects.

**Fix:** `frontend/components/shell/header-slot.tsx` — `setTitle` is a `useCallback(…, [])` (one identity for the provider's lifetime) and the memo just passes it through.

**QA hook:** QA_CHECKLIST "Modern interface — step B2" → Modern shell: open a page with a description (Configuration, Users, Interface) in Modern and check the title + ⓘ render in the bar with no console error. Rule of thumb: a function from context that a child calls in an effect must have a stable identity (`useCallback` with no changing deps, or a state setter).

---

## 2026-10-31 — Email / Tickets — Tables in emailed replies lost their borders (GridCrest INC112)

**Symptom:** An agent replied by email with a table (Sr No / Employee Name / New Designation). The comment showed the text but no grid, so it read as loose columns.

**Root cause:** Two causes together:
1. `itsm_core/services/html.sanitize_html` allows `table/tr/td` but not `border`, `cellpadding` or `style`. Outlook's borders, which live in those attributes and in cell styles, are dropped, so the stored HTML is a bare `<table class="MsoNormalTable">`.
2. `.prose` is hand-written in `frontend/app/globals.css` (no `@tailwindcss/typography`) and had no table rules. Tailwind preflight leaves cells with no border.

GridCrest had 55 comments and 64 descriptions with tables.

**Fix (CSS only, user decision 2026-10-31):** `globals.css` gives every `.prose` / `.rte-content` table a light grid. Cells get `border border-border px-2 py-1 align-top`, `th` gets `bg-muted`, and cell `<p>` has `my-0`. A table is a block with `max-width:100%; overflow-x:auto`, and print borders are `#999`. Existing tickets are fixed by the same rule. Signature and layout tables get the grid too (accepted). The sanitizer is unchanged.

**QA hook:** QA_CHECKLIST "Email table grid, asset documents, automation Set field (added 2026-10-31)", plus the frontend rule "a tag in `ALLOWED_TAGS` needs a `.prose` style".

---

## 2026-10-31 — Automation — "Set field" couldn't set Users Affected (or most ITIL / multi-value fields)

**Symptom:** GridCrest INC → Automation → Then → Set field listed only Priority, Assignee, Group, Impact, Mode, Urgency, UserLocation and VIP User. "Users Affected" was missing.

**Root cause:**
- `itsm_automation/services/catalog.SETTABLE_COLUMNS = {"impact", "urgency"}`, although `update_ticket` writes all 12 ITIL columns (and they were already *watchable*).
- `SETTABLE_CF_TYPES` left out multiselect, cascade (e.g. Category) and group_picker.
- `actions.SETTABLE_BUILTINS` had no ITIL kwargs either.

**Fix:**
- `catalog.py`: `SETTABLE_COLUMNS = WATCHABLE_COLUMNS`. Column entries carry `field_type`. Multi-value custom types were added, and cascade entries carry their tree.
- `actions.py`: ITIL kwargs, plus `clean_column_value` with the same rules as `TicketViewSet.update`.
- `serializers._clean_set_field` validates every new type at save. Option checks now use **this project's** field definition, where the old dropdown check matched the key across projects.
- `automation-editor.tsx`:
  - a textarea for multiline;
  - the shared `CascadeSelect` (extracted from ticket-detail);
  - a single group select;
  - booleans start at No;
  - Yes/No, "A › B" and list labels in summaries.
- Tests: 6 new (28 total).

**QA hook:** QA_CHECKLIST 2026-10-31 section, plus the backend rule "a new editable ticket field also goes into the automation catalog and runner".

---

## 2026-10-31 — Assets — No place to keep an asset's invoice, warranty card or manual (feature)

**Symptom (request):** GridCrest wanted to save the invoice against each asset, plus a manual, warranty card or other document, in the asset page's right-hand rail.

**Built:**
- **Data and API:**
  - `itsm_assets.AssetDocument` with the Invoice / Warranty card / Manual / Other types, migration `0005_assetdocument`.
  - `services/documents.py` is the write path. Allowed types are PDF, images, Word, Excel and txt, up to 20 MB. The content type is decided from the extension. Each write logs `document_added` / `document_removed` to History.
  - `AssetViewSet` actions: `documents` (GET list / POST), `remove_document` and `download_document` (`FileResponse` attachment, `nosniff`).
  - `AssetDocumentPermission`: read to list or download, **update** to add or remove.
- **Privacy:**
  - Files sit under `media/itsm_private/` with random names.
  - nginx returns 404 for `/media/itsm_private/`; downloads go only through the authenticated API.
- **UI:** the `AssetDocuments` card between Tickets and History. PDFs and images open in a new tab from a blob URL; other files download.
- **Gotchas found:**
  - `getBlob`'s filename regex mis-parses Django's `filename*=` header for non-ASCII names, so the UI saves under `original_name`.
  - The prod nginx conf is a single-file bind mount. A host edit replaces the inode, so the running container keeps the old file until it is restarted or recreated. Verify with `docker exec ticketprod-nginx grep itsm_private …`.
  - The asset page had two unnamed `<aside>` landmarks (axe `landmark-unique`), so the right rail is now labelled.

**QA hook:** QA_CHECKLIST 2026-10-31 section, plus the backend rule "private files never get a public /media/ URL".

---

## 2026-10-29 — Email — Outlook web mail showed CSS text ("P {margin-top:0;margin-bottom:0;}") at the top of descriptions

**Symptom:** GridCrest INC127 (an onboarding request emailed in) began with `P {margin-top:0;margin-bottom:0;}` above "Dear Team,". The same text was in `description_text`, so it also showed up in search and Ticket Data.

**Root cause:** Outlook on the web / New Outlook put `<style type="text/css"> P {…} </style>` in `<head>` with no `<!-- -->` around it. `bleach.clean(strip=True)` drops a disallowed tag but keeps its CONTENTS as text, so the CSS survived both `sanitize_html` and `html_to_text`. The same applied to `<title>`, `<script>` (inert text), `<xml>`, `<template>` and `<noscript>`. Desktop Outlook wraps its CSS in a comment, which bleach removes, so it never showed this. `scrub._has_visible_content` also counted that CSS as visible text, so a signature-only cut could keep only the head and then sanitise to an empty body.

**Fix:**
- `itsm_core/services/html.strip_non_content()` removes `head/style/script/title/xml/template/noscript` blocks with their contents, plus an unclosed `<style>`/`<script>` to the end. `sanitize_html` and `html_to_text` call it before bleach, which is still the security boundary. That covers every rich body: email descriptions and replies, keyword routing, comments, KB, canned notes and templates.
- `itsm_email/services/scrub._has_visible_content` strips the same first.
- Tests: `itsm_core/tests_html.py` (8), `itsm_email` `OutlookWebStyleLeakTests` (2) + `ScrubSignatureTests.test_head_style_alone_is_not_visible_content`.

**Not done (user decision 2026-10-29):** tickets already created keep the stray text. There is no data migration; an agent can delete it by editing the description. Also still open: inline `cid:` images in email are dropped (the sanitizer strips the `cid:` src and attachments skip inline parts).

**QA hook:** QA_CHECKLIST "Ticket detail: frozen header, Show more, collapsible sections, asset top-3, Internal note button; email CSS leak (added 2026-10-29)".

---

## 2026-10-29 — Ticket detail — header scrolled away, long emails filled the page, 16 asset chips, plain-text "Internal note", no section collapse

**Symptom (GridCrest, 6 screenshots):**
- The header (number, status, title, actions) scrolled out of view.
- A long email description or reply trail made the page very long.
- A requestor with 16 assets filled the side rail with chips.
- "Internal note" looked like a label rather than a button.
- Sections couldn't be collapsed, and admins couldn't make one start collapsed.

**Root cause:** feature gaps. The only collapse was a hard-coded rule for an empty Resolution Details section. Sidebar sections were plain markup.

**Fix (frontend + one serializer):**
- **Frozen header:** `ticket-detail.tsx` wraps the header card in an opaque, edge-to-edge band, `md:sticky md:top-header z-30`. The band uses `-mt-main-y` and must stay the root's first child (the live-refresh pill moved to the end).
  - `useFrozenHeader` publishes `--ticket-head-h`, so the side rail sticks below the header, and only while it fits the viewport (a taller rail scrolls with the page).
  - It also sets `scroll-padding-top` on `<html>` and adds a shadow once scrolled.
  - Phones keep a scrolling header.
- **Show more:** new `components/ui/expandable-html.tsx` (`ExpandableHtml`): 6-line `line-clamp` + max-height fallback, and the toggle only when the content overflows. Used on the description (agent and portal), read-only rich-text fields and comments (agent and portal). On the description the click-to-edit body is `bodyProps`, so the toggle isn't a nested control.
- **Collapsible sections:** every main section is a collapsible `FieldSectionCard`, and the sidebar uses the new `SideSectionCard`.
  - `FieldLayout.sections[].collapsed` (JSON, no schema migration; `validate_sections` keeps it only when true, a non-bool value returns 400) drives `defaultOpen`.
  - Layout editor: a **Collapsed** switch on each section header. A seeded section is declared on first use, and a rename keeps the flag.
  - Cards are keyed by ticket id, so each ticket opens with the layout default (nothing is remembered).
- **Requestor's assets:** `RequestorSuggestions` shows 3 chips plus "Show N more" / "Show less".
- **Internal note:** an outline button, `border-primary/40 text-primary-ink`, the same height as the comment box.

**Found while testing:**
- At first, one-line-per-`<p>` comments were cut mid-line, because the `.prose p` margins pushed past the max-height before the line clamp. The fallback now allows a margin per line.
- Content peeked around the card's rounded bottom corners while scrolling. The band now has `pb-2 -mb-2`.
- axe flags the ticket metadata `<dl>` and the portal field `<dl>`s (`definition-list` / `dlitem`: `<div>` wrappers inside `<dl>`). These pre-exist and were not touched (open).

**QA hook:** QA_CHECKLIST "Ticket detail: frozen header, Show more, collapsible sections, asset top-3, Internal note button; email CSS leak (added 2026-10-29)".

---

## 2026-10-29 — Tickets — A deleted ticket (GridCrest REQ14) still sent emails

**Symptom:** GridCrest deleted REQ14, but the same day an email for it still went out from "Facility Bridge". The expected rule: after a delete, no email for SLA or any other event, and the ticket isn't in reports or dashboard counts.

**Root cause:** a ticket delete was a bare `soft_delete()`. `Ticket.objects` hid the row, but queries rooted at child models (and forward FKs like `row.ticket`) still saw it, and nothing told the engines:
- `sla_engine.scan_breaches` swept `SLATracker.objects.filter(state="running")` with no `ticket__is_deleted` filter. Each minute it could flip the breach, write `sla_breached` and fire `SLABreach` / `SLAWarning` escalations (most likely the REQ14 mail; the prod outbox row wasn't checked because prod reads needed approval).
- `outbox.flush` sent rows queued before the delete, retrying for hours (CSAT survey mail too, which skips `emit_event`).
- `hooks.emit_event` / `bus._emit` never checked `is_deleted`.
- Pending approvals stayed in the approver inbox and badge, and approve/reject/withdraw still worked and emailed.
- Escalation `raise_priority` / `reassign` on a deleted ticket raised `DoesNotExist`, aborting the rest of the org's sweep.
- CSAT summary/responses/KPI widgets counted deleted tickets. The bell, Linked issues, `ticket-links`, comment/watcher/attachment viewsets and KB links listed them.
- An inbound retry could add a comment to a deleted ticket.

**Fix:**
- `itsm_tickets/services/ticket_service.delete_ticket` = the one delete write site: soft delete + `sla_engine.withdraw_for_ticket` (clocks → `stopped`) + `approval_engine.cancel_pending` + `outbox.cancel_for_ticket` (→ `dead`, "Cancelled: ticket deleted"). Used by `TicketViewSet.perform_destroy` and bulk `op=delete`.
- Guards: `hooks.emit_event` + `bus._emit` early return; `outbox.flush` drops deleted tickets' rows; `scan_breaches` filter + per-tracker savepoint/try; `engine.pending_for` + `ApprovalRequestViewSet`; `reports._survey_base`; bell list/unread count (`itsm_notifications/views._live`); `_link_items_for` + `TicketLinkViewSet`; comment/watcher/attachment/comment-attachment viewsets; `ArticleTicketLinkViewSet`; `inbound._run_pipeline` retry → new ticket.
- Migration `itsm_tickets/0013_quiesce_deleted_tickets` quiets tickets deleted before the fix (clocks stopped, approvals cancelled, queued mail dead; bulk `update()`, no emails).
- FE: delete confirm names the effects; Help Center FAQ "What happens when a ticket is deleted?".
- Tests: `apps.itsm_tickets.tests_delete` (13).

**Still open (not in this fix):** `CommentViewSet`, `WatcherViewSet` and `TicketAttachmentViewSet` have no helpdesk clamp: anyone with the module permission can list another helpdesk's rows by `?ticket=`. Restore (undelete) of a ticket doesn't exist; if added, it must restart clocks deliberately.

**QA hook:** `docs/QA_CHECKLIST.md` "Deleted tickets are inert (added 2026-10-29)" + the "Deleted tickets" line under "After Any Backend Change".

---

## 2026-10-24 — Assets — No way to browse assets by category from the sidebar

**Symptom:** the user wanted ServiceDesk Plus's asset navigation: keep Asset List for all assets, and add an expandable category → sub-category tree that lists the assets of the node you click.

**Root cause:** a feature gap. Category filtering already existed (filter bar + URL `category` / `sub_category`, including `none`), but only through the filter dropdowns.

**Fix (frontend only):**
- `components/agent/workspace/asset-category-nav.tsx` (`AssetListNav`) in `workspace-nav.tsx`: Asset List + an arrow-toggled tree of categories and sub-categories with `asset_count`, a "No sub-category" bucket, links to the filtered list, an `aria-current` highlight, and the open state remembered in localStorage.
- The list header shows the branch.
- Copy: `ASSET_HELP.navTree`, Help Center "Browse by category".

**Found while testing:**
- A total count beside "Asset List" truncated the label at the 192px minimum sidebar width ("Asset …"), so it was dropped.
- On a click, the list header shows the new branch while the previous count lingers until the list reloads (same as any filter change today).

**QA hook:** QA_CHECKLIST "Assets: sidebar category tree under Asset List (added 2026-10-24)".

---

## 2026-10-24 — Users — No way to edit a user's name, email or manager

**Symptom:** on Tenant Settings → Users, the ⋯ menu only had Helpdesks & projects, Edit attributes and Reset password. The user asked to edit name, email and so on. GridCrest's 316 import-created accounts have no email, so a person who emails in gets a new account without their assets.

**Root cause:** a feature gap. `MemberViewSet` is read-only apart from create / role / active / password / attributes, and `User.manager` (used by "Requestor's manager" approvals) had no UI at all.

**Fix:**
- `members/{id}/update_profile/` for full name, email and manager.
  - The email must be unique, also against usernames.
  - No reporting loops.
  - Bots can't be edited, and a superuser only by a superuser.
  - Audited.
- `MemberSerializer.manager`.
- Users ⋯ → **Edit details** dialog, plus "Reports to …" on the roster row. Help copy and the Help Center are updated.
- Tests: `itsm_rbac/tests_edit_user.py`.

**Also answered:** how GridCrest assets match people with no email.
1. A one-off prep step turned each sheet name into a username: an existing account with the same full name, else a new `first.last` requester.
2. The standard asset importer then matched the User column by username (then email).
3. A ticket finds a requester's assets by account.

**QA hook:** QA_CHECKLIST "Users: edit name, email and manager (added 2026-10-24)".

---

## 2026-10-24 — Agent shell — Sidebar resize handle looked vertical, off-theme and too big

**Symptom:** the user said resizing the left nav works, but its hover look was vertical, off-theme and too big.

**Root cause:** on hover, the handle (`workspace-chrome.tsx`, `role="separator"`, deployed 2026-10-24) tinted its whole 6px × full-height strip `bg-primary/30` and used `cursor-col-resize`, which renders as a vertical bar on Windows. It had no grip.

**Fix (visual only; drag, keyboard, double-click reset and aria are unchanged):**
- `cursor-ew-resize` (↔) on the handle and on `body` while dragging.
- A 2px `bg-primary` hairline on the border (60% on hover, full while dragging or focused).
- A small round grip (20px, `bg-card`, `border-primary/40`, `text-primary-ink`, lucide `ChevronsLeftRight` 12px) centred on the edge. It shows on hover, focus and drag. It is `invisible` at rest, so it never blocks clicks; once shown it is part of the drag target. Pointer capture stays on the separator through `e.currentTarget`.

**Verified:** Playwright on an isolated stack, light + dark. The grip is hidden at rest and shown on hover, the cursor is `ew-resize`, drag works from the strip and from the grip, and double-click resets. `tsc` + `next build` pass. **Not deployed** (the user said "not yet").

**QA hook:** QA_CHECKLIST "Send for approval + On-fly approvers" → UI checks (sidebar handle line).

---

## 2026-10-24 — Approvals — Agents couldn't ask for sign-off mid-ticket; help copy was double-encoded

**Symptom:** the user asked for "Send for approval":
- the example: an In Progress incident turns out to be water damage, and the agent needs the requestor's manager to approve a replacement;
- a new **On fly** approver type, where the agent picks the approver from any user, a group or a listed set;
- a per-status workflow flag for where the button shows;
- standard notifications.

Approvals could only start from a transition's `request_approval` or a catalog item, with fixed approvers. Agents had only `itsm.approvals` read, so even the admin `start` API was closed to them.

**Root cause:** a feature gap.

**Fix (feature):**
- **Models:**
  - `ApprovalStage.approver_type="on_the_fly"`, plus `on_fly_pool` and `candidate_users`.
  - `ApprovalRequest`: `source` (`policy` | `sent`), `note`, `return_status`, `waiting_status`.
  - `ApprovalRequestApprover`: the picks per stage.
  - Migration `itsm_approvals/0004`.
- **`Status`:** `allows_send_for_approval` + `approval_waiting_status` (`itsm_workflows/0010`).
- **Service:** `itsm_approvals/services/send.py`, with `send_options`, `send_for_approval`, `withdraw` and `can_withdraw`.
- **Engine:**
  - Request-aware `resolve_approver_ids` / `stage_problem`.
  - `_picks_problem` and `normalise_picks`.
  - `pending_for` covers picks.
  - `return_from_waiting`; `decide` returns sent requests instead of `move_to_rejected`.
- **Workflow engine:** `move_for_approval` + the shared `_status_change_effects`, extracted from `transition()`.
- **API:** `GET approval-requests/send-options/`, `POST approval-requests/send/`, `POST approval-requests/{id}/withdraw/` (module `itsm.approvals.send`).
- **RBAC:** `itsm.approvals.send` (`itsm_rbac/0015`): Agent RWC, Supervisor and Admin full, others no access.
- **Guards:** the stage, transition (`validate_post_functions`) and catalog serializers refuse an On-fly policy anywhere it would start without picks. Status delete refuses a waiting target. The validator counts the waiting edge. The cloner remaps it.
- **Email:** an `ApprovalRequested` email gets **Sent by** / **Message** rows (`email_layout.wrap`, `approval_context.note/requested_by`).
- **Frontend:**
  - `send-for-approval-sheet.tsx`, `withdraw-approval-dialog.tsx`.
  - Header button in `ticket-detail.tsx`.
  - Panel and inbox show the sender and message.
  - Approval editor: On-fly type and pools.
  - Workflow editor: status settings + badge, On-fly policies disabled in Start approval.
  - Activity wording; help copy; Help Center articles `send-for-approval` and `admin-approvals`.

**Also fixed:** `frontend/lib/itsm/help/settings.ts` (untracked, last written 2026-10-23 18:59) had been saved double-encoded (UTF-8 read as Latin-1, then written as UTF-8). Every `—`, `→`, `“”` and box-drawing character in the project-settings tooltips would have rendered as `â€”`-style garbage on the next frontend build: 625 sequences.
- Repaired by a Latin-1 round-trip of each mojibake run.
- Verified against the live `ticketprod-frontend:latest` bundle, which has the correct `—` in the same strings.
- Backup of the broken copy: session scratchpad `settings.ts.mojibake-backup`.

**Also corrected (copy):** the Help Center said approvers "aren't emailed". They have been since G4 (2026-10-18).

**Verified (2026-10-24):**
- **Backend:** full suite 1005 tests. The only 3 failures were the known read-only-media attachment tests, and they pass on a writable copy. 21 new tests.
- **Migrations:** `makemigrations --check` is clean.
- **Frontend:** clean `npm ci` + `tsc` + `next build`.
- **Playwright on an isolated stack:** 18/18 agent checks (send → waiting → approve → return; send → withdraw; inbox message; Activity; 390px; axe on the drawer) and 6/6 admin checks.

**QA hook:** QA_CHECKLIST "Send for approval + On-fly approvers (added 2026-10-24)", including the mojibake grep.

---

## 2026-10-23 — Assets × Tickets — Tickets couldn't reference the asset they're about

**Symptom:** the user asked for phase 2 of Asset Management:
- an "Asset" system field on tickets;
- link assets on create, defaulting to the requestor's allotted assets, plus any other asset via a filtered picker;
- an Asset column in the Ticket Data report;
- each asset showing its tickets.

**Root cause:** a feature gap (`docs/itsm/ASSET_MAINTENANCE_PLAN.md` §8).

**Fix (feature):**
- **Link table:** `itsm_tickets.TicketAsset` + `Ticket.primary_asset` (migration `0012`).
- **Write path:** `services/ticket_assets.py`.
- **System field:** `asset` (`FieldType.asset_picker`, `itsm_core/0017` + `0018`), placed visible only where the helpdesk has asset categories.
- **Endpoints:** ticket actions `assets/`, `assets/unlink/` and `assets/primary/`; portal `my-assets/` plus an owner-checked intake; `assets/{id}/tickets/`.
- **Report:** Ticket Data `asset` / `all_assets`.
- **Frontend:** `AssetLinkField` (create, detail, portal) and the asset Tickets card.
- **Tests:** `itsm_tickets/tests_assets.py` (20).
- **Gotcha:** `validate_required` skipped every `NO_VALUE_TYPES` field. It now skips only attachments, so a Required Asset field is enforced.

**Found and fixed by the peer session:** the new sidebar "Resize navigation" `role="separator"` (`workspace-chrome.tsx`) had no `aria-valuenow` (axe critical on every agent page). It now always sets one (stored or measured width).

**QA hook:** QA_CHECKLIST "Asset Management phase 2: assets linked to tickets (2026-10-23)".

**Deployed:** onedesk prod 2026-10-24 ~04:35 UTC (with the approvals "Send for approval" feature; backup `backups/ticketing_system_predeploy_20261024-042412.sql.gz`).

---

## 2026-10-19 — Assets — No way to track IT assets; gotchas found building Asset Management v1

**Symptom:** the user asked for Asset Management in the helpdesk workspace, starting with basic IT assets: an Assets section (dashboard, list, report), a create form (General / Location / Allotment / Purchase / Details), a category → sub-category tree that decides the detail fields, configurable statuses mapped to a state type, and Excel import with row-level errors.

**Root cause:** feature gap (roadmap Q3 "Asset Management + Maintenance", `docs/itsm/ASSET_MAINTENANCE_PLAN.md`).

**Fix (feature):** new TENANT app `backend/apps/itsm_assets` (migrations 0001–0003) plus the workspace **Assets** section and **Configuration → Asset Configuration**. Skill: `.claude/skills/itsm-assets`. Gotchas fixed while building it:
- **DRF auto-validators blocked moving the default status.** A partial `UniqueConstraint(fields=["is_default"])` makes DRF add a field `UniqueValidator`; disabled per field, `save()` moves the flag (`itsm_assets/serializers.py`).
- **Expression constraints get no DRF validator** (`Lower(...)`), so duplicates would have been 500s. Serializers check `iexact`; views map `IntegrityError` → 400.
- **Postgres NULLs are distinct**, so two top-level categories could share a name. The constraint uses `nulls_distinct=False`.
- **Soft delete never fires PROTECT.** In-use checks for statuses, masters and categories are explicit.
- **DRF's default OrderingFilter re-sorted the asset list by FK ids.** The asset ViewSet turns the default backends off.
- **Export took 32 s for 4,500 assets** (one time-zone query per date cell). Now ~8 s, 14 queries.
- **Docs:** `QA_CHECKLIST.md` "After Any Frontend Change" still named the old `lib/api.ts`; it now names `lib/itsm/client.ts` + `lib/itsm/api.ts`.

**Found, NOT fixed:**
- **Every scheduler runs every job (prod).** The SLA, notifications and email schedulers each add a `DjangoJobStore` on the same `django_apscheduler` table, and APScheduler runs every due job in the store, so each job runs in all three. `docker logs ticketprod-scheduler` on 2026-10-18 showed ~125 "maximum number of running instances reached" skips per hour on the 1-minute `_sweep` (3 per tick). Impact: triple load, and duplicate work wherever a job isn't idempotent. The asset job avoids it (memory job store, `_CODING_RULES` rule 23). Reported to the batch session.
- **The ticket report export has no formula-injection guard** (`itsm_reporting/services/export.py` writes user text such as summaries straight into cells). Asset exports use `xlsx.put` (`_CODING_RULES` rule 22).

**QA hook:** QA_CHECKLIST "Asset Management v1: register, categories, statuses, import (2026-10-19)".

**Deployed:** onedesk prod 2026-10-20 ~03:20 UTC with the 2026-10-19 UI follow-ups (backup `backups/ticketing_system_predeploy_20261020-030929.sql.gz`, rollback tags `ticketprod-{backend,frontend}:rollback-20261020-030929`).

---

## 2026-10-19 — UI follow-ups — contrast, approval "View request", status chip aliases, mention styling, relevance sort cue, multiselect, queue footer (N14, N17–N21, N23)

**Symptom:** items left open after the 2026-10-18 batch (deployed 2026-10-19):
- **N14:** axe `color-contrast` on every agent page. Sidebar section headings were 3.15:1, "· None" labels 3.88:1, and brand-pink text on a pale pink tint (active nav, chips, mention chips) 3.94:1.
- **N17:** portal approvers had no obvious way to read a request before deciding. Only the small mono ticket number linked to it.
- **N18:** a saved filter holding a pre-copy workflow's status id showed a blank chip label and an unticked box.
- **N19:** @mentions rendered as plain text in the portal conversation and on the print sheet.
- **N20:** while searching, the Created header kept its "newest first" arrow although results were relevance-ranked.
- **N21:** multi-select custom fields were a free-text box on the agent and portal create forms. Visibility rules on a multi-select only matched when exactly one value was picked, and the rule editor offered no value picker.
- **N23:** on empty or short queues the footer floated under the table instead of sitting at the bottom.

**Root cause:**
- **N14:** `text-muted-foreground/70|/80` on real text. `text-primary` (exact #E60053) on `bg-primary/5–15`, an accepted trade-off of the 2026-10-18 brand-pink theme.
- **N17:** `approval-inbox.tsx` had only the number link.
- **N18:** `filter_fields.status_options_for_project` dedupes by key, so only the default workflow's id reached the client.
- **N19:** `MENTION_CHIP_CLS` was applied only in the agent comment list.
- **N20:** the backend ranks whenever `ordering` is the default (`search.has_explicit_ordering`), but `SortHead` didn't know.
- **N21:** `FieldControl` had no `multiselect` case (it fell to `default:` → `<Input>`). `evalRule` and `field_service.visibility_state` compared `String(list)`. `OPTION_CONDITION_TYPES` lacked multiselect.
- **N23:** the footer had no `mt-auto` in the fixed-height flex column.

**Fix:**
- **N14:**
  - New `--primary-ink` token (`338 100% 38%` light; same as primary in dark) as Tailwind `text-primary-ink`. It is swapped in for `text-primary` on every element that also carries `bg-primary/5|10|15` (22 places). It measures 5.2:1 on /10 and 4.8:1 on /15, and buttons and fills keep the exact brand pink.
  - The three faded text labels are now full `text-muted-foreground`: nav headings, "· None", the email-log reason.
  - Decorative icons and separators keep their opacity (WCAG-exempt).
- **N17:** an explicit "View request" (portal) / "Open ticket" (agent) ghost button beside Approve/Reject, with read-only hover help.
- **N18:** each status option now carries `aliases` (the other same-key ids). `use-filter-options` maps aliases to the label; `condition-value` ticks an option when its value or an alias is selected, and unticking clears all of them.
- **N19:**
  - New `components/ui/mention-styles.ts` holding `MENTION_CHIP_CLS` and `MENTION_PRINT_CLS`, re-exported from the editor, so read-only pages don't load Tiptap.
  - Portal conversation: chips.
  - Print sheet: semibold, since printers drop backgrounds.
- **N20:** `relevanceRanked = search && ordering === DEFAULT_ORDERING`. Created shows no arrow (`aria-sort=none`) and the hover text is `RELEVANCE_SORT_HELP`. The footer count adds "· sorted by best match".
- **N21:**
  - Module-level `MultiSelectField` checkbox group on the create form, shared by agent and portal through `FieldControl`.
  - Rule editor value picker for multiselect, with "matches when the picked values include this one" help.
  - Both evaluators now treat a list as "includes" (an exact `String()` match still works for older "a,b" rules; an empty list = no value).
- **N23:** `mt-auto` on the footer band.

**QA hook:** QA_CHECKLIST "Bug-fix batch (added 2026-10-18)" → "Follow-ups (2026-10-19)". Test: `itsm_core.tests_required_fields.VisibilityStateTests.test_multiselect_value_matches_when_list_includes_target`; the WS3 lineage test asserts `aliases`.

---

## 2026-10-18 — Bug-fix batch (≈50 items) — approvals, SLA, workflows, fields, reporting, notifications/portal, RBAC, search/KB, ticket detail, audit log

**Scope:** the user picked about 50 items (S/B/M/U/G ids) from the consolidated issue list. Critical findings from the research were added (A/K/R/C ids). Ten workstreams fixed them, each with tests. Plan and decisions: `~/.claude/plans/before-you-touch-any-deep-garden.md`. **Built and verified, NOT deployed.** Deploy pre-checks are in QA_CHECKLIST "Bug-fix batch".
- **Skipped by the user:** S1 (public `/media/`), S4 (login throttling/MFA), B10, B12, B13, B15, B19, U9, U15, G1, G3, G5, G7, G9, G10.
- **Migrations (dependency order):**
  1. `itsm_core/0014_fieldlayout_sections`
  2. `itsm_rbac/0014_backfill_enforced_module_grants`
  3. `itsm_core/0015_admin_audit_event`
  4. `itsm_core/0016_audit_module` (needs rbac/0014)
  5. `itsm_tickets/0011_search`
  6. `itsm_knowledge/0002_article_search_indexes` (needs tickets/0011)
  7. `itsm_knowledge/0003_flatten_kb_categories`
  8. `itsm_workflows/0009_request_rejected_status`
  9. `itsm_approvals/0003_request_mode_stage_ids_live_level_unique`
  10. `itsm_notifications/0004_approval_and_watcher_events`
  11. `itsm_surveys/0002_comment_required_needs_comment_box`
  12. `itsm_dashboards/0005_savedfilter_helpdesk`
  13. `itsm_dashboards/0006_backfill_savedfilter_helpdesk`

### ⚠ S8 (critical): the legacy `/users/` API listed users anonymously and let anyone make themselves staff

**Symptom:** found during research.
- `GET /api/v1/[t/<org>/]users/` returned the org's users with **no login**.
- Any logged-in user could `PATCH` their own row to `is_staff: true` and then set anyone's password, which is a full account takeover.
- An unused legacy session `auth/login|logout|me` sat beside it.

**Root cause:** the legacy `apps.accounts` router was mounted for every org (`core/urls.py`). Its `IsStaffOrSelfReadOnly` allowed every safe method to anyone, and self-edits went through a full `UserSerializer`.

**Fix:**
- `apps/accounts/views.py`: `UserViewSet` is now a `ReadOnlyModelViewSet` gated by `IsItsmAgent` (`check_permission(user, "itsm.tickets", "read")`).
- It returns `UserDirectorySerializer` (`id, username, full_name, email`) for active users only, with no bots. The requestor and watcher pickers still use it.
- `apps/accounts/urls.py` registers only `users`. The legacy session auth routes are gone; every app signs in with JWT `itsm/auth/login/`.
- User writes go only through the RBAC users admin. `UserSerializer` is kept for `create_user`.

### Approvals & catalog (B1–B4, U1–U3, U7, G4, A1, A2, Rejected status)

**Symptom:**
- **B1:** a stage with no resolvable approver froze the ticket until a superuser decided. The same happened for "Requestor's manager" when there was no manager.
- **B2:** the "Require approval" gate passed after a rejection.
- **B3:** three problems:
  - "Parallel" mode was ignored.
  - Inactive approval workflows still started.
  - Re-adding a level after a soft delete hit `UniqueConstraint(workflow, level)`.
- **B4:** a catalog item flagged "Needs approval" with no workflow, or an inactive one, started nothing.
- **U2/U3/U7:**
  - Approve/Reject showed to people who couldn't decide.
  - Rejecting needed no reason.
  - The inbox had no ticket link.
  - Stages showed "Specific user" instead of the approver's name.
- **G4:** approvers were never emailed.
- **A1:** `POST approval-requests/start/` was open to any logged-in user on any ticket, so anyone could freeze any ticket.
- **A2:** the approval-request list had no helpdesk clamp, so requestors saw every ticket number and summary.

**Root cause:**
- `start_approval` never validated stages.
- Approval start ran post-commit through a swallow-all hook, so a failure couldn't roll the transition back.
- The gate checked for "any approved request", not the latest one.
- The mode wasn't stored on the request.
- `start` sat outside module RBAC, and the list queryset wasn't clamped.

**Fix** (`apps/itsm_approvals/`, migration `0003`):
- **B1**
  - `ApprovalStageSerializer.validate` requires a set, active target and checks `min_approvals` and live-level uniqueness. `level` is optional and defaults to max+1. "Requestor's manager" can carry a fallback `approver_user`.
  - `engine.stage_problem` / `ensure_startable` raise `ApprovalStartError`, a 400 `TransitionError`.
  - The new **non-swallowing** `hooks.begin_approval` runs inside `engine.transition` (step 6d) and inside create, so a refusal rolls the whole write back.
  - If a stage breaks after the approval started, approve is refused atomically and `blocked_reason` is shown. Reject still works.
- **B2:** the gate uses the latest non-cancelled request.
- **B3**
  - `ApprovalRequest.mode` and `stage_ids` are snapshotted on the request.
  - In parallel mode, one click counts for every stage the user is eligible for.
  - An inactive workflow starts nothing from a transition; the API and catalog start return 400.
  - Conditional unique `uniq_approval_workflow_live_level` (`is_deleted=False`).
  - A superuser's approval completes the stage.
- **B4:** `CatalogItemSerializer.validate`, plus a check in `raise_from_catalog` before create. `start_approval` runs in the same transaction.
- **U2/U3/U7 (API):** `pending_stages[]`, `can_decide`, `blocked_reason`, `mode`, ticket keys, `approver_*_name`, `approver_problem`.
- **U2/U3/U7 (UI):**
  - Panel buttons show only if `can_decide`, with "Waiting for…" and a history line.
  - "No approver" badge.
  - Inbox ticket numbers link to the ticket.
  - `reject-approval-dialog.tsx` requires a reason (the API returns 400 on a blank one).
  - The editor gained a Mode select and an Active switch.
- **G4:**
  - `ApprovalRequested` fires per newly pending stage (context `approval_request` + `stage`), plus `ApprovalGranted` / `Rejected` / `Cancelled`.
  - New `pending_approver_users(ticket, stage=None)`.
  - Audit events `approval_requested` / `approved` / `rejected`.
- **A1:** `start` needs `itsm.approvals` create plus project access (404 otherwise).
- **A2:** list and retrieve are clamped to accessible helpdesks/projects, plus the user's own requests and the ones they approve.
- **New, Rejected request:** a rejection runs `engine.move_to_rejected` after commit as `automation-bot` (reason added as a comment) into the new `rejected` status (see Workflows).

### SLA & calendars (B7, B8, B9, M5, C1, C2, C3, C7-bulk)

**Symptom:**
- **B7:** `Holiday.recurring_annually` was ignored.
- **B8:** a blank target fell back to an arbitrary other priority's target (`metric.targets.first()`, unordered) or 480 min, and targets didn't follow priority changes.
- **B9/C1:** a new calendar had no hours, so SLAs fell due immediately. An hours-less calendar also **crashed the whole tenant's breach sweep** and returned 500 from `/tickets/{id}/sla/`.
- **M5:** the queue SLA bar (wall-clock) disagreed with the detail panel (business time).
- **C2:** re-adding a deleted holiday or target returned 500 (unique row).
- **C3:** stopping a paused clock ignored hold time, so resolving from Pending produced a false breach.
- **C7:** bulk priority change bypassed audit, automation and SLA.

**Fix** (`apps/itsm_sla/`, no migration):
- **B7:** `CalendarSpec.annual_holidays` + `is_holiday` (`business_time.py`). A recurring holiday applies from the year entered onward; 29 Feb falls on 28 Feb in non-leap years. `spec_from_calendar` is the only place holidays are evaluated.
- **B8: a blank target means no SLA**
  - `_target_minutes` returns `None`, so no tracker is started.
  - `sla_engine.on_priority_change(ticket, old, new, start_missing=True)`, called via `hooks.sla_priority_changed`, does the following:
    - re-targets running clocks, keeping their start and pauses
    - withdraws a clock whose new target is blank (soft delete + `due_date` cleared)
    - restores a withdrawn clock
    - starts missing clocks backdated to the start event
    - leaves finished clocks alone
    - re-derives `breached`, as in JSM
  - Audit: `field_changed` with key `sla`.
  - **Call sites:**
    - `update_ticket._after` (also used by impact×urgency, automation `set_field` and bulk)
    - `move_ticket` (with `start_missing=False`)
    - escalation `raise_priority` (now goes through `update_ticket`)
    - the workflow engine
- **B9/C1**
  - A calendar with no hours is treated as 24×7 in its timezone, with a warning (`always_open_spec()`). `_due()` never returns "due now".
  - `services/calendars.ensure_default_hours` gives new calendars Mon–Fri 09–17 (`perform_create` + seed).
  - UI: a "No working hours" badge and an amber warning in the SLA editor.
- **M5:** `sla_engine.timer_snapshot(tracker, now=None, calendar_cache=None)` returns `{elapsed_minutes, percent_used, breached, rag}`.
  - It feeds `countdown_payload`, the list `sla` entry (calendar cache shared per request) and `scan_breaches`.
  - A paused clock's elapsed time freezes at `paused_at`. `SlaBar` uses `percent_used`.
- **C2:** `_create_or_revive` for holidays and targets.
- **C3:** `_close_open_pause` runs before stop.
- **C7 (bulk):** values are validated, and the write goes through `update_ticket`.

### Workflows & assignment (B14, B17, U4, U6, C5, C7-engine, R3, Rejected status)

**Symptom:**
- **B14:** the "(create)" transition never ran (tickets started at `is_initial`), and `engine.transition()` accepted a `from_status=None` transition from any status.
- **B17:**
  - A field condition on a field the project doesn't have blocked the transition.
  - A cascade condition was satisfied by a non-leaf value.
  - Assign's round-robin overwrote an existing assignee.
- **U4:** transition buttons humanised raw keys and never said why they were unavailable.
- **U6:** editing a shared workflow silently changed every project that used it.
- **C5:** deleting a status left its transitions live, so tickets could move into a deleted status.
- **C7:** the `set_priority` post-function and screen priority field bypassed audit and SLA.
- **R3:** routing rules weren't limited to the user's helpdesks.
- **Status filter:** the queue status filter offered only one workflow's statuses.

**Fix** (`apps/itsm_workflows/`, `apps/itsm_groups/`, migration `itsm_workflows/0009`):
- **B14**
  - New engine helpers: `create_transition_for`, `start_status_for`, `apply_create_transition` (fill-only assign, stamps), `begin_create_approvals` (refusal → 400) and `run_create_deferred`.
  - A create transition on an existing ticket → 400. A transition into a deleted status → 400. `from_status=None` is offered only when `is_global`.
  - The validator reports errors and warnings. The serializer returns 400 for a second create transition or a create into Done.
  - Editor: From is required, with an "Any status (global)" option and a "never runs" badge.
- **B17**
  - (a) Rules on fields the project doesn't have are skipped (`_applicable_field_defs`).
  - (b) A cascade rule needs a leaf value (fail-open on unknown).
  - (c) New `itsm_groups.services.pick_assignee_if_unassigned`; `auto_assign` never overwrites an assignee (all orgs).
- **U4**
  - `TransitionSerializer` adds `to_status_name/category` and `from_status_name`; the graph adds `is_default`.
  - `engine.blocked_reasons` puts a `blocked_reason` on each available transition. The button is disabled with a `Hint`, and the list refetches after inline edits.
- **U6**
  - `services/cloner.clone_workflow`.
  - New endpoints: `GET workflows/{id}/usage/` and `POST workflows/{id}/clone/`.
  - UI: a "Shared by N projects" banner, "Make a copy for this project" and an auto-assign badge.
  - Automation rules are repointed on clone (`itsm_automation/services/workflow_remap.repoint_project_rules`).
- **C5/U1:** `StatusViewSet` refuses to delete an in-use or start status, and a status delete soft-deletes its transitions. Confirms added.
- **C7:** the engine logs `priority_changed` and calls `hooks.sla_priority_changed`.
- **R3:** `RoutingRuleViewSet` is clamped to the user's helpdesks; global rules are writable by superusers only.
- **Status filter:** `filter_fields.status_options_for_project` plus `query_builder` `status_lineage_ids`.
- **Rejected status (migration 0009 + seed)**
  - Adds a `Rejected` status (`#dc2626`, done category) and a "Reject" transition from New, gated by the new condition `approval_rejected`.
  - Applied to every default service_request workflow. A workflow is skipped if it already has a `rejected` key or has no live `new` (`seed.ensure_reject_gate`).
  - `rejected` is terminal like closed: the engine emits Closed and writes the closed audit. No CSAT.
- **Lead fix:** `itsm_notifications/services/bus.py` maps both `Resolved` and `Closed` for a ticket entering `rejected` to `StatusChanged` (ApprovalRejected wording), so the requestor never gets a generic "resolved/closed" email.

### Fields, layouts & forms (B5, B20, B21, B22, U13, C5)

**Symptom:**
- **B5:** `validate_required` ignored `visibility_rule`, so a hidden Required field blocked portal submit. Agent create never called it.
- **B20:** the column pickers saved only visible keys, so hidden columns lost their order.
- **B21:** a visibility rule could be saved with an empty value. Status and checkbox values were typed by hand.
- **B22:** "+ Section" used `window.prompt`, and empty sections weren't saved.
- **U13:** the portal pre-selected P3 and showed the admin text "No options configured yet."
- **C5:** deleting a cascade node left its children live.

**Fix** (migration `itsm_core/0014`):
- **B5:** `validate_required(..., portal_only, columns)` skips the following:
  - hidden fields, and Portal-off fields on the portal
  - fields hidden or read-only by a rule (new `visibility_state()`, the server twin of `evalRule`)
  - option fields with no choices (`has_choices()`)
  - attachments, deleted fields and inapplicable globals

  Agent create in `TicketViewSet.create` returns 400 `{key: [msg]}`. System creates are untouched.
- **B20:** the full column order is stored, with `!key` meaning hidden. This is backward- and forward-compatible, with no migration.
  - FE: `decode/encodeColumnLayout` in `queue-columns.tsx`.
  - BE: `clean_queue_columns` keeps `!` keys, and `QueueColumnPreferenceSerializer.validate_columns` is new.
- **B21:** an empty value blocks save, inline and server-side (`validate_visibility_rule` → 400). Status is now a select from the workflow; checkbox is Yes/No.
- **B22:** inline `NewSectionInput`. `FieldLayout.sections` persists empty sections, which can be deleted with a confirm.
- **U13:** no P3 pre-select; Priority follows the layout's Required flag. Option-less fields are hidden on the portal.
- **C5:** `FieldOptionViewSet.perform_destroy` soft-deletes the subtree. The confirm states the descendant count.

### Reporting & dashboard (M1–M4, M6, M7, B18)

**Symptom:**
- **M1:** "Mins overdue" measured breach-detection lag (`breached_at − due` ≈ 1 min).
- **M2:** SLA compliance counted timers, not tickets, and stopped timers counted as met.
- **M3:** resolution time was wall-clock.
- **M4:** agent performance listed only agents with resolved tickets.
- **M6:** most tiles ignored the Period picker.
- **M7:** the card said "Tickets by group", and nothing linked to Reports.
- **B18:** dashboard boundaries used the browser's local date, while the backend buckets by UTC.

**Fix** (`apps/itsm_reporting/`, no migration):
- **M1:** `sla_breach_list.minutes_overdue` is now business minutes from due to `stopped_at` / `paused_at` / now, plus `finished_at`. UI shows "Overdue by"; export has "Overdue by (business min)" and "Finished".
- **M2:** `sla_compliance` covers tickets, First-response and Resolution metrics only.
  - Stopped, cancelled and soft-deleted timers are excluded. A running timer past due counts as breached.
  - Headline per ticket (met only if all its timers were met), plus `by_metric[]`. The group filter is honoured.
- **M3:** new `services/business_hours.BusinessClock`.
  - Calendar precedence: project → project SLA policy (else tenant default) → default → wall clock.
  - Tickets resolved in the range, including unassigned ones.
  - Dashboard Avg resolution = weighted average of the per-priority rows.
- **M4:** rows = resolved in range ∪ live open backlog. Names use `full_name` → first+last → username.
- **M6:** every history tile is period-driven. Live tiles carry a **Now** chip (`NowTag`). Distribution drills add `created_at > boundary`. The trend is zero-filled. "Updated HH:mm" indicator; the pulse token includes a 5-minute bucket.
- **M7:** "Tickets by team", a Reports card on agent home (`itsm.reports` read) and "All helpdesks ↗".
- **B18:** `utcDay()` / `periodWindow(days)` use UTC everywhere.
- `_open_sla_index` uses `timer_snapshot`, so at-risk counts agree with the queue bars. SLA tiles are hidden without `itsm.reports.sla`, and the leaderboard without `itsm.reports.agent`.

### Notifications, portal, password reset, surveys (S3, G4, U3/U13 portal, U5, U14, B6, B24, C2-watcher)

**Symptom:**
- **S3:** "Internal note added" alerts went to **watchers**, including colleagues a requestor added. A privacy leak.
- **G4:** no approval or "you were added as a watcher" emails.
- **Portal:** approvers and watchers couldn't open a portal request.
- **U14:** there was no password reset at all.
- **U5:** opening the bell marked everything read, and items weren't links.
- **B6:** `comment_required` with the comment box off made a survey unsubmittable.
- **B24:** the feedback Submit button was disabled with no visible reason.
- **C2:** re-adding a removed watcher returned 500.

**Fix** (migrations `itsm_notifications/0004`, `itsm_surveys/0002`):
- **S3:** `recipients.restrict_audience()` runs in `bus._emit` for `CommentAddedPrivate`, `SLAWarning`, `SLABreach` and a private `Mentioned`. Only helpdesk agents are kept (plus `comments_private` read for notes), and removed watchers are excluded.
- **G4: new events**
  - New events: `ApprovalRequested` / `Granted` / `Rejected` / `Cancelled` and `WatcherAdded`.
  - New recipients: approvers (`pending_approver_users`) and the added watcher.
  - `stage` is part of the dedupe key, and links match the audience.
  - Migration 0004 seeds 5 templates and 5 rules on the default scheme and each project scheme. `ApprovalCancelled` is seeded off.
  - Entering `rejected` is sent as `StatusChanged` with the ApprovalRejected template; it shares one dedupe ref, so each person gets one email.
- **Portal read-only matrix**
  - `portal_viewable_tickets` = requestor, watchers, and acted or pending approvers.
  - List and pulse are requestor-only; detail returns `viewer_role`.
  - Writes are requestor-only (403); a stranger gets 404.
- **C2:** new `ticket_service.add_watcher` restores a soft-deleted row, audits `watcher_added` and emits `WatcherAdded` (except for self-adds).
- **U14: password reset**
  - Endpoints: `POST itsm/auth/password-reset/`, `validate/` and `confirm/` (`accounts/password_reset*.py`).
  - The token includes the schema; it lasts 60 min and works once.
  - No email for bots, SSO users, accounts without a usable password, or inactive users.
  - Delivery: the outbox via `hooks.send_password_reset_email`, From `formataddr(branding name, PLATFORM_NOTIFY_FROM)`.
  - FE: `(auth)/forgot-password` and `(auth)/reset-password`; the login label is now "Username or email".
- **U5:** per-item read and link, "Mark all as read", `useLivePoll`. The bell is also in the portal header.
- **B6:** `comment_required(config)` = enabled AND required. The serializer returns 400, and the editor shows a Hint.
- **B24:** the reason is shown under the Submit button.
- **Lead fix:** the portal home Approvals card and the agent `ApprovalsBell` are gated on `itsm.portal.approvals` read, like the portal nav. Users with no role still see them.

### RBAC, saved views, helpdesk admin (S2, S5, S6, S7, R1, R2, C6, B23, U8, U10)

**Symptom:**
- **S2:** `get_email_bot()` cached the bot process-wide, across tenants.
- **S5:** personal saved views showed in every project's queue, and views shared from All Tickets reached the whole tenant.
- **S6:** three missing guards:
  - Built-in roles could be deleted.
  - Superusers and bots could be deactivated through the API.
  - The console could deactivate the only admin.
- **S7:** four modules were never checked: `itsm.tickets.create`, `itsm.reports.sla`, `itsm.reports.agent` and `itsm.portal.approvals`. The Layout tab and Routing UI used different permissions from the API.
- **R1:** a soft-deleted role still granted its permissions.
- **R2:** widget data wasn't limited to dashboards the user owns or that were shared with them, and project default-view validation ignored the view's helpdesk.
- **C6:** agents couldn't delete their own saved views.
- **B23:** a helpdesk created in the UI had no lead and no projects.
- **U8:** the ★ default-view star couldn't be toggled off.
- **U10:** there was no way to edit an inactive helpdesk.

**Fix** (migrations `itsm_rbac/0014`, `itsm_dashboards/0005` + `0006`):
- **S2:** the system-user cache is keyed by `connection.schema_name`.
- **S5:** new `SavedFilter.helpdesk`, backfilled by 0006 (it prints counts per schema). `get_queryset` scopes by `?project` / `?helpdesk` / none (clamped). The serializer returns 403/400. All Tickets lists views with its helpdesk and offers "Share with helpdesk".
- **C6:** `_OwnViewOrDelete`.
- **S6**
  - Built-in roles can't be deleted or have their code or active flag changed.
  - A role in use can't be deleted (400). `user_count` is exposed.
  - `set_active` refuses superusers and bots (`is_system_account`).
  - The console `org_user_guard` keeps at least one active superuser and protects bots.
  - The UI disables these controls with Hints.
- **S7**
  - `TicketViewSet.create` checks `itsm.tickets.create`.
  - `REPORT_MODULES`: the SLA reports need `itsm.reports.sla`; agent-performance needs `itsm.reports.agent`.
  - `CanUseApprovalInbox` gates `my-pending`, approve and reject on `itsm.portal.approvals` read. Users with no role are exempt.
  - The Layout tab uses `itsm.fields.layouts:update`. Routing uses `canCreateRules` / `canDeleteRules`. The Create menu is gated.
  - `itsm_rbac/0014` writes explicit grants equal to each role's previous effective access, so nobody gains or loses anything on deploy.
- **R1:** `get_user_role` ignores soft-deleted roles.
- **R2:** `WidgetViewSet` is limited to own or shared dashboards. `validate_default_view_key` accepts only a view shared on that project or from its own helpdesk's All Tickets; anything else is saved as blank.
- **B23:** the creator becomes lead. `with_standard_projects` imports INC + REQ (errors are non-fatal), and the dialog checkbox is on by default.
- **U8:** `POST queue-view {view_key: ""}` clears the default.
- **U10:** an admin-home User Attributes card, and `components/admin/helpdesk-edit-dialog.tsx` for inactive helpdesks.

### Search & KB (G6, B16, U12, K1)

**Symptom:**
- **G6:** ticket search was DRF `SearchFilter` `icontains` over number, summary and description: no typo tolerance, no ranking, no comment search.
- **Category delete:** articles kept pointing at the deleted category (the dialog promised "uncategorised"), and children stayed parented to a deleted row.
- **B16:** "Save draft" on a published article kept it live, and re-parenting a category that had children hid the grandchildren.
- **U12:** articles couldn't be archived.
- **K1:** `/kb-articles/` returned drafts, internal and archived articles to requestors, and `/kb-article-links/` leaked titles. The agent KB list was capped at 25.

**Fix** (migrations `itsm_tickets/0011`, `itsm_knowledge/0002` + `0003`; `django.contrib.postgres` added to `SHARED_APPS`):
- **G6:** `itsm_tickets/services/search.py` (`search_tickets` + `TicketSearchFilter`) matches on any of these:
  - substring
  - number forms and move aliases
  - FTS prefix
  - trigram on `UPPER(summary)`
  - comment FTS (private comments only with `comments_private` read; capped at 1000)

  1–2 characters fall back to substring on number + summary. Ranking applies only with the default sort. Pulse uses the same WHERE.
  - Migration 0011 installs `pg_trgm` **WITH SCHEMA public**, or moves it there, and adds 5 GIN indexes. Indexed text is capped with `Left(…, 100000)`.
  - KB: `itsm_knowledge/search.py` `ArticleSearchFilter`, used by `/kb-articles/` and the portal `/kb/`.
- **B16**
  - `status` is read-only on the API; the lifecycle is `services.publish` / `unpublish` / `archive` / `restore`.
  - Editor buttons: "Save & keep published" and "Unpublish & save as draft".
  - One-level category nesting is enforced (400), and 0003 flattens existing trees.
  - Deleting a category un-categorises its articles and promotes its children.
- **U12:** `POST kb-articles/{id}/archive|restore/`. The list hides archived articles unless `?status=` is given.
- **K1:** `can_author_kb()`: non-authors see only published, portal-visible articles. `/kb-article-links/` is authors-only and ticket-scoped. FE: `helpdesk__isnull` filter; `kbAllPages` fetches 500 per page, up to 20 pages.

### Ticket detail, mentions, email UX (U17, G2, U11/C4, U16, B11, U18)

**Symptom:**
- **U17:** the detail view never refreshed, and two agents silently overwrote each other.
- **G2:** @mentions didn't exist in the composer.
- **U11/C4:** the canned picker never showed personal or org-wide responses (`?helpdesk=` is an exact match), and lists were capped at 25.
- **U16:** the email log showed raw outcome codes.
- **B11:** turning off create-requestor left tickets with no requester, and `default_requestor` wasn't in the UI.
- **U18:** `workspace-tabs.tsx` was dead code.

**Fix** (no migration):
- **U17**
  - `GET tickets/{id}/pulse/` (scoped by `get_object`). When idle, the detail applies changes silently; when busy, it shows an "Updated by X — Refresh" pill.
  - `update_ticket(expected_updated_at)` / `set_custom_fields` + `ensure_fresh` → **409 `{code: "stale_write"}`** (400 on a bad token).
  - Only interactive PATCH and set-fields are guarded; automation, email, bulk, transition, assign and portal writes are not.
  - Custom-field edits now bump `updated_at`.
- **G2:** `mention_ids_in(html)` and `mentionable_users(ticket)` (active agents who are helpdesk members), plus `GET tickets/{id}/mentionable/?term=`. The comment POST returns 403 `{invalid_mention_ids}` for out-of-set ids. The RTE `mentions` prop renders chips.
- **U11/C4:** `?for_helpdesk=` returns this helpdesk's notes + org-wide + own personal, with `page_size` 200. The picker groups results and `scope-badge.tsx` labels each one.
- **U16:** `outcomeLabel` / `statusHelp`.
- **B11:** `default_requestor_detail`, a form picker and a "No requestor" badge. A default requestor is required when create-users is off and the payload touches either field.
- **U18:** `workspace-tabs.tsx` deleted.
- The activity feed renders `approval_*` (with the reason), `watcher_added/removed` and SLA re-targets.

### Admin & security audit log (G8)

**Symptom:** there was no record of who changed roles, users, config or sign-ins.

**Fix** (migrations `itsm_core/0015`, `0016`):
- New append-only `AdminAuditEvent` (TENANT).
- `itsm_core/audit_mixin.AdminAuditMixin` is the base of `ItsmModelViewSet` and `MemberViewSet`. It snapshots in `initial()` and diffs in `finalize_response()` for module codes in `services/audit.AUDITED_AREAS` (no ticket, comment, canned, template, saved-view, dashboard or KB traffic).
- `AuthAuditMixin` logs login, failed login, password changes and SSO callback failures. `ConsoleUserAuditMixin` logs "Platform admin: <name>" in the org schema. Password reset events are logged too.
- Secrets are redacted (EncryptedField + name patterns). The IP comes from XFF `[-AUDIT_TRUSTED_PROXY_HOPS]` (default 2).
- Viewer: `GET itsm/audit-events/` with `/facets/` and `/export/` (CSV, 10k cap, formula-escaped, and the export itself is logged). It needs `itsm.admin.audit` read: Admin has full access; Supervisor, Agent and Requestor are explicitly denied.

### Confirmations (U1, all areas)
Delete and remove actions that were immediate now confirm. The full list:
- approval workflow and stage
- holiday, calendar window or day off, and an SLA save that clears a target
- status and transition
- field, option, cascade node and layout item
- saved view and project filter
- linked issue
- routing rule, email routing rule, and allow/block rule

Watcher remove still has no confirm.

**Found, NOT fixed / still open after the batch:**
- **Email:**
  - Reply-to-closed "Create a new ticket" (still comment-only).
  - The per-mailbox poll interval can't go below the global tick.
  - On their next save, mailboxes with create-requestor off and no default requestor must pick one.
  - The email OAuth callback completion isn't audited.
- **Reopen:** `ReopenRule.window_days` is still unenforced.
- **SLA:**
  - The `applies_to.priority` policy switch isn't followed.
  - A withdrawn period counts as elapsed.
  - Lowering priority can clear a breach (by design, JSM).
  - There's no dedicated `sla_recalculated` audit action.
- **Reporting:** business resolution time includes on-hold time, and compliance still filters on created date.
- **Approvals:**
  - Stages can't be edited in place.
  - An actor who is also the next-level approver isn't notified (the inbox still shows it).
  - **Fixed 2026-10-19 (N17):** the inbox has no "view request" link to the portal.
- **Workflows:**
  - **Fixed 2026-10-19 (N18):** the filter chip label is missing for pre-copy status ids.
  - After a clone, open tickets miss status-specific automation.
  - A re-seed could repoint a custom "Reject" transition.
  - `assigned_at` is re-stamped when the assignee is kept.
  - Portal transitions lack `to_status_name`.
- **Fields:**
  - `TicketCreateSerializer` drops Resolution Details on create.
  - Catalog create doesn't validate required fields.
  - Existing orphan cascade options stay.
  - **Fixed 2026-10-19 (N21):** multiselect is a text input (create form) / free text in rule values.
  - A field delete leaves ghost layout items.
  - `LayoutEditor` has a single `canEdit`.
- **Tickets:**
  - Transition and assign aren't stale-guarded.
  - **Fixed 2026-10-19 (N19):** portal and print show mentions unstyled.
  - **Fixed 2026-10-19 (N20):** the queue Created arrow still shows while results are relevance-ranked.
- **KB:** no audit trail; not helpdesk-scoped for agents (product decision).
- **RBAC:**
  - The permission cache is per worker (up to 5 min stale).
  - Users must re-fetch `/auth/me` to see `itsm.admin.audit`.
  - Cross-helpdesk agents need `itsm.portal.tickets` read for the portal view.
- **Audit:**
  - Report exports and console org create/delete aren't logged.
  - There's no retention purge and no throttle.
  - `password_reset_requested` stores `emails_sent` (admin-only, but it reveals whether an address matched).

**QA hook:** QA_CHECKLIST "Bug-fix batch (added 2026-10-18)": per-area checks plus deploy pre-checks; "After Any Backend Change" gained the priority-hook, audit-area, extension-schema, `begin_approval` and `select_for_update(of=)` rules.

---

## 2026-10-18 — Automation — No way to automate status moves (e.g. assigned + New → Assigned); gotchas found building rules v1

**Symptom:** the user asked whether project settings can automate "assigned to an agent while New → move to Assigned". Nothing could: a transition runs only when someone clicks it, and clicking **Assign** round-robins over an assignee that was already picked.

**Root cause:** there was no automation engine (roadmap gap #7). Workflow post-functions, routing and SLA escalation are each fixed-purpose.

**Fix (feature):** new app `backend/apps/itsm_automation` (rules, run log, post-commit dispatcher) plus the project-settings **Automation** tab (`components/settings/automation-editor.tsx`). Skill: `.claude/skills/itsm-automation`. Gaps closed while building it:
- **No "ticket updated" event.** `TicketUpdated` sits in the notification choices but is never emitted, and `set_values` emitted nothing. Fixed with new `hooks.automation_dispatch` emit points in `create_ticket`, `assign`, `update_ticket`, `engine.transition`, and `set_values(notify_automation=True)` (set-fields view only).
- **Stale API responses.** `ticket views` serialized the in-memory ticket, so a status changed by post-commit automation came back stale. `update`, `assign`, `set-fields` and `transition` now call `refresh_from_db()` first (`apps/itsm_tickets/views.py`).
- **Assign overwrote the picked agent.** The seeded Assign `auto_assign` overwrote an existing assignee. Fixed with `engine.transition(preserve_assignee=True)` (automation only; manual clicks are unchanged).
- **Automated replies would have counted as the first response.** A public automated comment would stamp `first_responded_at` and stop the first-response SLA. Fixed with `ticket_service.add_comment(counts_as_response=False)`.

**Found, NOT fixed:**
- **Fixed 2026-10-18 (batch):** (S2, now cached per `connection.schema_name`) `itsm_email/services/system_user.get_email_bot()` caches the bot `User` **process-wide**, not per tenant schema, so a long-lived worker can hand tenant A's user object to tenant B. Its id may not exist there, or may be a different person. The new automation bot caches per `connection.schema_name`.

**QA hook:** QA_CHECKLIST "Automation rules: per-project When → If → Then (2026-10-18)".

---

## 2026-10-18 — UI (all areas) — Tooltips hidden under the header / clipped; disabled buttons never explained; bugs found by the hover-help audit

**Symptom:** found during the app-wide hover-help pass, where the user asked whether proper tooltips exist.
- Tooltips in the sticky queue toolbar rendered *under* the z-40 header.
- Tooltips inside Sheets, Dialogs and `overflow-hidden` tables were clipped.
- Tooltips never opened on disabled buttons.
- About 90 icon buttons had only an `aria-label`, so sighted users got no hover text.

**Root cause:**
1. `components/ui/tooltip.tsx` didn't portal `TooltipContent`, unlike Popover and DropdownMenu.
2. `disabled:pointer-events-none` (ui/button, RTE `TBtn`, dropdown items) means a disabled trigger fires no hover or focus.
3. Wrapping a Radix control in a tooltip trigger overwrote the control's own `data-state`. The tooltip stamps `data-state`, and Radix components spread incoming props after their own. This was caught during the pass, before shipping: a checked Switch rendered unchecked and open popover triggers lost their open styling.

**Fix:**
- `tooltip.tsx` now wraps Content in `TooltipPrimitive.Portal`.
- New primitives:
  - `ui/hint.tsx`: auto-wraps a disabled child in a focusable span, and `KeepChildState` strips the tooltip's `data-state`.
  - `ui/icon-button.tsx`.
  - `ui/info-tip.tsx`: opens on tap and has a 24px hit area.
- Copy lives in `lib/itsm/help/*`.

**Also fixed along the way:**
- **Queue sorting:** the Created column could never sort ascending (`ticket-queue.tsx` `cycleSort`: "reset" was a no-op on the default `-created_at`).
- **Column picker:** Reset compared against the built-in layout instead of the project's admin default. Now `defaultColumns: resolveQueueColumns(null, project.queue_columns)`.
- **Dashboard deltas:** Created/Resolved % deltas compared N days with N+1 days (`dashboard/page.tsx`). Both halves are now N days.
  - **Fixed 2026-10-18 (batch):** (B18) the boundary used the browser's local date while the trend uses UTC; both use UTC now.
- **Global Reports:** showed a red "0%" SLA compliance when there was no data. It now shows "—".
- **Approval panel:** never reloaded, so an approval started by a transition didn't appear (`reloadKey={t.updated_at}`).
- **Dashboard tiles:** they were `role=button` divs containing the new ⓘ, which axe flagged as `nested-interactive`. They are now a stretched `TileOverlay` button behind `pointer-events-none` content.
- **Watchers / Attachments triggers:** a `<span>` carried `aria-haspopup` (axe `aria-allowed-attr`, critical). `CountIconButton` now forwards its ref and is the PopoverTrigger child.
- **Wrong copy corrected:**
  - KB slug said "used in the URL"; the portal links by id.
  - Canned-note shortcut implied a "/ack" slash command; it is only a picker search keyword.
  - Helpdesk-create dialog promised seeded Incident and Request projects; nothing is seeded.
  - Email "+N more" said "by keyword"; it counts allowed projects.
  - Email-notification step 3 said test before saving; Test needs a save first.

**Found, NOT fixed (backend or product decisions; the tooltips describe the real behaviour):**
> **Updated 2026-10-18:** most of these were fixed by the same-day bug-fix batch (entry above) and are prefixed below; the help copy was updated with each fix. Unprefixed bullets are still open.
- **SLA**
  - **Fixed 2026-10-18 (batch):** (B7) `Holiday.recurring_annually` is ignored (`itsm_sla/business_time.py:98`).
  - **Fixed 2026-10-18 (batch):** (B8: blank = no SLA) A blank target falls back to an arbitrary other priority's target (`metric.targets.first()`, unordered) or 480 min.
  - **Fixed 2026-10-18 (batch):** (B8, `hooks.sla_priority_changed`) Targets don't follow priority changes.
- **Email**
  - Reply-to-closed "Create a new ticket" isn't implemented; it behaves as comment-only (`itsm_email/services/inbound.py:270-293`).
  - **Fixed 2026-10-18 (batch):** (B11, picker + validation) Turning off create-requestor leaves tickets with no requester; `default_requestor` isn't in the UI.
  - The per-mailbox poll interval can't go below the global tick.
- **Reopen:** `ReopenRule.window_days` is never enforced.
- **Approvals**
  - **Fixed 2026-10-18 (batch):** (B3) "Parallel" mode is ignored.
  - **Fixed 2026-10-18 (batch):** (B3) Inactive approval workflows still start.
  - **Fixed 2026-10-18 (batch):** (B1: blocked with a 400, stage validation, manager fallback) A stage can be saved with no approver, which freezes the ticket until a superuser decides. The same happens for "Requestor's manager" with no manager.
  - **Fixed 2026-10-18 (batch):** (B3, conditional unique) Adding a stage after a soft delete can collide on `UniqueConstraint(workflow, level)`.
  - **Fixed 2026-10-18 (batch):** (B2) The "Require approval" gate passes after a rejection.
  - **Fixed 2026-10-18 (batch):** (G4, `itsm_notifications/0004`) No `ApprovalRequested` notification rule is seeded.
- **Workflows**
  - **Fixed 2026-10-18 (batch):** (B14) The "(create)" transition never runs (tickets start in `is_initial`).
  - **Fixed 2026-10-18 (batch):** (B14: only `is_global` runs from any status) `engine.transition()` accepts a `from_status=None` transition from any status.
- **Fixed 2026-10-18 (batch):** (S3, `restrict_audience`) **Notifications:** the `CommentAddedPrivate` rule sends in-app "Internal note added" alerts to **watchers**, including requestor-added colleagues. ⚠ Privacy review needed.
- **Dashboard**
  - **Fixed 2026-10-18 (batch):** (M1, business minutes) "Mins overdue" measures breach-detection lag (`breached_at` is stamped by the scanner), not how late the work finished.
  - **Fixed 2026-10-18 (batch):** (M2) SLA compliance counts timers, not tickets; stopped timers count as met.
- **Fixed 2026-10-18 (batch):** (S5, `SavedFilter.helpdesk`) **Saved views:** personal ones show in every project's queue, and views shared from All Tickets (`project=null`) reach every user in the tenant (`itsm_dashboards/views.py:32-45`).
- **Fixed 2026-10-18 (batch):** (C5) **Cascade fields:** a node soft-delete leaves child options live (no DB cascade on soft delete).
- **Fixed 2026-10-18 (batch):** (B5) **Required fields:** `validate_required` ignores `visibility_rule`, so a hidden Required field blocks portal submit. Agent create never calls `validate_required`.
- **RBAC**
  - **Fixed 2026-10-18 (batch):** (S7) The Layout tab is gated on `itsm.fields:update`, but the API checks `itsm.fields.layouts`.
  - **Fixed 2026-10-18 (batch):** (S7) Routing rules: the UI uses `:update`, the API uses `:create` / `:delete`.
  - **Fixed 2026-10-18 (batch):** (S7, enforced + `itsm_rbac/0014` grants) Four modules are never checked: `itsm.tickets.create`, `itsm.reports.sla`, `itsm.reports.agent`, `itsm.portal.approvals`.
- **No backend guards:**
  - **Fixed 2026-10-18 (batch):** (S6) Built-in roles can be deleted.
  - **Fixed 2026-10-18 (batch):** (S6) Superusers can be deactivated through the API.
  - **Fixed 2026-10-18 (batch):** (S6) The console can deactivate the only admin.
- **KB**
  - **Fixed 2026-10-18 (batch):** (B16) "Save draft" on a published article keeps it live.
  - **Fixed 2026-10-18 (batch):** (B16: one level enforced + flatten migration) Re-parenting a category that has children hides the grandchildren.
- **Fixed 2026-10-18 (batch):** (B4) **Catalog:** an item flagged "Needs approval" with no workflow starts no approval.
- **Fixed 2026-10-18 (batch):** (B6) **Surveys:** with `comment_required` on and `comment_enabled` off, the survey can never be submitted.
- **Fixed 2026-10-18 (batch):** (U13: option-less fields hidden on the portal) **Portal create form:** shows the admin-facing "No options configured yet." (`ticket-create-form.tsx`).
- **Fixed 2026-10-18 (batch):** (U4; the portal transitions endpoint still lacks it) **Transitions API:** returns only `to_status_key`, so the tooltip humanises the key. A `to_status_name` field would be better.

**QA hook:** QA_CHECKLIST "Hover help / tooltips (2026-10-18)": primitives, rules, grep gates, the 52-check hover run, and axe.

---

## 2026-10-15 — Shell/Tickets — Queue page scrolled by 1px; workspace header tied with the sticky toolbar's z-index

**Symptom:** found while measuring the agent chrome for the free-space pass. On a project queue the whole
page scrolled by 1px (the pane-scroll queue is meant to be exactly one viewport tall), and the workspace
header and the queue's sticky toolbar band shared a stacking level.
**Root cause:** (1) `WorkspaceHeader` put `h-14` on its INNER bar and `border-b` on the outer `<header>`, so
the header was 57px while `QueueView` subtracted exactly `3.5rem` (56px) → 1px overflow. (2) The header was
`z-30` — the same as the toolbar band and pager (`z-30`); the code comments and the QA doc both assumed
z-40 (only AgentShell's header was z-40).
**Fix:** `workspace-header.tsx` + `agent-shell.tsx` — the height moved to the OUTER `<header>`
(`h-header` = `var(--header-h)`, border-box so the border is inside) and the inner bar is `h-full`;
WorkspaceHeader is now `z-40`. The queue/report pane heights use the same token
(`h-[calc(100dvh-var(--header-h))]`), so header and pane can no longer drift apart.
**QA hook:** QA_CHECKLIST "Density toggle + free-space pass (2026-10-15)": queue `scrollHeight ===
innerHeight`, header exactly 56/48px, band top == header bottom; grep gate for hard-coded `top-14`/`3.5rem`.

---

## 2026-10-14 — Reporting/Fields/Email — Ticket Data report: Mode, Request Type, Resolution Note blank (GridCrest)

**Symptom:** GridCrest reported that Reports → Ticket Data showed no data for **Mode**, **Request Type**
and **Resolution Note**, although the columns exist.
**Root cause:** the report was NOT dropping data. `reports.ticket_data` exports exactly the stored
values, and the ticket detail view showed the same blanks. There were three separate gaps:
- **Mode** is a value-backed global dropdown (`mode`, no `maps_to`). Email intake set `source=email`
  but never set Mode, so only agent-picked tickets had one (11 of 68; 1 of 31 in October). Source is
  hidden on the layout by default, so the client couldn't see the channel anywhere else.
- **Request Type** and **Resolution Note** were *custom fields on the REQ project only*. All October
  mail lands in INC (last REQ ticket was 2026-07-29), and with "All projects" a custom column appears
  only when ≥1 ticket in range has a value.
- **Two resolution notes:** INC used the global column-backed `resolution_notes` on its Resolve
  screen. The global was tagged `applies_to: ["incident","problem"]`, so Request projects couldn't pick
  it. The admin created a REQ-only custom `resolution_note` for the **Fulfil** screen instead, and the
  report showed it as a separate column.
**Fix:**
- `itsm_email/services/inbound.py` — `_intake_custom_fields(project)` passes `{"mode": "email"}` to
  `create_ticket` when the project's Mode field has an active `email` option (all tenants, new mail only).
- `itsm_core/seed.py` + data migration **`itsm_core/0012_resolution_notes_for_requests`** —
  `resolution_notes.applies_to` now includes `service_request` (one canonical note column).
- GridCrest one-off `scripts/oneoff_20261014_gridcrest_mode_resolution.py` (piped into
  `manage.py shell`, `schema_context("gridcrest")`; dry-run by default, `APPLY=1` commits; idempotent,
  verified on a restore of the 2026-10-13 backup): back-fill Mode=email on every `source=email` ticket via `field_service.set_values` (audited);
  repoint the Default Request Workflow **Fulfil** screen field `resolution_note` → `resolution_notes`
  (stays mandatory); move REQ11's one value to `Ticket.resolution_notes` (+ `field_changed` audit);
  soft-delete the custom def + value. **Status: code DEPLOYED 2026-10-15 ~01:10 UTC** (combined deploy,
  backup `backups/ticketing_system_predeploy_20261015-010950.sql.gz`; 0012 applied in all 5 schemas).
  **The GridCrest data script is still NOT run** and waits on the user's approval.
- Tests: `InboundPipelineTests.test_new_email_ticket_records_mode_email` /
  `test_mode_left_blank_when_email_option_inactive`; `ITILFieldCatalogScopingTests.test_migration_0012_*`;
  the three request-scoping tests now expect Resolution Notes on Request projects.
**QA hook:** new section *Email intake Mode + one Resolution Notes field (added 2026-10-14)*. Diagnosis
rule: before calling a report column "broken", count the `FieldValue` rows for that field and project
in the date range. A blank cell almost always means nothing was stored.

---

## 2026-10-08 — Email — Re-pointed mailbox back-filled a year of old mail; no new tickets (GridCrest)

**Symptom:** after changing the GridCrest mailbox to `helpdesk@gridcrest.io` and re-authorizing,
no tickets were created from new mail and no acknowledgements went out. The scheduler logged
`Could not mark uid … seen` for thousands of UIDs, and the email log filled with `ignored` (`age` /
`loop`) rows for mail dated July–October **2025** (~2,300 rows in 90 minutes).
**Root cause:** the 2026-07 start-from-now fix only fired when `last_seen_uid is None` (first-ever
poll). Editing the address kept the cursor from the *previous* mailbox (UID 2479). IMAP UIDs are only
meaningful within one mailbox + UIDVALIDITY, so in `helpdesk@` that cursor pointed at July 2025 and the
poller crawled forward 50 messages/poll, writing an `InboundEmail` row per old message, hours away from
today's mail.
**Fix:**
- `EmailChannel.connected_at` (ingest floor) + `uid_validity` (migration `0009`, back-filled to the last
  poll − 15 min). `mark_connected()` resets floor + cursor; `EmailChannelSerializer.update` calls it when
  any `CONNECTION_FIELDS` change or the mailbox is re-activated.
- `mailbox._fetch_imap` searches `UID n:* SINCE <floor − 1d>` server-side, drops pre-floor mail by
  `INTERNALDATE` before downloading (yielded as `(uid, None)` — cursor advances, **no DB row**), and
  discards the cursor on a UIDVALIDITY mismatch. POP3 checks the `Date` header via `TOP` before `RETR`.
- `poller.poll_channel` replaces the one-shot `current_max_uid` baseline with the floor, and writes its
  cursor only if `connected_at` didn't change mid-poll (a re-point is never overwritten).
- Tests: `ConnectFloorTests`, `ReconnectResetsCursorTests`.
**QA hook:** Email-Channel section — *re-pointing a mailbox (address/username/server/folder) or
re-activating it must ingest only mail that arrives afterwards; no `InboundEmail` rows for older mail.*

---

## 2026-07-02 — Tickets/Fields — Impact Assessment blank on the detail view after create (ITINC-2)

**Symptom:** an agent set the **Impact Assessment** fields (Impact, Urgency, Users Affected, Service
Downtime, Major Incident, Business Impact) while creating an Incident, but the created ticket's detail rail
showed every one as **"—"**. (The Resolution-Details fields had the same latent bug.)
**Root cause:** frontend detail view only — the data was never lost. These are **column-backed**
(`config.maps_to`) fields: `create_ticket` persists them on `Ticket` columns and `TicketDetailSerializer`
returns them at the top level (confirmed by `ITILPriorityMatrixTests.test_create_stores_impact_assessment_columns`).
But `ticket-detail.tsx::fieldValue()` read the display value from **`ticket.custom_fields[def.key]`** for
every field it didn't hardcode, and a `maps_to` field is **never** in `custom_fields` (`field_service.set_values`
skips `maps_to` keys → no `FieldValue` row) → the read resolved to `undefined` → dash. `buildEditor()` also
did `if (cfg.maps_to) return null`, so the same fields were **not inline-editable** (the QA "inline PATCH of
impact/urgency recomputes priority" was silently unmet).
**Fix:** `frontend/components/tickets/ticket-detail.tsx` — ① `fieldValue()` reads a column-backed field's
value off the ticket column by `cfg.maps_to` (`ticket[maps_to]`), keeping `custom_fields` only for
value-backed fields; ② `buildEditor()` renders inline editors for the six Impact-Assessment columns (reusing
`CustomFieldEdit`) that save via the ticket PATCH (`onSaveColumn` → server recomputes Priority). New
module-level `IMPACT_ASSESSMENT_MAPS_TO` / `coerceColumnValue` / `columnPatch`; `UpdateTicketInput`
(`lib/itsm/types.ts`) gained the four extra columns. No backend change. `tsc --noEmit` clean.
**QA hook:** new ITIL bullet "**Impact Assessment values survive create → detail (ITINC-2 regression)**"
(fill on create → detail shows the values, not "—"). General rule: a `maps_to` field renders from
`ticket[maps_to]`, never `custom_fields` (itsm-fields / itsm-tickets BUG_LOG).

## 2026-06-25 — Tickets/Portal — Watchers invisible in console; portal removal DELETE would 403

**Symptom:** (ITINC-614) the agent ticket detail showed **no watchers** anywhere — no way to see or manage
them — and attachments were read-only (no upload/delete/preview). The portal detail rendered attachments as
a dash and had no watchers or reopen.
**Root cause:** ① the frontend never had a `watchersApi`, a `Watcher` type, or any watcher UI (the backend
endpoints existed). ② `WatcherSerializer.user` was `read_only`, so `POST /watchers/` could **never** set the
watcher — the "add arbitrary watcher" path was silently unusable. ③ Requestors hold **read+create** (not
delete) on `itsm.portal.tickets`; `HasModulePermission` maps `DELETE→delete`, so a portal watcher/attachment
**DELETE would 403**.
**Fix:** ① new `WatchersPopover`/`AttachmentsPopover` (Jira-style header icons + count badges) in
`components/tickets/ticket-detail.tsx`; `watchersApi` + `ticketsApi.watch/unwatch/watchers` +
`ticketAttachmentsApi.remove` in `lib/itsm/api.ts`. ② `WatcherSerializer` gained a write-only `user_id`
(`source="user"`); FE posts `{ticket, user_id}` (`apps/itsm_tickets/serializers.py`). ③ every portal removal
is a **POST** (`PortalTicketViewSet.watchers/remove`), never DELETE (`apps/itsm_tickets/portal.py`).
**QA hook:** the new "Tickets/Portal — Watchers, attachments (upload/delete/preview), portal reopen" section.

## 2026-06-25 — Email — Reply created a DUPLICATE comment + quoted "On … wrote:" not stripped + busy inbox back-filled

**Symptom:** an email reply to a ticket (ITINC-613) created the **same public comment twice** (95 ms
apart); the Gmail quoted-reply attribution line (`On Thu, 25 Jun 2026 … <a@x>\nwrote:`) was **not
stripped**; and connecting a busy mailbox tried to ingest its entire ~3,600-message history (newest mail
was last in line, hours away).
**Root cause:**
1. **Duplicate comment — TOCTOU race.** `inbound.process_inbound` did `get_or_create(channel,
   message_id)` then `if status in (PROCESSED,IGNORED): return`. Two concurrent pollers (a manual
   *Poll now* racing the 60 s scheduler) both saw `status=RECEIVED` and both ran `_run_pipeline` →
   `add_comment` twice. Idempotency held at the *row* level (one `InboundEmail`) but not the *comment*.
2. **Quote not stripped.** `detectors._QUOTE_MARKERS` matched `^On .+ wrote:$` only on a SINGLE line,
   but Gmail (mobile) wraps `wrote:` onto the next line, so the attribution survived.
3. **Back-fill.** `mailbox._fetch_imap` starts at `UID 1` when `last_seen_uid is None`, fetching 50/poll
   ascending → the whole historical inbox (mostly age-ignored) churns before new mail is reached.
**Fix:**
- `inbound.process_inbound` wraps the pipeline in `transaction.atomic()` + `InboundEmail.objects.
  select_for_update().get(pk)` and re-checks status **under the lock** — the second worker blocks, sees
  the terminal status, and no-ops. Failure path `refresh_from_db()` + bails if a peer already finished.
- `detectors._is_attribution_start` detects the wrapped `On … / wrote:` attribution across up to 3 lines
  (+ `Am … schrieb:`, `Le … a écrit :`), while keeping a real reply that merely *starts* with "On …".
- `poller.poll_channel` sets a **start-from-now** high-water mark via `mailbox.current_max_uid()` on the
  first IMAP poll (`last_seen_uid is None`) and processes nothing — no back-fill; POP3 exempt.
- Existing ITINC-613 duplicate soft-deleted. **50 tests pass.** Deployed (backend + scheduler).
**QA hook:** Email-Channel section — *any inbound choke-point that can run concurrently must lock the
idempotency row and re-check under the lock before side-effects; connecting a mailbox must NOT back-fill
its history.*

---

## 2026-06-25 — Email — OAuth (Google/MS365) unusable on the multi-tenant domain; reworked to per-org apps + tenant-aware callback

**Symptom:** "Connect mailbox" for Google/Microsoft could never complete on `pilot-ticket.onemedai.org`.
Also, the design used a single shared provider app for all orgs — wrong for "each org brings its own app."
**Root cause:**
1. **Callback not tenant-aware.** The redirect URI was a single static `…/api/v1/itsm/email/oauth/callback/`
   (no `/t/<org>/`), so `PathTenantMiddleware` left the request in the **public** schema; `state` carried
   only `{cid}`. `EmailChannel` is a TENANT model → the lookup ran in public and found nothing → token
   exchange failed. The success redirect also targeted `/agent/w/<hd>/…` (no `/t/<org>/`) → 404.
2. **Single shared app.** `client_id/secret/tenant` came from global settings, so every org would have
   shared one app — incompatible with per-org consent.
**Fix:**
- **Per-org app creds on the channel:** new `oauth_client_id`, `oauth_client_secret_enc` (encrypted),
  `oauth_tenant_id` (migration `0002`). `oauth._client(cfg, channel)` / `_tenant(channel)` prefer the
  channel's values; blank ⇒ global settings fallback. Serializer exposes id/tenant (rw) and the secret
  write-only (`has_oauth_client_secret`).
- **Tenant-aware callback:** `_redirect_uri()` builds `{PUBLIC_BASE_URL}/api/v1/t/<org>/itsm/email/oauth/
  callback/` from `connection.schema_name`, so the middleware sets the schema from the path; `state` now
  carries `{cid, org}` and `OAuthCallbackView` sets the schema defensively + redirects to
  `/t/<org>/agent/w/<hd>/settings/email?email_oauth=success|error`.
- **Config:** `PUBLIC_BASE_URL` + `FRONTEND_BASE_URL` set to `https://pilot-ticket.onemedai.org`.
- **Frontend:** Connection tab now has Client ID / Client secret / (MS) Directory tenant inputs, shows the
  exact per-org redirect URI to register, and toasts the `?email_oauth=` result. **44 tests pass.**
- **Verified live:** `GET /api/v1/t/onemed/itsm/email/oauth/callback/` → 302; unknown org → 404.
**QA hook:** Email-Channel section — *OAuth on a path-routed multi-tenant domain needs an org-prefixed
redirect URI so the middleware sets the schema; never assume a static callback can resolve tenant data.*

---

## 2026-06-25 — Email — Inbound channel "built" but never polled (scheduler never booted) + forgeable subject-token threading

**Symptom:** the email-to-ticket channel looked complete (models, OAuth, poll jobs, 35 tests, UI) but
no incoming mail ever became a ticket — it felt "not concrete." Separately, anyone could inject a public
comment / reopen on any ticket by putting `[KEY-N]` in a subject line to a connected mailbox.
**Root cause:**
1. **Poller never ran.** The APScheduler jobs (`email.poll_inbound` / `email.retry_failed_inbound`,
   plus the SLA sweep and notification outbox) boot from each app's `AppConfig.ready()` *only when*
   `settings.RUN_SCHEDULER` is truthy (`core/settings.py:221`, default `"0"`). `RUN_SCHEDULER` was set
   NOWHERE — not in `backend/.env.docker`, `docker-compose.yml`, or `entrypoint.sh` (just
   `exec gunicorn --workers 3`). Proof: live `public.django_apscheduler_djangojob` had **0 rows**
   (jobs register on every boot, so empty = never started). The per-tenant fan-out
   (`for_each_tenant`) was correct but never executed.
2. **Forgeable token threading.** `threading.resolve_thread` honoured a `[KEY-N]` subject / `+KEY-N@`
   plus-address token with NO check that the sender owns the ticket — a stranger's guessable token
   threaded as a **public** comment and could trigger a reopen.
**Fix:**
- **Dedicated scheduler process** so exactly one BackgroundScheduler runs (3 gunicorn workers would
  mean 3): new `ticketpilot-scheduler` service in `docker-compose.yml` runs `manage.py run_scheduler`
  (new command `apps/itsm_core/management/commands/run_scheduler.py`) with `RUN_SCHEDULER=1`; web
  workers keep it OFF. Service waits on a new backend healthcheck (gunicorn binds `:8000` only after
  `migrate_schemas`, so "healthy" == "migrated" — no migration race).
- **Sender-ownership gate** (`apps/itsm_email/services/threading.py`): `_sender_owns_ticket(ticket,
  parsed)` requires the envelope sender to be the requestor or a watcher (by email) before a token
  match (paths B/C) threads; else → new ticket. Header-map (path A) untouched (requires a minted +
  recorded Message-ID). Tests: `test_subject_token_from_stranger_is_new`,
  `test_plus_address_token_from_stranger_is_new`, `test_subject_token_from_watcher_threads`.
- **`ITSM_CREDENTIAL_KEY`** set in `backend/.env.docker` (must precede any stored secret; back it up).
- **`poll_email_once`** now fans out per-org (`--schema=<org>` to target one) and is in
  `SCHEDULER_BLOCKED_COMMANDS`. **38 tests pass.**
- **Still open (Phase B):** OAuth (Google/MS365) unusable on the path-routed domain — callback isn't
  tenant-aware (no `/t/<slug>/`, `state` lacks org slug → token exchange runs in public schema) and
  provider creds unset. Basic IMAP/SMTP works today.
**QA hook:** new checklist item — *any scheduled/background job must actually be booted by a process
that sets `RUN_SCHEDULER=1` (the dedicated scheduler container), and any inbound channel must verify
sender authorization before mutating an existing record.* (See the Email-Channel section below.)

---

## 2026-06-24 — Tickets — Comment-note attachment upload 500'd (ticket number sent where UUID expected)

**Symptom:** on a ticket detail (ITINC-606) attaching a file under a comment/note failed — `POST
/api/v1/t/onemed/itsm/comment-attachments/` returned **500** (toast showed the raw Django 500 HTML).
The Files list also 400'd (`GET ticket-attachments/?ticket=ITINC-606`).
**Root cause:** an identifier mismatch. The whole detail UI uses the **readable `ticket_number`** as the
route token (`ticketId='ITINC-606'`), and `TicketViewSet` resolves it via `TicketNumberLookupMixin`
(number-or-UUID). But the attachment endpoints key off the raw **UUID FK pk**. `ticket-detail.tsx` passed
that number straight through to `commentAttachmentsApi.upload`/`ticketAttachmentsApi.list`. Server-side,
`CommentAttachmentViewSet.create` did `get_object_or_404(Ticket, pk='ITINC-606')` → the UUID column's
`to_python` raised `ValidationError('"ITINC-606" is not a valid UUID')`, which `get_object_or_404` does
*not* catch (only `DoesNotExist`) → unhandled → **500**. (`ticket-create-form.tsx` was unaffected — it
already passed the freshly-created `ticket.id` UUID.) Same class as 2026-06-?? "Bug B" (wrong id type on a
ticket field).
**Fix:**
- Frontend `components/tickets/ticket-detail.tsx` — pass the UUID at all three attachment call sites:
  `ticketAttachmentsApi.list(t.id)` (in `load`), and `commentAttachmentsApi.upload(ticket.id, …)` in
  `handleCommentImage` + `attachFiles` (with `if (!ticket) return` guards; dep `[ticketId]`→`[ticket]`).
- Backend `apps/itsm_tickets/views.py` `CommentAttachmentViewSet.create` — validate the `ticket` token as a
  UUID first; a non-UUID now returns a clean **400** `{ticket:["A valid ticket id is required."]}` instead
  of a 500 (defense-in-depth so no client can ever 500 this endpoint with a bad id).
- Verified in the `onemed` schema via `APIClient`: number→400, UUID→201, garbage→400. `tsc --noEmit` clean.
**QA hook:** "API response shape matches what the frontend expects" + a new rule — *ticket-scoped child
endpoints (`*-attachments`, `?ticket=`) take the UUID pk, not the readable number; only
`TicketNumberLookupMixin` detail routes accept either.* Never let `get_object_or_404(pk=…)` take an
unvalidated client token on a UUID pk (validate or catch → 400, never 500).

## 2026-06-23 — Tickets — Activity feed showed who/when but not *what* changed (ITINC-606)

**Symptom:** on a ticket detail (ITINC-606) the **Activity** tab listed rows like "Shekhar updated a field
· 23 Jun 2026, 23:55" / "Shekhar changed status · …" — the **actor and timestamp** were present but the
**field name and before/after value were missing**, so the feed wasn't a usable audit log.

**Root cause:** two gaps. (1) The renderer (`ticket-detail.tsx` Activity tab) only printed
`actor + ACTION_VERB[action] + when` and **never read `AuditEvent.payload`** — the "what" was on the wire
but dropped on the floor. (2) Some write sites stored payloads that weren't self-describing: `summary_changed`
logged `{}` (empty), and `assigned`/`requestor_changed`/`group_changed` logged only **raw user PKs / group
UUIDs**, which a feed can't resolve to names after the fact. (Status changes and custom `field_changed` rows
already carried readable payloads — `from`/`to` names and `{old,new,name}` — they just weren't rendered.)

**Fix:**
- Frontend `frontend/components/tickets/ticket-detail.tsx`: new module-level `activityVerb` (names the custom
  field for `field_changed`) + `activityDetail` (returns the per-action "old → new" from the payload) +
  `activityValue` (formats bools/arrays/empties) + `PRIORITY_LABEL`; the `<li>` now renders **actor · verb ·
  detail · when**. Extra friendly verbs added to `ACTION_VERB` (SLA/attachment/watcher/link/template).
- Backend `backend/apps/itsm_tickets/services/ticket_service.py`: `_user_label`/`_group_label` helpers; the
  `assigned`/`requestor_changed`/`group_changed` payloads (in `update_ticket` **and** the `assign` action)
  now include `old_label`/`new_label` (display names captured **at change time** — survives later renames),
  and `summary_changed` records `{old, new}` (was `{}`). No model/serializer/migration change.

**QA hook:** *Tickets — Activity feed shows what changed (old → new)* (QA_CHECKLIST, 2026-06-23). Tests:
`TicketInlineEditApiTests` +3 (assignee/group label, summary old/new); `apps.itsm_tickets` suite now **56**.

---

## 2026-06-23 — SLA — "Time to First Response" stayed red "overdue" after the agent replied

**Symptom:** on a ticket detail (ITINC-605) the agent had posted a public reply, yet the SLA panel still
showed **Time to First Response — 12h 0m overdue** in red, as if no response had been registered. Looked
like the reply wasn't stopping the first-response clock.

**Root cause:** display only — the engine was correct. `ticket_service.add_comment` stamps
`first_responded_at` on the first public reply and calls `hooks.sla_stop(ticket, "first_response")`;
`sla_engine.stop()` ended the clock and **froze `stopped_at`**. Because the reply landed ~12 business-hours
past the 4h target, the clock ended **`breached`** (correct ITSM — a missed SLA stays missed; replying late
does not un-breach it). The frozen value was real, but the **frontend rendered a stopped/breached clock
identically to a still-running overdue one**: the detail panel (`sla-panel.tsx`) ignored the tracker
`state` and always printed `remaining()` ("Xh overdue"), and the queue bar (`queue-columns.tsx` `SlaBar`)
treated only `met`/`stopped` — **not `breached`** — as "done", so a breached-stopped clock also fell through
to a live, ever-growing "Xh over".

**Fix (frontend only):**
- `frontend/components/tickets/sla-panel.tsx` — new `statusLabel(e)`: a stopped clock
  (`met`/`breached`/`stopped`) shows its **outcome** ("Met" / "Breached"); only a `running` clock shows the
  live "Xh left" / "Xh overdue" (and `paused` → "Paused").
- `frontend/components/tickets/queue-columns.tsx` — `SlaBar` `done` now includes `breached`, so a
  breached-stopped clock shows "Breached" instead of a live "Xh over".
- No backend change — `countdown_payload` / the list serializer already return `state`.

**QA hook:** "Tickets — Configurable queue columns + SLA bars" already specified the bar shows
"Paused/Met/Breached" — the code never honoured `breached` for the *stopped* case. Added an explicit
"SLA — stopped clocks show outcome, not a live countdown" QA section (below) covering both renderers and the
late-response-breached case.

## 2026-06-23 — Groups — Edit group panel had no way to add agents or multiple leads

**Symptom:** on `…/settings/groups`, opening **Edit group** showed only Name/Key/Type/**Lead**(single)/Description.
The user reported "don't see option to add agents" and wanted to "add multiple leads." Member management
*existed* but lived behind a separate per-row **Members** button (obscured by the open Edit panel), and the
Lead control was a single FK.

**Root cause:** not a bug — a discoverability + capability gap. Adding agents was only reachable via the
standalone `group-members-sheet.tsx`, and the form's single `lead` FK didn't expose the `role_in_group="lead"`
membership that already supports multiple leads. Backend already supported everything (`add_member` upserts a
role, `members` action, writable `lead`) — no API change needed.

**Fix (frontend only):**
- `frontend/components/settings/group-form-sheet.tsx` — folded a **Team** section into the Edit sheet (edit-mode
  only, since memberships need a saved group): a **Leads** multi-select (chips, `role_in_group="lead"`) and an
  **Agents** list (`role_in_group="member"`), both via `UserSearchCombobox` → `add_member`/`remove_member`.
  Team writes are **immediate** (matches the old members sheet); core Save no longer sends `lead`. The single
  `Group.lead` FK is kept in sync as the **primary** = `leads[0]` (badge + "Set primary"; demote/remove the
  primary promotes the next lead, or clears to null) so the group-lead auto-assign strategy is unchanged.
  Create mode is core-only with a hint to reopen and add team.
- `frontend/components/settings/groups-list.tsx` — owned groups a supervisor can manage now show **Edit/Delete**
  only (team lives in Edit); the standalone **Members** button is kept for **Shared/global** teams and read-only
  viewers (`!canManage`), which have no Edit.

**QA hook:** rewrote the *Assigned Groups* checklist (`docs/QA_CHECKLIST.md`) — team-in-Edit, immediate writes,
multiple-leads + primary sync, and Members-button-only-for-shared.

---

## 2026-06-23 — Tickets/Fields — Create form showed a "Type" selector the config no longer represents

**Symptom:** the agent create-ticket page (`…/p/ITINC/new`) rendered a prominent **Type** dropdown
(Incident/Hardware/…) at the top of the form, but **Type is not a field on the Layout designer** and
**ticket-categories are not manageable in project config** (the categories editor was removed
2026-06-22). So the create page surfaced a control the layout config had no representation of — a
config↔create **mismatch**. (Verified against live tenants: a freshly-seeded project's main layout
section is even named `"Ticket details"`, which the create form *separately* suppressed while the
designer showed it — same class of editor↔form divergence.)

**Root cause:** `ticket-create-form.tsx` rendered a standalone `<select id="ticket-type">` from
`project.ticket_types` above the layout panes. It pre-dated the 2026-06-22 decision to drop category
management from config; nothing removed it from the create flow, so the form no longer matched the
(simplified) config surface.

**Fix:** `frontend/components/tickets/ticket-create-form.tsx` — removed the Type `<div>`/`<select>`
block and the `setTicketType` setter. `ticketType` is now a value-only `useState(defaultType?.id ?? "")`
(default = the `is_default` type, else the first) that still feeds `layoutsApi.resolve(...)` and the
create payload's `ticket_type`, so the ticket is correctly typed silently. The submit guard message was
corrected (no picker to "pick" from anymore). The form now renders **exactly** the resolved
`FieldLayout` and nothing else. `TicketType` stays load-bearing for the queue Type filter + detail Type
row (unchanged). `tsc --noEmit` + clean `next build` pass.

**QA hook:** new *Tickets — Create form matches the layout config (Type removed)* section in
`docs/QA_CHECKLIST.md`.

---

## 2026-06-23 — Tickets/Fields — Rich-text (RTE) field had no formatting controls in the UI

**Symptom:** on a `richtext` field (the ticket Description, and any custom rich-text field) the create
form and the detail editor rendered a **plain `<textarea>`** — no bold/italic/list/heading toolbar, no
way to format the body. The user reported "even if you use RTE field the formatting option is missing
in UI." (The standard field catalog seeds Description as `richtext`.)

**Root cause:** the layout-driven form treated `richtext` identically to `multiline` (`case "multiline":
case "richtext": → textarea`) — the TipTap editor was always a documented fast-follow that never landed.
TipTap (`@tiptap/react` + StarterKit + underline/link/placeholder) was already a dependency but **unused**
anywhere. Compounding it, the repo ships **no `@tailwindcss/typography` plugin**, so the `prose` classes
on every rich-text read view were dead — even server-rendered HTML showed lists/headings flat.

**Fix:**
- New shared `frontend/components/ui/rich-text-editor.tsx` — a TipTap editor with a formatting toolbar
  (bold / italic / underline / strike / H2·H3 / bullet+numbered lists / quote / inline code / link /
  clear / undo·redo). Emits HTML; empty doc normalises to `""`; SSR-safe (`immediatelyRender:false`); all
  sub-components module-top-level; external-value re-sync skips our own emitted HTML so the cursor never
  jumps mid-type.
- Wired into `ticket-create-form.tsx` (`richtext` case — split out from `multiline`, which stays a
  textarea), `ticket-detail.tsx` `DescriptionEditor` (seeded from stored HTML, not the plain-text mirror),
  and `CustomFieldEdit` (`richtext` case, commit-on-blur).
- `app/globals.css` — hand-written rich-text typography for both the live editor
  (`.ProseMirror`/`.rte-content`) and rendered output (`.prose …`) + the Tiptap placeholder rule; fixes
  all existing read views too (comments / KB / descriptions had been rendering unstyled).
- Backend — `field_service._coerce` now runs `richtext` custom values through `sanitize_html` (bleach) on
  write, so the read view can render them with `dangerouslySetInnerHTML` safely (the Description column
  was already sanitised by `ticket_service`).

**Verification:** `tsc --noEmit` clean; clean `next build` compiles (TipTap bundle in `/new` + detail);
`makemigrations --check` clean (no model change); `apps.itsm_core` + `apps.itsm_tickets` = 48 tests green
+ new `QueryBuilderTests.test_richtext_custom_field_value_is_sanitised` (49).
**QA hook:** new *Tickets/Fields — Rich-text editor with formatting toolbar* section in
`docs/QA_CHECKLIST.md`; skill `itsm-fields` updated (create form / detail / RichTextEditor / `_coerce`).

## 2026-06-22 — Projects/Tickets/Dashboards — Project Filters tab + queue default views (feature)

**Context:** the queue view dropdown (All tickets / Open / Unassigned / …) was hardcoded with no admin
surface, no project-level default, and no per-user default — a fresh visit always landed on **All
tickets**. Requested: a project Settings → **Filters** tab to curate views + create custom filters + set
a project default, a per-user default chosen from the queue, and a product default of **Open tickets**.

**What shipped (reused existing infra — `SavedFilter` already persisted custom filters; mirrored
`QueueColumnPreference` for the per-user default):**
- **Backend.** Two new `Project` columns (`itsm_projects` migration `0004`): **`default_view_key`**
  (CharField — system view key like `"open"`/`"all"` or `"saved:<uuid>"`; blank ⇒ product default) and
  **`disabled_view_keys`** (JSONField — system keys hidden from the dropdown). `ProjectWriteSerializer`
  gained both fields + `validate_disabled_view_keys` (strips `"all"`/unknown/dups) and
  `validate_default_view_key` (blanks an unknown key or a missing `saved:<uuid>` so no dangling refs).
  New per-user **`itsm_dashboards.QueueViewPreference`** (owner+project, unique alive; migration `0004`)
  with an owner-scoped **upserting** `/api/v1/itsm/queue-view/` (copy of `QueueColumnPreference`).
  `PRODUCT_DEFAULT_VIEW_KEY = "open"` added to `itsm_tickets/services/filter_fields.py`.
- **Frontend.** New **Filters** settings tab (`components/settings/filters-editor.tsx`): enable/disable
  system views ("All tickets" locked on), full custom-filter builder reusing the queue chips
  (`FilterChip`/`FieldPicker`/`useFilterOptions`/`buildSpec`) → project-shared `SavedFilter`s with
  rename/delete/reorder, and a project-default selector — all via `projectsApi.update` / `savedFiltersApi`.
  The queue view dropdown (`saved-views.tsx`) gained a **"Set as my default" star** per row (`queueViewApi`).
  `ticket-queue.tsx` resolves a fresh visit (no `?view`/`?q`) as **personal default → project default →
  product default (`open`) → All tickets** behind a `ready` gate (no "All tickets" flash); the dropdown is
  filtered to `enabledSystemViews` (project `disabled_view_keys`, "all" always shown).

**Migrations:** `itsm_projects/0004_project_default_view_key_project_disabled_view_keys`,
`itsm_dashboards/0004_queueviewpreference`.

**Post-review hardening** (adversarial multi-agent review of the diff, all findings low/medium, graceful
fallbacks — fixed anyway):
- **`validate_default_view_key` was too permissive** — accepted *any* existing `SavedFilter`, so a
  personal or cross-project filter could be stored as a project default that no other agent's queue could
  resolve. Now constrained to a **shared** filter on this project (or a global/null-project shared one),
  mirroring `SavedFilterViewSet` (`apps/itsm_projects/serializers.py`; +test
  `test_default_view_key_requires_shared_filter_on_this_project`).
- **Deleting the project-default custom filter** (`filters-editor.tsx`) only cleared local state →
  dangling `default_view_key`. Now PATCHes `default_view_key=""` immediately on delete.
- **Deleting a saved filter that was a personal default / the active view** (`ticket-queue.tsx`) left a
  dangling `QueueViewPreference` + a stale "Saved filter" label. A reconcile effect now drops a
  `saved:<id>` that no longer exists (active view → ad-hoc "Custom filter"; personal default → cleared
  server-side). Admin-*disabled* system views are deliberately preserved (re-enableable).

**Verification:** `tsc --noEmit` clean; `next build` compiles (14/14 routes); `manage.py check` +
`makemigrations --check` clean; 58 existing tests (dashboards/projects/tickets/helpdesks) green + 6 new
(`QueueViewPreferenceTests`, `ProjectFilterDefaultsTests`).
**QA hook:** new *Settings — Filters tab + queue default views* section in `docs/QA_CHECKLIST.md`.

## 2026-06-22 — Email — Email channel for ticket creation (mailbox → tickets, JSM-style) (feature)

**Context:** add an inbound email channel (configure a mailbox per project → email becomes tickets /
replies become comments) plus an outbound loop (the mailbox sends the acknowledgement + agent replies,
threaded). The platform was already scaffolded for `itsm_email` (settings, RBAC modules, `seed_itsm`
step, the `email_thread_headers` outbox hook, default `TicketCreated`/`CommentAdded` requestor rules),
and a complete implementation sat in `archive/old-backend/apps/itsm_email/` but had never been wired in.

**What shipped:**
- **Restored** `archive/old-backend/apps/itsm_email/` → `backend/apps/itsm_email/` (4 models, Fernet
  `crypto`, stdlib IMAP/POP `mailbox`+`parser`, `detectors`, `threading`, `identity`, `poller`, OAuth2,
  scheduler, seed, serializers/views/urls) and wired it into `INSTALLED_APPS` + `core/urls.py` (the only
  2 new lines — settings/RBAC/seed were already present). Regenerated `migrations/0001_initial`.
- **Outbound via the mailbox SMTP:** new `services/transport.py` (`get_outbound_config`) +
  `services/smtp_backend.py` (`XOAuth2EmailBackend` — Django's SMTP backend has no XOAUTH2) + a new
  `email_outbound_transport` hook in `itsm_core/services/hooks.py`; `itsm_notifications/services/
  outbox.py` swaps the connection + From per ticket. Acknowledgement + agent replies reuse the seeded
  notification rules — only transport/From/threading are added. No channel → global backend (unchanged).
- **Priority mapping:** new `services/priority.py` + `EmailChannel.priority_map` (editable) +
  `parser` retains `X-Priority`/`Importance`/`X-MSMail-Priority`/`Priority`.
- **Large-email handling:** `EmailChannel.max_attachment_bytes` — oversize parts skipped + a private
  agent note; whole-message `max_size_bytes` → ignored `size_cap`.
- **OAuth SMTP:** Microsoft scope gains `SMTP.Send`; `oauth.smtp_endpoint` added; Gmail's full-mail
  scope already covers SMTP.
- **Config UI** under the per-helpdesk Settings hub: `settings/email` (tabbed mailbox editor:
  Connection / Outbound / Field Mapping incl. the priority map / Processing / Domains allow-block) +
  `settings/email/logs` (inbound log + retry); `field_mappings` block exposes every mapping; secrets
  write-only. `create_users` now defaults **True** (auto-create the requestor in real time).

**Verification:** `apps.itsm_email` 35 tests; `apps.itsm_tickets` (48) + `apps.itsm_notifications`
green; `makemigrations --check` clean; `seed_itsm` re-runnable; frontend `tsc` clean + `next build`
compiles both routes.
**QA hook:** docs/QA_CHECKLIST.md → "Email Channel — mailbox → tickets, outbound via mailbox SMTP".

## 2026-06-21 — Tickets/Projects/SLA/Groups — "Next level" queue + ticket UX (feature)

**Context:** six enhancements to bring the queue + ticket UX closer to JIRA/Zoho.
The SLA backend already modelled per-priority Response/Resolution targets (policy →
metric → per-priority `SLATarget` + runtime `SLATracker`), so (f) was a *missing config
UI*, not new modelling.

**What shipped:**
- **(a) Configurable queue columns + SLA bars.** Shared registry
  `components/tickets/queue-columns.tsx` (keys ↔ labels ↔ widths ↔ sort keys). New default
  layout = the old columns **plus** Requestor, Group and two SLA RAG bars (Response,
  Resolution). The list serializer (`TicketListSerializer`) gained `requestor`, `created_by`,
  `updated_by` and a cheap `sla` payload (`{first_response, resolution}` — wall-clock RAG so
  the list never pays a business-time calendar read per row); the viewset prefetches
  `sla_trackers__metric`. Per-project default lives in `Project.queue_columns` (JSON), edited
  on the new **Columns** settings tab (`column-layout-editor.tsx`).
- **(b) Per-agent column layout.** New `itsm_dashboards.QueueColumnPreference`
  (owner+project, unique alive) with an owner-scoped upserting endpoint
  `/api/v1/itsm/queue-columns/`. The queue's "Columns" popover
  (`column-picker.tsx`) toggles/reorders columns and persists them; empty ⇒ fall back to
  project/built-in default. Resolution order: user pref → project default → built-in.
- **(c) Comments/Activity tabs.** The ticket detail's stacked Comments + Activity sections
  are now JIRA-style **tabs** at the bottom of the main column (counts in the labels),
  reusing `components/ui/tabs.tsx`.
- **(d) Strict, group-scoped assignee.** A ticket's assignee must be an **active member of
  its assigned group**. Enforced on the agent write paths — `ticket_service.update_ticket`
  (inline edit) and the view-layer create / `assign` action / bulk-assign (400 / skip) via
  `ticket_service.ensure_assignee_in_group`. The lower-level `create_ticket` / `assign`
  services stay permissive (routing, escalation, portal/catalog, fixtures). The assignee
  picker (detail + create) now draws from `GET /groups/{id}/members/` (leads first) via the
  shared `group-member-picker.tsx`; no group set ⇒ assignment blocked. The group members
  sheet can add a member as **member or lead** and promote/demote (`add_member` upserts the
  role).
- **(e) Audit fields.** New `Ticket.updated_by` FK, stamped by `update_ticket` / `assign`;
  list + detail serializers expose `created_by`/`updated_by`/`created_at`/`updated_at`. The
  detail meta rail shows Created / Created by / Last updated / Updated by.
- **(f) SLA config UI.** New project settings **SLA** tab (`sla-editor.tsx`): create the
  project policy + First Response & Resolution metrics with per-priority minute targets
  (e.g. Critical 30m response, Low 4h) and a calendar; CRUD via the existing
  `/sla-policies/ /sla-metrics/ /sla-targets/` endpoints. The engine auto-starts the clocks
  on ticket create (`hooks.sla_start_for_ticket` → `resolve_policy`).

**Migrations:** `itsm_tickets/0002_ticket_updated_by`, `itsm_projects/0003_project_queue_columns`,
`itsm_dashboards/0003_queuecolumnpreference`.

**QA hook:** new *Tickets — Configurable queue columns + SLA bars*, *Tickets — Comments/
Activity tabs + audit fields*, *Tickets — Strict group-scoped assignee*, and *Settings — SLA
configuration* sections in `QA_CHECKLIST.md`; `TicketInlineEditApiTests` gains
`test_patch_assignee_not_in_group_is_400` + `test_patch_records_updated_by`.

## 2026-06-21 — Tickets — Detail view was 100% read-only; made fields editable in place

**Symptom:** opening any ticket in the agent app (`/agent/w/<hd>/p/<proj>/<id>`) showed
every field — priority, assignee, group, requestor, summary, description, custom fields —
as static text. An agent could only change status (via the workflow transition buttons);
nothing else could be edited without going back to a create flow.

**Root cause:** the detail view (`components/tickets/ticket-detail.tsx`) only ever
*rendered* values (`FieldView` / `fieldValue`), and the backend exposed no inline-edit write
path — `TicketDetailSerializer` is all read-only (nested `UserBriefField`s) and there was no
`update`/PATCH handler, only the `assign` / `transition` / `set-fields` actions.

**Fix:**
- Backend — new single write site `ticket_service.update_ticket(*, ticket, user, **changes)`
  (`apps/itsm_tickets/services/ticket_service.py`): touches only the keys supplied
  (`priority`, `summary`, `description_html`, `impact`, `urgency`, `requestor_id`,
  `assignee_id`, `group_id`), logs each change to the audit feed (`priority_changed`,
  `requestor_changed`, `summary_changed`, `description_changed`, `group_changed`, `assigned`),
  re-emits `Assigned` on an assignee change, stamps `assigned_at`, and sanitises the
  description exactly like `create_ticket` (XSS-safe + mirrored `description_text`).
- Backend — `TicketViewSet.update` (`views.py`) routes PATCH/PUT through that service:
  validates `priority` against the allowed set (400 otherwise), rejects an empty `summary`,
  and resolves `requestor`/`assignee` (integer User PK or null-to-clear) + `assigned_group`
  (UUID or null) via `_resolve_user_change` / `_resolve_group_change` (unknown id → 400).
  Helpdesk scope (404) + RBAC `itsm.tickets:update` are enforced upstream by
  `get_object()` / `HasModulePermission`.
- Frontend — `ticketsApi.update` (PATCH standard fields) + `ticketsApi.setFields` (custom
  fields). `FieldView` now renders inline editable controls when the user has
  `itsm.tickets:update`: priority select, async user pickers (assignee/requestor), group
  select, a description editor (toggle), an inline summary editor in the header, and
  type-appropriate controls for custom value-backed fields (dropdown/radio/checkbox/date/
  number/multiline/multiselect/cascade/group_picker). Each control auto-saves and refreshes
  the activity feed. Status stays workflow-driven (transition buttons); `ticket_type` /
  `workflow` / `source` / attachments stay read-only.

**Who can edit:** Agents + Supervisors (both hold `itsm.tickets:update`); a plain Requestor
has no `itsm.tickets` grant, so the agent endpoint returns 403 and the portal stays
conversation-only by design. Editing degrades to read-only when `hasPerm` is false.

**QA hook:** new *Tickets — Inline field editing on the detail view* section in
`QA_CHECKLIST.md` + `apps.itsm_tickets.tests.TicketInlineEditApiTests` (11 tests).

## 2026-06-21 — Fields/Layout — Standard field catalog, layout-driven create form, two-pane regions

Feature work (the "minimum field configuration" milestone) across three iterations. Standard fields
are now seeded as **system `FieldDefinition`s** (global, `config.maps_to` → Ticket column) + a
per-project **Category** cascade field, placed on an auto-created default `FieldLayout`
(`itsm_core/seed.py`; backfilled for existing + new projects). Added field types `richtext` /
`cascade` / `attachment`, `FieldOption.parent`/`level` (cascade tree), per-field Basic/Advanced
settings (`config.tooltip`/`hint`/`regex` + conditional `visibility_rule`), a **layout-driven
two-pane create form**, and layout **regions** (Main/Sidebar) + field **width** (Full/Half). Two
real bugs flushed out:

### Bug A — `FieldDefinitionViewSet` `?project=` hid global system fields

**Symptom:** the Fields tab showed only project-scoped fields; the 9 global standard fields never
appeared (the "Global fields" section was always empty).
**Root cause:** `filterset_fields=["project"]` did an **exact** match on the FK, so `?project=<id>`
excluded `project IS NULL` rows.
**Fix:** `backend/apps/itsm_core/views.py` — dropped `project` from `filterset_fields` and added
`get_queryset` that ORs `Q(project=id) | Q(project__isnull=True)` (mirrors `get_field_definitions`).
**QA hook:** *Fields/Layout regions* checklist — "Fields tab lists project + global system fields".

### Bug B — `TicketCreateSerializer.requestor`/`assignee` were `UUIDField`, but User PK is integer

**Symptom:** creating a ticket with a requestor/assignee (now that the layout-driven form sends them)
failed 400 `"Must be a valid UUID."`. The old hardcoded form never sent these, so it was latent.
**Root cause:** `accounts.User` has an **integer** PK; the create serializer declared those FKs as
`UUIDField` (only `assigned_group` is genuinely UUID).
**Fix:** `backend/apps/itsm_tickets/serializers.py` — `requestor`/`assignee` → `CharField`
(`_user(pk=…)` resolves either); `assigned_group` stays `UUIDField`.
**QA hook:** *Fields/Layout regions* — "create with requestor/assignee/custom_fields returns 201".

**Design note (regions):** `region`/`width` are a brand-new axis, so migration `0004` includes a
one-time RunPython backfill putting the standard sidebar keys (priority/mode/requestor/group/
assignee/source) on the right for layouts created before the feature; admins move fields freely
after. RTE → forced `main`/`full`; sidebar → forced `full` (server-enforced in the serializer).

## 2026-06-20 — Settings / Admin — Zoho-style settings hub + four backend gaps closed

Feature (the per-helpdesk **Settings** area: HelpDesk Configuration + Project Configuration). Mostly a
frontend aggregation over existing engines, but it surfaced four backend gaps worth recording.

**Gap 1 — Business hours had no write endpoint.** `BusinessCalendarSerializer` nests `hours` as
`read_only`, and `itsm_sla/views.py` had only Calendar + Holiday viewsets, so the calendar editor could
not edit working windows. **Fix:** added `BusinessHoursViewSet` (`itsm_sla/views.py`, module
`itsm.sla.calendars`, `filterset_fields=["calendar","weekday"]`) at `business-hours` per-row CRUD +
`BusinessHoursSerializer.validate` (400 on `end_time <= start_time`). Deliberately **no
`(calendar, weekday)` unique constraint** — `business_time.spec_from_calendar` aggregates multiple windows
per weekday (split shifts); a unique constraint would break add/edit.

**Gap 2 — `GroupSerializer` omitted `helpdesk`; list was unscoped.** The model had the FK but the API
neither exposed nor scoped by it, so "assigned groups per helpdesk" was impossible. **Fix:** added
`helpdesk`/`helpdesk_name` to the serializer; `GroupViewSet.get_queryset` now scopes to
`Q(helpdesk_id__in=scope) | Q(helpdesk__isnull=True)` and `perform_create` guards inaccessible helpdesks
(mirrors `ProjectViewSet`).

**Gap 3 — No project→calendar binding.** Calendars are global; nothing let a project pick one. **Fix:**
added nullable `Project.calendar` FK (`0002_project_calendar`) preferred by `sla_engine.start_trackers`
(`ticket.project.calendar or policy.calendar or default`); the per-tracker `calendar` snapshot still
freezes the choice, so in-flight clocks are unaffected.

**Gap 4 — `ApprovalWorkflow` was helpdesk-scoped only.** Per-project approval config needed a project
link. **Fix:** added nullable `ApprovalWorkflow.project` FK (`0002_approvalworkflow_project`) +
`?project=` filter + helpdesk-scoped `get_queryset`.

**Prefix edits:** left always-editable by design (user decision) — the helpdesk/project `key` write
serializers are unchanged; the UI warns + confirms because existing `ticket_number`s are never renumbered.
**QA hook:** new *Settings / Admin* section in `QA_CHECKLIST.md`.

## 2026-06-20 — One Helpdesk — Helpdesk (workspace/department) layer + per-helpdesk scoping

Feature, not a bug — but it shipped with two gotchas worth recording so they don't recur. The product renamed ITSM → **One Helpdesk**: multiple departments (IT, HR, …) share one platform, each a **Helpdesk** (new `apps.itsm_helpdesks` app: `Helpdesk` + `HelpdeskMembership` + `services.py` scoping primitives). `Project` gained a non-null `helpdesk` FK; ticket numbers are now per-helpdesk-prefixed (`ITINC-1`); 8 shared-service guards clamp every ticket-facing query to the caller's accessible helpdesks. The two bugs flushed out during the build:

### Gotcha A — Postgres "pending trigger events" when deleting rows + `ALTER TABLE` in one migration

**Symptom:** the migration that dropped the legacy global `INC` / `REQ` projects and then added the mandatory `Project.helpdesk` FK failed on Postgres with `cannot ALTER TABLE "itsm_projects_project" because it has pending trigger events`.
**Root cause:** the legacy `DELETE`s (cascading through PROTECTed dependents — `Ticket.project`, `EmailChannel.project`) queue deferred FK trigger events that must commit before the table can be altered. Doing the deletes and the `ALTER TABLE` in the **same** migration (same transaction) leaves those trigger events pending at the `ALTER`.
**Fix:** split into two migrations — `itsm_projects/0002_drop_legacy_global_projects.py` (RunPython: clears PROTECT FKs then deletes legacy projects; guarded to no-op on a fresh DB) commits first, then `0003_project_helpdesk_field.py` does the `AddField` + index + partial unique constraint. The DELETEs now commit in their own transaction before the ALTER runs.
**QA hook:** "Old global INC/REQ are gone" + "`seed_itsm` is re-runnable" under *One Helpdesk — Helpdesk scoping* in `QA_CHECKLIST.md`.

### Gotcha B — pre-existing broken Notification frontend contract (had been silently dead)

**Symptom:** the notification bell badge never lit and the new /home attention panel showed no unread notifications, even when `InAppNotification` rows existed for the user.
**Root cause:** a long-standing field-name mismatch between the API and the frontend Notification client (it had been dead since the notifications UI landed — nothing exercised it until the attention panel did). The frontend read `read`, `message`/`body`, and `{count}` while the API emits `is_read`, `body_text`, and `{unread}`.
**Fix:** corrected the frontend contract — `read` → `is_read`, `message`/`body` → `body_text`, `{count}` → `{unread}` — so the bell badge and the /home attention panel's unread-notifications block render correctly.
**QA hook:** existing notification-rendering checks plus the /home attention panel (unread notifications) verification.

---

## 2026-05-10 — Project Management — Comments + Activity Log on items (initial scaffold)

Not a bug — first entry to seed the format. Feature shipped:
- Per-item rich-text comments (Tiptap, server-sanitised via bleach).
- Per-item activity feed covering cell changes, comment lifecycle, attachment add/remove, item create/rename/move.
- Right-side `Sheet` drawer with Comments / Files / Activity tabs.
- Comment-bubble icon column on the board, count badge.
- `/api/v1/pm/items/<id>/files/` unions cell + comment attachments for the Files tab.

Future regressions in this area should land here with the format above.
