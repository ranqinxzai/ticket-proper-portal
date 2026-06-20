# itsm-canned-notes — DB Schema (BUILT)

**Status: implemented.** Models in `itsm_tickets/models.py`, extending `BaseModel`; created by
migration `0002`.

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
| `is_shared` | bool | default True; indexed |
| `owner` | FK → User | SET_NULL, null; set to creator |
| `usage_count` | PositiveInt | default 0; bumped by `use/` |

## Notes
- Mirrors `Comment`'s `body_html`/`body_text` convention so inserted snippets and the resulting
  comments share one sanitization path.
- Soft-delete via `BaseModel`; `is_shared=False` hides a note from the shared picker.
