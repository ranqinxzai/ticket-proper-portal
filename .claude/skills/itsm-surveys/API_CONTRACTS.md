# itsm-surveys — API Contracts

Base: `/api/v1/itsm/`.

## Survey config — `itsm.surveys.config` (Supervisor/Admin)
### `GET survey-configs/metadata/`
`{ scale_types: [{value,label,values:[…]}], triggers: [{value,label}] }` — drives the settings pickers.
### `GET survey-configs/for-project/?project=<id>`
Returns the project's config, **provisioning the clone on first access** (self-heals older projects).
Shape (`SurveyConfigSerializer`): `{ id, project, project_key, is_default, enabled, trigger,
scale_type, question_text, intro_text, scale_labels, comment_enabled, comment_prompt,
comment_required, thank_you_text, email_subject, email_body_html, created_at, updated_at }`.
`400` if `project` missing; `404` if unknown.
### `PATCH survey-configs/{id}/`
Edit the config. `project`/`is_default`/`project_key` are read-only. `scale_type` must be a known
scale; `scale_labels` coerced to a list of strings.
### `GET survey-configs/?project=&is_default=&enabled=`
List (Supervisor). `POST`/`DELETE` exist (ItsmModelViewSet) but aren't used by the UI — configs are
provisioned by seed/`for-project`, not created by hand.

## Portal survey — `itsm.portal.tickets` (requestor; owns-ticket clamp = the boundary)
`@action`s on `PortalTicketViewSet`. `get_object` 404s a ticket the caller doesn't own, so only the
ticket's requestor can read/submit (no separate object check).
### `GET portal/requests/{id}/survey/`
`{ enabled: bool, config: {scale_type, question_text, intro_text, scale_labels, comment_enabled,
comment_prompt, comment_required, thank_you_text} | null, response: {id, status, scale_type, rating,
comment, submitted_at} | null }`. `{id}` is the ticket number (or UUID).
### `POST portal/requests/{id}/survey/` → `{ rating, comment? }`
Records the answer (validates `rating` against the scale, requires a comment when configured,
normalises → `csat_score`/`is_satisfied`, bleach-strips the comment, `log_event`). Returns the same
state shape with the updated `response`. **`400`** on validation failure (invalid rating / missing
required comment / **no survey was sent for this ticket** — unsolicited feedback is refused so the
CSAT numbers only reflect real sends). **`404`** for a non-requestor.

## Reports — `itsm.reports`
### `GET reports/csat-summary/?helpdesk=&project=&date_from=&date_to=`
`{ responses, sent, satisfied, csat_pct, avg_score, response_rate, by_rating:[{label,rating,value,
pct}] }` — over SUBMITTED responses in range (`submitted_at`); `sent` uses `sent_at`. Same
helpdesk/project scoping (`_survey_base` mirrors reports `_base`).
### `GET reports/csat-responses/?…`
Per-response rows (newest first, ≤2000): `{ ticket, project, requestor, scale_type, rating,
satisfied, comment, submitted_at }`.

## Survey email
Not an API — sent via the notification outbox (`event_type="SurveyRequest"`,
`dedupe_key="survey|{ticket}|{response}"`), delivered by the existing flusher with the branded shell
and a **Give feedback** CTA to `/t/{org}/portal/requests/{number}/feedback`.
