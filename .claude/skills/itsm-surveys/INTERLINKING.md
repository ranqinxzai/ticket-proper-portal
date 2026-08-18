# itsm-surveys — Interlinking

How CSAT touches the rest of the platform (all inbound edges are lazy / no-op-safe).

- **itsm-workflows** — the trigger. `engine.transition._after_commit` calls
  `hooks.survey_on_resolution(ticket, from, to)`. Uses the in-scope `to_status`
  (category `done`, key `closed` vs resolved/fulfilled) already computed there.
- **itsm-core** — `hooks.survey_on_resolution` (lazy import + swallow, rule 12); `services.html`
  (`html_to_text`) sanitises the comment; `services.audit.log_event("survey_submitted")`.
- **itsm-notifications** — reused wholesale for delivery: `email_layout.wrap` (branded shell; gained
  optional `cta_url`/`cta_label` + a `SurveyRequest` accent), `templates.build_context`, and the
  `NotificationOutbox` + flusher (from-address/threading precedence unchanged). No new sender.
- **itsm-projects** — `SurveyConfig.project` FK; `ProjectViewSet.perform_create` calls
  `ensure_survey_config(project)`; the **Survey** settings tab lives beside Notifications.
- **itsm-tickets (portal)** — survey `@action`s on `PortalTicketViewSet` (module
  `itsm.portal.tickets`; the `requestor=self` queryset clamp is the auth boundary). `SurveyResponse`
  FK → `Ticket`. Portal request-detail page shows a "Give feedback" banner when pending.
- **itsm-reporting** — `csat-summary` / `csat-responses` reports (over `SurveyResponse` via
  `_survey_base`) + `widget_data` `csat_pct`/`csat_avg` KPI metrics.
- **itsm-dashboards** — the command-center dashboard renders the CSAT `KpiCard` from `csat-summary`.
- **itsm-rbac** — modules `itsm.surveys` / `itsm.surveys.config` (Admin+Supervisor full CRUD). The
  portal submit rides `itsm.portal.tickets` (requestors already hold read+create) — no grant change.
- **itsm-helpdesks** — CSAT reports clamp by `project__helpdesk_id__in` (never leaks across
  helpdesks), same as ticket reports.

See [[itsm-notifications]], [[itsm-workflows]], [[itsm-projects]], [[itsm-tickets]],
[[itsm-reporting]], [[itsm-dashboards]], [[itsm-rbac]].
