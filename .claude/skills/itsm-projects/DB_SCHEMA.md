# itsm-projects — DB Schema

Both extend `BaseModel` (UUID PK + timestamps + soft delete).

## `Project`
| Field | Type | Notes |
|---|---|---|
| `helpdesk` | FK → itsm_helpdesks.Helpdesk | **CASCADE**, non-null, `related_name="projects"` |
| `name` | CharField(150) | |
| `key` | CharField(10) | **globally unique** (helpdesk-prefixed, e.g. `ITINC`); `KEY_VALIDATOR` `^[A-Z][A-Z0-9]{1,9}$` |
| `description` | TextField | blank |
| `project_type` | CharField(20) | `incident` / `service_request` / `custom` (default custom) |
| `status` | CharField(12) | `active` / `inactive` (default active) |
| `color` | CharField(16) | default `#6366f1` |
| `icon` | CharField(32) | blank |
| `default_group` | FK → itsm_groups.Group | SET_NULL, null |
| `default_workflow` | FK → itsm_workflows.Workflow | **PROTECT**, null |
| `lead` | FK → User | SET_NULL, null |
| `created_by` | FK → User | SET_NULL, null, `related_name="created_itsm_projects"` |

Ordering `name`. Indexes: `key`, `(project_type, status)`, `(helpdesk, status)`.
Constraint: **`uniq_helpdesk_default_projecttype`** — partial UniqueConstraint `(helpdesk, project_type)`
WHERE `project_type ∈ (incident, service_request)` AND `is_deleted=False` (one default Incident + one
default Request per helpdesk; CUSTOM unconstrained, soft-deleted rows excluded so a reseed never collides).

Migrations: `0002_drop_legacy_global_projects` (RunPython drops the old global INC/REQ + PROTECTed
dependents — its own migration so the DELETEs commit before the ALTER, avoiding Postgres "pending trigger
events"), then `0003_project_helpdesk_field` (AddField + index + constraint).

## `TicketType`
| Field | Type | Notes |
|---|---|---|
| `project` | FK → Project | CASCADE, `related_name="ticket_types"` |
| `name` | CharField(80) | |
| `key` | SlugField(50) | |
| `icon` | CharField(32) | blank |
| `base_category` | CharField(20) | `incident` / `service_request` (default incident) |
| `parent` | FK → self | SET_NULL, null |
| `is_active` | bool | default True |
| `is_default` | bool | default False |
| `sort_order` | PositiveInt | |

Constraint: **`uniq_project_tickettype_key (project, key)`**. Ordering `sort_order, name`.

## Seeded data
Per active helpdesk (keys prefixed with the helpdesk code, e.g. IT → `ITINC`/`ITREQ`):
- **`<KEY>INC`** (Incident Management, type incident, shared default Incident workflow + the helpdesk's
  Service Desk group): ticket types Incident(default)/Hardware/Network/Application.
- **`<KEY>REQ`** (Request Management, type service_request, shared default Request workflow + the
  helpdesk's Service Desk group): ticket types Service Request(default)/Access Request/Hardware
  Request/Onboarding.
