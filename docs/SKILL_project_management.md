# SKILL — Project Management Module

The Monday.com-style boards module. Code lives in [`backend/apps/project_management/`](../backend/apps/project_management/) + [`frontend/components/pm/`](../frontend/components/pm/) + [`frontend/lib/pm.ts`](../frontend/lib/pm.ts).

---

## Domain Model

```
Project        (sidebar entry, e.g. "Sales pipeline")
  └─ Board     (a tab inside a project, e.g. "Q3 leads")
       ├─ Column   (dynamic schema; type ∈ text/long_text/number/status/dropdown/priority/person/date/checkbox/file)
       ├─ Group    (coloured row-section)
       └─ Item     (a row)
             ├─ CellValue (item × column → typed value)
             │     └─ CellAttachment (long_text / file cells only)
             ├─ ItemComment (rich-text thread)
             │     └─ CommentAttachment
             └─ ItemActivity (append-only audit feed)
```

All FKs are `BigAutoField`. No multi-tenant scoping (single workspace).

### Why `CellValue` instead of dynamic columns?

Users add and remove columns at runtime. Generating Django migrations for every schema change would be fragile, so we store one row per cell in a wide typed table indexed on `(item, column)` with a unique constraint.

### Column types and where their value lives

| Column type | Field on `CellValue` |
|------|------|
| text / long_text | `value_text` (+ `CellAttachment` for long_text) |
| number | `value_number` |
| status / dropdown | `value_text` = option id; label/colour come from `Column.settings.options[]` |
| priority | `value_text` ∈ `critical`/`high`/`medium`/`low` |
| date | `value_date` |
| person | `value_user` |
| checkbox | `value_bool` |
| file | (`CellAttachment` rows only) |

`apply_cell_value(cell, value)` in [serializers.py](../backend/apps/project_management/serializers.py) is the single dispatcher that writes to the right field given the column type. **Do not duplicate this logic.**

---

## Comments + Activity

### `ItemComment`
- `body_html` (sanitised via `bleach` on save) — what the UI renders
- `body_text` (server-derived plain-text mirror) — for search/notification preview
- `edited_at` (set on update)
- `is_deleted` — soft delete; the row stays so the activity log can still link to it

### `CommentAttachment`
Mirror of `CellAttachment` but bound to a comment. Same upload paths under `media/pm_attachments/comment/<id>/`.

### `ItemActivity` (append-only)
Every write site explicitly calls `apps.project_management.activity.log_activity(...)`. No signals. Actions:

| Action | Emitted by |
|--------|-----------|
| `item_created` | `ItemViewSet.create` |
| `item_renamed` | `ItemViewSet.update` (when `name` changes) |
| `item_moved` | `ItemViewSet.update` (when `group` changes) |
| `item_deleted` | `ItemViewSet.destroy` (note: cascade still wipes the trail; tracked here for completeness) |
| `cell_changed` | `ItemViewSet.set_cell` (skipped when old==new) |
| `attachment_added` / `attachment_removed` | `CellAttachmentViewSet`, `CommentAttachmentViewSet` |
| `comment_added` / `comment_edited` / `comment_deleted` | `ItemCommentViewSet` |

`payload` is a JSON dict whose shape depends on the action — see the model docstring.

### Why explicit logging instead of signals?

Two reasons:

1. **Greppability** — `git grep log_activity` lists every audit point.
2. **Snapshot semantics for cell changes** — we need the *previous* value of the cell. Signals fire after `save()`, by which point the previous value is gone. The viewset already has both old and new in scope.

### Why soft-delete comments but not items?

A deleted comment that still exists in the DB lets the activity feed say "Anil deleted his comment" with a working backlink. Items don't need this — the cascade clears their entire history when an item is hard-deleted, which is acceptable for a single-tenant app.

---

## Frontend

### Board View

[`BoardView.tsx`](../frontend/components/pm/BoardView.tsx) renders a virtualised table via `@tanstack/react-virtual`. Layout, left to right:

```
[ 40px row-action menu ]  [ 44px comment icon ]  [ dynamic columns × N ]  [ 140px add-column ]
```

The comment icon column lives **outside** the dynamic-column system — it's hard-coded into the layout because it's a board-wide affordance, not a user-defined column.

### `CommentIconCell`

Stateless. Reads `item.has_comments` + `item.comment_count`. Renders:
- `MessageSquare` (lucide) outline when count == 0
- `MessageSquareText` filled-violet + count badge when count > 0

Click → opens `ItemDrawer` for that item.

### `ItemDrawer`

A `<Sheet side="right">` at `40vw` (clamped to `[480px, 720px]`). Three tabs:

1. **Comments** — `CommentList` + `CommentComposer` at the bottom.
2. **Files** — `FilesTab`. Calls `GET /api/v1/pm/items/<id>/files/`, which unions `CellAttachment` and `CommentAttachment`, each tagged with a `source` discriminator.
3. **Activity** — `ActivityFeed`, paginated.

Tabs are lazy — data fetches the first time you open each tab.

### `CommentComposer`

Tiptap editor with `StarterKit` + `Link` + `Image` + `Placeholder`. Toolbar: bold / italic / underline / strike / bullet-list / ordered-list / link / heading.

Paste-screenshot logic is lifted from [`AttachmentUploader.tsx:40-67`](../frontend/components/AttachmentUploader.tsx).

Submit flow:
1. POST `/api/v1/pm/comments/` with `{item, body_html, body_text}` → returns `{id, …}`
2. For each pending file, POST `/api/v1/pm/comment-attachments/` with `comment=<id>` + multipart file
3. Optimistic prepend to `CommentList` and bump `item.comment_count` upstream so the row icon updates without a reload.

---

## Column Filters (client-side)

Each column header has a filter icon (visible on hover, persistent + violet when active). Clicking it opens a column-type-aware popover:

| Column type | Filter UI | Stored shape |
|------|------|------|
| status / dropdown / priority | Multi-select checklist with the column's option colours | `{ type, values: string[] }` |
| person | User picker with search; multi-select | `{ type: "person", user_ids: number[] }` |
| date | From / To date pickers (inclusive of `to` day) | `{ type: "date", from, to }` |
| text / long_text | "Contains" textbox (case-insensitive) | `{ type, contains: string }` |
| number | Min / Max range | `{ type: "number", min, max }` |
| checkbox | Checked / Unchecked toggle | `{ type: "checkbox", value: boolean }` |
| file | (no filter) | — |

State + behaviour:

- One filter per column. Setting a new filter for a column replaces the previous one.
- Filters are applied **client-side** in `BoardView` via `applyFilters(items, filters)` from `lib/pm.ts`. Implemented as an `Array.filter` before grouping into virtual rows, so:
  - **Group counts reflect the filtered subset** ("Dr · 3 items" when 3 of 5 match).
  - **Empty groups are hidden** while any filter is active.
  - **The inline "+ Add item" row is hidden** while any filter is active — preventing the surprise of typing a new item that immediately disappears because the active filter would hide it.
- Active filters render as violet chips above the column header bar with an `x` per chip and a "Clear all" button.
- Filters are NOT persisted to the URL or backend (yet) — they reset on page reload. URL persistence is a future iteration.
- Why client-side and not server-side? Boards typically hold <200 items (the default page size), all loaded into `BoardView` state already. A server-side filter would need per-column WHERE clauses against `CellValue` (one row per item × column), which is significantly more work. Revisit when a board exceeds the page size in real use.

The `lib/pm.ts` helpers:
- `PmFilter` — discriminated union of the per-column shapes above.
- `isFilterEmpty(f)` — true when the filter wouldn't actually exclude anything (e.g., `values: []`); used to decide whether to render a chip / show the violet active state.
- `applyFilters(items, filters)` — pure function. Skips empty filters automatically.

## Group Summary Row (Monday.com-style)

Each non-collapsed group ends with a thin (28-px) summary row that rolls up the visible items in that group. Filtered items are excluded automatically — when a filter is active, the summary shrinks with the visible set.

The visualisation is picked from the column type:

| Column type | Visual | Hover tooltip |
|------|------|------|
| status / dropdown / priority | Proportional stacked colour bar (segments coloured per option) | `<count>` items, list of options with count + %, plus a **"X% complete"** caption when an option's id or label matches `done` / `complete` / `closed` / `finish` |
| checkbox | Green/grey progress bar with `<pct>%` next to it | Checked vs Unchecked counts |
| number | Inline `Σ <sum> · x̄ <avg>` | Sum / Average / Min / Max plus filled-vs-total |
| person | "X people" + tiny stacked dots, "+N" overflow, "blank" tail | Per-user counts (currently rendered as `User #<id>` — next iteration will fetch /users/ once and show names) |
| date | Earliest – latest range; rose "<N> overdue" tail | Earliest / Latest / Filled / Overdue / Blank |
| text / long_text | "X / Y filled" | Same, plus % |
| file | "<N> files" | Total files + items-with-files |
| primary text | (blank — primary cell mirrors `Item.name`, no insight) | — |

Implementation:

- `components/pm/SummaryCell.tsx` is a single dispatcher; one component per cell.
- `BoardView.tsx`'s `flatRows` memo emits a `summary` row right after the last item in every non-collapsed, non-empty group (and before the inline `+ Add item` row).
- Virtualised at 28-px height alongside the existing `group / item / addItem` rows.
- Hover tooltips use the existing Radix `Tooltip` (already mounted via `TooltipProvider` in `app/layout.tsx`).

**Why per-group, not board-total?** Boards are typically structured by phase / sprint / status group, so per-group rollups answer "what's left in this phase" — exactly the question Monday.com answers. A board-level total can be added later as a separate sticky footer if it becomes a request.

**Why no per-column aggregation type picker (Sum / Avg / Median / etc.)?** Defaults are auto-picked from the column type, which covers every "obvious" insight in v1 with no UI cost. Configurable aggregation is a v2 — a `summary_type` field on `Column.settings` driven by a tiny dropdown next to the filter icon.

## Frozen Leftmost Columns + Resize + Overflow Tooltips

### Excel-style freeze pane (horizontal scroll)

The three leftmost cells stay pinned to the left edge of the scroll container while everything else scrolls horizontally:

| Cell | Sticky `left` | Width |
|------|------|------|
| Action menu (`…`) | `0px` | `40px` |
| Comment icon | `40px` | `44px` |
| Primary text column (`is_primary=true`) | `84px` | `column.width` (resizable) |

Implementation lives in [`BoardView.tsx`](../frontend/components/pm/BoardView.tsx) via three helpers — `actionStickyStyle()`, `commentStickyStyle()`, and `primaryStickyStyle(width)` — applied to the matching cells in the header, every body row (`ItemRow`, `SummaryRow`, `AddItemRow`), and the group-header content. The primary column carries a 2px right-edge box-shadow so the freeze line is visible when scrolled.

Z-index ladder (load-bearing):

- Header sticky cells: `31` (above their normal-z-20 header parent → above body content)
- Body sticky cells (item / summary / add-item / group-header content): `10–12`
- Body normal cells: `0` (auto)

Each sticky cell has a SOLID background that matches the row's natural background (white for item rows, slate-50 for summary rows, etc.) — non-sticky cells slide UNDER the sticky ones, so transparent backgrounds would leak content through.

**Group header content** is wrapped in its own `position: sticky; left: 0` div so the chevron + group name + count + actions stay visible while scrolling horizontally. The colored left border + bottom border still span the full row width.

### Column resize

Every column header has a 6-px drag handle on its right edge — `<ColumnResizeHandle>` (defined inline at the bottom of `BoardView.tsx`). On `pointerdown` it captures the starting `clientX` + `column.width` and then drags via `pointermove` listeners on `window`. During the drag, widths are kept in `liveWidths` keyed by column id and merged via `useMemo` into `sizedColumns` — so the table re-renders on every move without round-tripping to the API. On `pointerup`:

1. The override is dropped from `liveWidths`.
2. The canonical `columns` state is updated.
3. `pm.updateColumn(id, { width })` persists.

A `Math.max(MIN_COLUMN_WIDTH=80, …)` floor keeps a column from being dragged into oblivion.

The handle is `cursor-col-resize`, hover-violet for affordance. It's z-index `50` so it sits above the column's filter / kebab buttons. **The primary column is also resizable** — its sticky `left: 84px` is fixed; only its width changes, and rows downstream of it shift naturally because they're laid out in flex order.

### Overflow tooltips on cells

Every text-displaying cell type in [`CellRenderer.tsx`](../frontend/components/pm/CellRenderer.tsx) (text / long_text / number / status / dropdown / priority / date / person) sets a native `title={fullValue}` attribute on the visible content. CSS `truncate` gives the visual ellipsis; the browser shows the OS tooltip on hover with the unabridged value. Native `title` was chosen over Radix `<Tooltip>` to avoid mounting hundreds of Tooltip portals on a board with ~40 items × 10 columns; the upgrade path (a `<Tooltip>` wrapper that detects overflow via `ResizeObserver` before rendering) is a v2 if richer tooltips become valuable.

## Gotchas

1. **Primary text cell mirrors `Item.name`** — when the column with `is_primary=True` (always type=text) changes, `Item.name` is rewritten. Both `ItemViewSet.set_cell` and `ItemViewSet.update` enforce this. If you bypass these viewsets, you break the mirror.

2. **`Item.destroy` cascade** — wipes `ItemComment`, `CellValue`, `CellAttachment`, `ItemActivity`. There's no resurrect path. If audit-after-delete becomes a requirement, add `is_active` to `Item` and switch to soft delete.

3. **Sanitised HTML is rendered with `dangerouslySetInnerHTML`** — this is safe **only because** the backend `ItemCommentCreateSerializer.create` already passed the body through `bleach.clean(...)` with a strict allowlist. Never bypass that.

4. **Tiptap renders an HTML element** — must be wrapped in a stable component reference (don't define the editor component inside a parent's body — see `docs/QA_CHECKLIST.md` "React Component Stability").

5. **Status / priority chips in the activity feed** — the colour palette comes from `Column.settings.options`. The `ItemActivitySerializer.summary` is a server-rendered string; the chip rendering happens client-side from the structured `payload` (`old.value`, `new.value`).

6. **Bleach allowlist** — `p, br, strong, em, u, s, code, pre, ul, ol, li, h1..h4, blockquote, a (href, rel, target), img (src, alt)`. Adding tags later? Update `_ALLOWED_TAGS` in `serializers.py` AND the QA checklist.

7. **`/items/<id>/files/` is recomputed every request** — no caching. For a normal item with <100 attachments this is fine; if a board accumulates thousands of files per item, paginate this endpoint.
