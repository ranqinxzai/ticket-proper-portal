# itsm-surveys — Architecture

## Why a separate app
CSAT is its own domain (config + responses + reporting), so it follows the one-app-per-domain
convention (like `itsm_approvals`/`itsm_catalog`). It **reuses** rather than reinvents: the
per-project config pattern from `itsm_notifications`, that app's durable email outbox + branded shell,
the requestor-scoped portal ticket surface, the shared HTML sanitiser, and the reporting/dashboard
plumbing. It depends on those apps only through **lazy imports** so nothing hard-couples to it.

## The one send path (post-commit, never breaks a ticket write)
```
engine.transition(...)                      # itsm_workflows
  └─ transaction.on_commit(_after_commit)
       └─ hooks.survey_on_resolution(t, from, to)   # itsm_core.hooks — lazy import, swallows errors
            └─ survey_service.maybe_send_survey(t, to)   # itsm_surveys
                 ├─ config = config_for(project)   (project row → is_default fallback)
                 ├─ guards: enabled? trigger matches to_status? requestor has email? not already surveyed?
                 ├─ SurveyResponse(pending, sent_at=now)
                 └─ _enqueue_email → NotificationOutbox(queued, event_type="SurveyRequest")
                        (email_layout.wrap message + feedback CTA; dedupe_key=survey|{t}|{resp})
```
The existing `outbox.flush()` delivers it (from-address precedence + threading unchanged). The whole
`maybe_send_survey` is wrapped so a survey failure is logged and swallowed — a ticket transition never
fails because of the survey.

## Trigger semantics
Only **done**-category transitions qualify. `closed` trigger → `to_status.key == "closed"`; `resolved`
trigger → a done status that isn't closed (resolved / fulfilled). One survey per ticket (idempotent
guard on an existing non-deleted response) — reopen/re-resolve does **not** re-survey (keeps the KPI
one-response-per-ticket; a future enhancement could re-arm).

## The answer path
Portal `POST …/survey/` → `survey_service.submit`: refuse if no survey was sent (no unsolicited
responses), validate the rating against `SCALES[scale_type]`, require a comment when configured,
`normalize()` → `csat_score`/`is_satisfied`, `html_to_text` the comment (bleach-strip → XSS-safe),
flip to `submitted`, `log_event("survey_submitted")`. No Django signals (coding rule 5).

## Scale abstraction
`models.SCALES` (+ `normalize`/`is_valid_rating`) is the single source of truth used by the settings
UI (`metadata`), the submit validator, the reporting distribution, and the KPI. Adding a scale = one
dict entry (+ a frontend render branch in `survey-editor.tsx` / the portal `RatingInput`).

## Reporting / dashboard
`itsm_reporting.reports.csat_summary`/`csat_responses` aggregate `SurveyResponse` through
`_survey_base` (the same helpdesk/project clamps as tickets, lazy-imported). The command-center
dashboard consumes `csat-summary` directly as another `KpiCard`; the configurable-dashboard
`widget_data.resolve` gained `csat_pct`/`csat_avg` KPI metrics for parity.

## Multi-tenancy
TENANT app: models live per-org schema, migrate via `migrate_schemas`, seeded per-org by `seed_itsm`
(idempotent). No `tenant_id` filters — isolation is by the active schema.
