# Bug Log — Ticketing System

Append-only log of fixed bugs. Newest first. Each entry: date, module, summary, root cause, fix location.

Format:

```
## YYYY-MM-DD — Module — One-line summary

**Symptom:** what the user saw.
**Root cause:** the actual bug.
**Fix:** file:line + what changed.
**QA hook:** which checklist item should have caught it (and now does).
```

---

## 2026-06-20 — One Helpdesk — Helpdesk (workspace/department) layer + per-helpdesk scoping

Feature, not a bug — but it shipped with two gotchas worth recording so they don't recur. The product renamed ITSM → **One Helpdesk**: multiple departments (IT, HR, …) share one platform, each a **Helpdesk** (new `apps.itsm_helpdesks` app: `Helpdesk` + `HelpdeskMembership` + `services.py` scoping primitives). `Project` gained a non-null `helpdesk` FK; ticket numbers are now per-helpdesk-prefixed (`ITINC-1`); 8 shared-service guards clamp every ticket-facing query to the caller's accessible helpdesks. The two bugs flushed out during the build:

### Gotcha A — Postgres "pending trigger events" when deleting rows + `ALTER TABLE` in one migration

**Symptom:** the migration that dropped the legacy global `INC` / `REQ` projects and then added the mandatory `Project.helpdesk` FK failed on Postgres with `cannot ALTER TABLE "itsm_projects_project" because it has pending trigger events`.
**Root cause:** the legacy `DELETE`s (cascading through PROTECTed dependents — `Ticket.project`, `EmailChannel.project`) queue deferred FK trigger events that must commit before the table can be altered. Doing the deletes and the `ALTER TABLE` in the **same** migration (same transaction) leaves those trigger events pending at the `ALTER`.
**Fix:** split into two migrations — `itsm_projects/0002_drop_legacy_global_projects.py` (RunPython: clears PROTECT FKs then deletes legacy projects; guarded to no-op on a fresh DB) commits first, then `0003_project_helpdesk_field.py` does the `AddField` + index + partial unique constraint. The DELETEs now commit in their own transaction before the ALTER runs.
**QA hook:** "Old global INC/REQ are gone" + "`seed_itsm` is re-runnable" under *One Helpdesk — Helpdesk scoping* in `QA_CHECKLIST.md`.

### Gotcha B — pre-existing broken Notification frontend contract (had been silently dead)

**Symptom:** the notification bell badge never lit and the new /home attention panel showed no unread notifications, even when `InAppNotification` rows existed for the user.
**Root cause:** a long-standing field-name mismatch between the API and the frontend Notification client (it had been dead since the notifications UI landed — nothing exercised it until the attention panel did). The frontend read `read`, `message`/`body`, and `{count}` while the API emits `is_read`, `body_text`, and `{unread}`.
**Fix:** corrected the frontend contract — `read` → `is_read`, `message`/`body` → `body_text`, `{count}` → `{unread}` — so the bell badge and the /home attention panel's unread-notifications block render correctly.
**QA hook:** existing notification-rendering checks plus the /home attention panel (unread notifications) verification.

---

## 2026-05-10 — Project Management — Comments + Activity Log on items (initial scaffold)

Not a bug — first entry to seed the format. Feature shipped:
- Per-item rich-text comments (Tiptap, server-sanitised via bleach).
- Per-item activity feed covering cell changes, comment lifecycle, attachment add/remove, item create/rename/move.
- Right-side `Sheet` drawer with Comments / Files / Activity tabs.
- Comment-bubble icon column on the board, count badge.
- `/api/v1/pm/items/<id>/files/` unions cell + comment attachments for the Files tab.

Future regressions in this area should land here with the format above.
