# itsm-surveys — User Flows

## Admin: turn on a survey (Supervisor)
1. Project settings → **Survey** tab (`settings/projects/[projectKey]?tab=survey`).
2. Toggle **enabled**, pick **when to send** (Resolved / Closed) and a **rating scale**
   (CSAT 1–5 / Stars / Thumbs / NPS). A live preview shows the requestor's control.
3. Edit the question, intro, comment prompt (+ require it?), thank-you message, and the survey email
   (subject + message; the branded shell + "Give feedback" button are added automatically).
4. Save → `PATCH survey-configs/{id}`. Read-only for non-Supervisors.

## System: send the survey
When an agent resolves/closes a ticket whose project has the survey enabled and the transition matches
the trigger, and the requestor has an email → a `pending` `SurveyResponse` is created and a branded
survey email is queued (once per ticket). No email → nothing. Disabled → nothing.

## Requestor: give feedback
1. Click **Give feedback** in the email (deep-links to the portal feedback page, `?r=N` preselects a
   rating) — or the banner on their request page.
2. Log into the portal (required). The feedback page shows the configured scale + optional comment.
3. Submit → `POST portal/requests/{id}/survey/`. Sees the thank-you message; revisiting shows the
   already-submitted state. A non-requestor can't reach it (404).

## Agent/Supervisor: read the results
- **Dashboard** — the command-center CSAT KPI tile (satisfaction %, response count), auto-refreshing.
- **Reports** — **CSAT Summary** (score, response rate, distribution) and **CSAT Responses**
  (per-response ratings + comments), scoped by project / date / helpdesk, exportable to Excel/CSV.

## Edge cases
- Reopen → re-resolve: **no** second survey (one response per ticket; the KPI counts each ticket once).
- Submitting when no survey was sent: **400** (unsolicited feedback refused).
- Invalid rating for the scale, or missing a required comment: **400** with a message.
