# itsm-surveys — Bug Log

Gotchas discovered while building the CSAT survey feature (2026-07-02).

- **`SurveyConfig.project` is a nullable FK, not OneToOne.** A OneToOne would collide on its unique
  constraint when a config is soft-deleted and re-provisioned (the soft-deleted row keeps `project_id`).
  Mirrors `NotificationScheme`: FK + `.filter(project=…, is_deleted=False).first()` + `ensure_survey_config`
  enforce "one per project" in code.
- **Reopen is only valid from `resolved`, not `closed`** (seeded incident workflow). A test that tried
  `Reopen` after `Close` hit the engine's 409 optimistic-lock guard. Idempotency is instead exercised by
  calling `maybe_send_survey` twice — and the real guard (existing non-deleted response ⇒ no resend) makes
  reopen→re-resolve safe regardless.
- **`RichTextEditor` prop is `disabled`, not `editable`.** Matches the notifications editor.
- **The survey CTA must point at `/feedback`, not the ticket.** `email_layout.wrap` defaulted the CTA to
  the ticket URL; added optional `cta_url`/`cta_label` (backward-compatible) so the survey email links to
  the portal feedback page.
- **`outbox.flush` is event-type-agnostic** — it sends any queued row's subject/body/html, so enqueuing a
  `SurveyRequest` row needs no flusher change.
- **Submit refuses when no survey was sent** (400) so the CSAT numbers only reflect real sends — otherwise a
  requestor could POST unsolicited responses and skew the KPI.
- **`_survey_base` must re-implement the report clamps** (it filters `SurveyResponse`, not `Ticket`, so it
  can't reuse reports `_base`). Keep its helpdesk/project filters in sync with `_base`.
