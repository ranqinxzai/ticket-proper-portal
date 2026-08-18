# itsm-surveys — DB Schema

Both extend `BaseModel` (UUID PK + timestamps + soft delete). App label `itsm_surveys`,
migration `0001_initial`.

## `SurveyConfig`
Per-project CSAT config. `project` is **nullable** — the one `is_default=True` row (project NULL) is
the seed template + fallback; every other row is a project's own editable clone (one per project,
enforced in code + `seed.ensure_survey_config`). FK (not OneToOne) mirrors `NotificationScheme` so
soft-delete + re-provision never collides on a unique constraint.

| Field | Type | Notes |
|---|---|---|
| `project` | FK → itsm_projects.Project | CASCADE, **null**, `related_name="survey_configs"` |
| `is_default` | bool | default False — the global template row |
| `enabled` | bool | default **False** (opt-in per project) |
| `trigger` | CharField(10) | `resolved` \| `closed` (default `closed`) |
| `scale_type` | CharField(10) | `csat5` \| `stars5` \| `thumbs` \| `nps` (default `csat5`) |
| `question_text` | CharField(300) | the rating question |
| `intro_text` | TextField | blank |
| `scale_labels` | JSONField | default `[]` — optional per-point labels |
| `comment_enabled` | bool | default True |
| `comment_prompt` | CharField(300) | |
| `comment_required` | bool | default False |
| `thank_you_text` | TextField | |
| `email_subject` | CharField(300) | Django-template over the ticket context |
| `email_body_html` | TextField | the survey email MESSAGE (branded shell + CTA added at send) |

Indexes: `project`, `is_default`.

## `SurveyResponse`
One per ticket (created `pending` on send, `submitted` on answer).

| Field | Type | Notes |
|---|---|---|
| `ticket` | FK → itsm_tickets.Ticket | CASCADE, `related_name="survey_responses"` |
| `project` | FK → itsm_projects.Project | CASCADE, `related_name="survey_responses"` (denormalised for reporting/scoping) |
| `requestor` | FK → User | SET_NULL, null |
| `config` | FK → SurveyConfig | SET_NULL, null |
| `status` | CharField(10) | `pending` \| `submitted` (default `pending`) |
| `scale_type` | CharField(10) | snapshot at send time |
| `rating` | PositiveSmallInt | null; raw value on the snapshot scale |
| `csat_score` | FloatField | null; normalised 0–100 (`models.normalize`) |
| `is_satisfied` | BooleanField | null; top-box, scale-agnostic (KPI numerator) |
| `comment_html` | TextField | blank (reserved; plain input stored in `comment_text`) |
| `comment_text` | TextField | blank; bleach-stripped plain text (XSS-safe) |
| `sent_at` | DateTimeField | null |
| `submitted_at` | DateTimeField | null |

Ordering `-created_at`. Indexes: `(project, status)`, `(project, submitted_at)`, `is_satisfied`,
`ticket`.

## Normalisation (`models.SCALES` / `normalize`)
| scale | valid ratings | satisfied (top-box) | csat_score |
|---|---|---|---|
| csat5 / stars5 | 1..5 | ≥ 4 | (r−1)/4 × 100 |
| thumbs | 1 (down), 2 (up) | = 2 | 0 or 100 |
| nps | 0..10 | ≥ 7 | r/10 × 100 |

## Seeded data
`seed.run()` creates the single `is_default` config (disabled). `ensure_survey_config(project)` clones
it per project (from `ProjectViewSet.perform_create` + `backfill_survey_configs`). No responses seeded.
