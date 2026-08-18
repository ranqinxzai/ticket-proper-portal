# itsm-surveys

## Purpose
Per-project **CSAT (customer satisfaction) surveys**. When a ticket is resolved or closed, the
requestor is emailed for feedback; they rate their experience from the **portal** (login-required)
and optionally leave a comment. Results feed a **CSAT report** and a **dashboard KPI**. The survey's
input options — scale TYPE, wording, and email message — are configured **per project** from a new
**Survey** settings tab. **Status: BUILT** — `backend/apps/itsm_surveys/` (models, service, seed,
serializers/views/urls, migration `0001_initial`, tests). The `itsm.surveys` / `itsm.surveys.config`
RBAC modules are seeded.

## Backend app path
`backend/apps/itsm_surveys/` (TENANT app — registered in `TENANT_APPS`, after `itsm_notifications`).

## Key concepts
- **`SurveyConfig`** — one per `Project` (nullable-project global `is_default` template + one editable
  clone per project, mirroring `NotificationScheme`). Holds `enabled`, `trigger`
  (`resolved`|`closed`), `scale_type` (`csat5`|`stars5`|`thumbs`|`nps`), the copy
  (`question_text`/`intro_text`/`scale_labels`/`comment_*`/`thank_you_text`), and the survey email
  (`email_subject`/`email_body_html`). Shipped **disabled** — an admin opts in per project.
- **`SurveyResponse`** — one per ticket (created `pending` when the survey is sent, flipped to
  `submitted` when answered). Stores the raw `rating` plus a **scale-agnostic** `csat_score` (0–100)
  and `is_satisfied` (top-box) computed at submit so one CSAT % KPI rolls up every scale type. The
  comment is bleach-stripped to plain `comment_text` (XSS-safe).
- **Trigger** — the workflow engine's `_after_commit` calls `hooks.survey_on_resolution(ticket,
  from, to)` → `survey_service.maybe_send_survey`. It fires only when the ticket enters a **done**-
  category status matching the project's `trigger` (`closed` → the `closed` status; `resolved` → the
  first done status that isn't closed, e.g. resolved/fulfilled). **Idempotent — one survey per
  ticket** (no resend, no double-count); no-op when disabled / requestor has no email.
- **Email reuse** — `maybe_send_survey` renders the config's message over the ticket context, wraps it
  in the notifications branded shell (`email_layout.wrap`, with a **feedback-page CTA**), and drops a
  `NotificationOutbox` row (`event_type="SurveyRequest"`, `dedupe_key="survey|{ticket}|{response}"`)
  for the existing flusher — no new sender, and the same from-address/threading precedence applies.

## Normalisation (scale → CSAT)
`models.SCALES` + `models.normalize(scale, rating)` are the single source of truth (validator +
distribution + KPI): csat5/stars5 satisfied ≥4; thumbs 1=down/2=up (satisfied = up); nps 0–10
satisfied ≥7. `csat_score` = linear map of the raw rating to 0–100.

## Trigger flow (the one write path)
`engine.transition._after_commit` → `hooks.survey_on_resolution` → `survey_service.maybe_send_survey`
(create pending `SurveyResponse` + enqueue email). Requestor answers → portal
`POST /portal/requests/{id}/survey/` → `survey_service.submit` (validate rating for the scale, require
a comment if configured, normalise, sanitise the comment, `log_event`).

## Frontend
- **Survey settings tab** (`settings/projects/[projectKey]?tab=survey`) —
  `components/settings/survey-editor.tsx`: enable toggle, trigger + scale pickers (a live scale
  preview), question/comment/thank-you copy, and the survey email (subject + Tiptap message). Gated by
  `itsm.surveys.config` (Supervisor-only; read-only for others).
- **Portal feedback page** — `app/t/[org]/(portal)/portal/requests/[id]/feedback/page.tsx`: renders
  the scale widget for the config's `scale_type` (numbers / stars / thumbs / NPS) + optional comment,
  submits via `portalApi.submitSurvey`, and shows the thank-you / already-submitted state. A
  "Give feedback" banner appears on the portal request-detail page while a survey is pending. The
  survey email's CTA deep-links here (with `?r=N` to preselect a rating).
- **Dashboard CSAT KPI** — the command-center dashboard adds a `KpiCard` fed by
  `reportsApi.get("csat-summary")` (auto-refreshes with the rest via `useLivePoll`).

## API clients
- **Config (Supervisor):** `/api/v1/itsm/survey-configs/` (`SurveyConfigViewSet`, module
  `itsm.surveys.config`) — `metadata`, `for-project` (self-heals), PATCH. Client `surveyConfigApi`.
- **Portal (requestor):** `GET|POST /portal/requests/{id}/survey/` — `@action`s on
  `PortalTicketViewSet` (module `itsm.portal.tickets`; the requestor-owns-ticket queryset clamp is the
  auth boundary — a non-requestor gets 404). Client `portalApi.survey` / `portalApi.submitSurvey`.
- **Reports:** `csat-summary` / `csat-responses` in `itsm_reporting` (`itsm.reports`).

## RBAC module codes
- `itsm.surveys` / **`itsm.surveys.config`** (Admin + Supervisor full CRUD; Agents/Requestors: none).
- Portal submit reuses **`itsm.surveys` is not used** — it rides `itsm.portal.tickets` (requestors
  already hold read+create), so no requestor grant change was needed.

## Key files
`models.py` (`SurveyConfig`/`SurveyResponse` + `SCALES`/`normalize`/`is_valid_rating`),
`services/survey_service.py` (`maybe_send_survey`/`submit`/`config_for`/`public_config`),
`seed.py` (`run`/`ensure_survey_config`/`backfill_survey_configs`), `serializers.py`, `views.py`,
`urls.py`, `migrations/0001_initial.py`, `tests.py`. Touch-points: `itsm_core/services/hooks.py`
(`survey_on_resolution`), `itsm_workflows/services/engine.py` (`_after_commit` call),
`itsm_notifications/services/email_layout.py` (optional CTA args + `SurveyRequest` accent),
`itsm_tickets/portal.py` (survey `@action`), `itsm_reporting/services/reports.py`
(`csat-summary`/`csat-responses`) + `widget_data.py`, `itsm_projects/views.py` (perform_create hook),
`itsm_rbac/registry.py` (modules), `core/settings.py` (TENANT_APPS), the `seed_itsm` command.
Frontend: `components/settings/survey-editor.tsx`, the portal `feedback/page.tsx`, `lib/itsm/api.ts`
(`surveyConfigApi` + `portalApi.survey`), `lib/itsm/types.ts`, `components/reports/catalog.ts`,
dashboard `page.tsx`.
