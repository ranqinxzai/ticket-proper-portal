# itsm-canned-notes — DB Schema (BUILT)

**Status: implemented.** Models in `itsm_tickets/models.py`, extending `BaseModel`; created by
migration `0002`; **scope dimension added by migration `0004_cannednote_scope`**.

## `CannedNoteCategory`
| Field | Type | Notes |
|---|---|---|
| `name` | CharField(120) | |
| `sort_order` | PositiveInt | default 0 |
| `is_active` | bool | default True |

## `CannedNote`
| Field | Type | Notes |
|---|---|---|
| `title` | CharField(200) | |
| `body_html` | TextField | sanitized on create (`itsm_core.sanitize_html`) |
| `body_text` | TextField | plain mirror (`html_to_text`) |
| `shortcut` | SlugField(50) | blank; indexed |
| `category` | FK → CannedNoteCategory | SET_NULL, null |
| `scope` | CharField(12) | `personal` / `workspace` / `project`; default `workspace`; indexed |
| `helpdesk` | FK → itsm_helpdesks.Helpdesk | SET_NULL, null; **badge label only** |
| `project` | FK → itsm_projects.Project | SET_NULL, null; **badge label only** |
| `is_shared` | bool | default True; indexed; **server-derived from `scope`** (`scope != personal`) |
| `owner` | FK → User | SET_NULL, null; set to creator |
| `usage_count` | PositiveInt | default 0; bumped by `use/` |

## Scope dimension (migration `0004`)
- **`scope`** drives visibility + the UI badge: `workspace` (helpdesk-wide, "Workspace" badge),
  `project` (one project, "Project" badge), `personal` (creator-only, no badge).
- **`helpdesk`/`project` are labels, not access filters** — every agent sees every *shared*
  (workspace|project) note regardless of membership; only `personal` notes are private. So the FKs
  exist to render the badge and group the library, never to clamp the queryset.
- **`on_delete=SET_NULL`** on both FKs: retiring a helpdesk/project never deletes communal notes;
  the badge just falls back to the generic "Workspace"/"Project".
- **Backfill:** `0004` maps `is_shared=False → scope=personal`, `is_shared=True → scope=workspace`.
- **Index** added on `scope`. Apply per tenant schema with `manage.py migrate_schemas` (`itsm_tickets`
  is a TENANT_APP).

## Notes
- Mirrors `Comment`'s `body_html`/`body_text` convention so inserted snippets and the resulting
  comments share one sanitization path.
- Soft-delete via `BaseModel`. `personal` notes (= `is_shared=False`) are visible only to `owner`.
