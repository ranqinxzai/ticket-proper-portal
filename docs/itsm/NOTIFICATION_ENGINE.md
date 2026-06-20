# Notification Engine — ITSM Platform

Design for `itsm_notifications` (planned, **M6**). The integration points already exist today: ticket/comment/workflow services call `hooks.emit_event(...)` inside `transaction.on_commit`, and `hooks.emit_event` lazily routes to `notifications.bus.emit` (no‑op until the app is built).

---

## 1. The Event Bus

Single choke‑point:

```python
bus.emit(event_type, ticket, context=None, actor=None)
```

- Called from ticket / comment / workflow / SLA services **inside `transaction.on_commit`** — so a rolled‑back write never emits.
- **Never raises into callers:** the engine logs and swallows every error (a notification failure must not break a ticket write). This is enforced today by the `hooks._safe(...)` wrapper.
- The bus resolves the project's `NotificationScheme`, finds active rules for the event, resolves recipients, renders templates, writes in‑app rows, and enqueues email rows in a transactional outbox — all synchronously in the emitting request's commit, except actual email **delivery**, which is async via the outbox flusher.

### Event catalogue
`TicketCreated`, `TicketUpdated`, `FieldChanged`, `StatusChanged`, `Assigned`, `CommentAdded`, `CommentAddedPrivate`, `Resolved`, `Closed`, `SLAWarning`, `SLABreach`, `Mentioned`. (Today the services already emit `TicketCreated`, `Assigned`, `StatusChanged`, `CommentAdded` / `CommentAddedPrivate`, `Mentioned`.)

## 2. Configuration Model

| Entity | Purpose |
|---|---|
| **`NotificationScheme`** | Per‑project container of rules. A project points at one scheme. |
| **`NotificationRule`** | `(event_type, channels, recipients, template, is_active, batch_window_seconds)`. One or more per event. |
| **`EmailTemplate`** | Subject + HTML body with a whitelisted flat context; Django templating, autoescape + bleach; absolute deep‑links. |
| **`InAppNotification`** | Per‑user in‑app row (read/unread); written synchronously in the emit txn. |
| **`NotificationOutbox`** | Durable email queue row: `channel`, `payload`, `status` (queued/sent/dead), `attempts`, `dedupe_key` (unique), timestamps. |

## 3. Recipient Resolution

Resolvers map a rule's recipient spec to concrete users:
`requestor`, `assignee`, `group_members`, `group_lead`, `watchers`, `role`, `specific_users`, `mentioned`.

Then two policies apply **by default**:
- **Dedupe by user id** — a user targeted by several resolvers is notified once.
- **Suppress the actor** — the person who caused the event isn't notified of their own action (overridable per rule).

## 4. Rendering
- Context is a **whitelisted flat dict** (ticket number, summary, status, assignee, links, actor, …) — no arbitrary model access in templates.
- Django templating with **autoescape on**, then `bleach` on the HTML body.
- Deep‑links are **absolute**, built from `FRONTEND_BASE_URL` (e.g. `…/tickets/INC-1042`).

## 5. Delivery — Transactional Outbox + Scheduled Flusher

Chosen over inline `send_mail` for **at‑least‑once delivery, restart‑survival, and decoupling from SMTP latency**.

1. On emit (in the request's commit): write `InAppNotification` rows + insert `NotificationOutbox` rows (`status=queued`) for email — all in the same transaction as the in‑app write.
2. `notifications.outbox_flush` (scheduler, ~30 s):
   - Claims `queued` rows with `select_for_update(skip_locked=True)` so multiple workers don't double‑claim.
   - Sends via a **channel registry**: `email` (Django backend: console in dev, SMTP in prod), `in_app` (already written); `webhook` / `slack` are **future stubs**.
   - **Exponential backoff** on failure (`attempts += 1`); marks `dead` after max attempts.
   - `dedupe_key` **unique index** prevents double‑send even under retries/races.
3. `notifications.outbox_reaper` resets rows stuck "in‑flight" past a timeout.

Both jobs run under one `DjangoJobStore` with `max_instances=1, coalesce=True, misfire_grace_time=60`, gated by `RUN_SCHEDULER`.

## 6. In‑App Inbox (API)

| Endpoint | Purpose | Module |
|---|---|---|
| `GET /notifications` | List the caller's in‑app notifications. | `itsm.notifications.inbox` |
| `POST /notifications/{id}/read` | Mark one read. | `itsm.notifications.inbox` |
| `POST /notifications/mark-all-read` | Mark all read. | `itsm.notifications.inbox` |
| `GET /notifications/unread-count` | Badge count for the bell. | `itsm.notifications.inbox` |

The frontend **NotificationBell** polls `unread-count` and opens an inbox popover.

## 7. Dedupe / Retry / Idempotency Summary
| Concern | Mechanism |
|---|---|
| Two resolvers hit one user | dedupe by user id before send |
| Actor self‑notify | suppress actor by default |
| Double‑claim by workers | `select_for_update(skip_locked=True)` |
| Double‑send on retry/race | `dedupe_key` unique index |
| Transient SMTP failure | exponential backoff, then `dead` |
| Stuck rows | reaper resets to `queued` |
| Rolled‑back write | emit happens on commit only |
| Engine error | logged + swallowed, never breaks caller |

## 8. Storm Control (built, default off)
A `batch_window_seconds` hook + digest job exists for future noise‑reduction (collapse N events into one digest). **Defaulted off** for MVP‑1; digests are a deferred feature (see `MVP_VS_FUTURE.md`).

## 9. Default Notifications (seed)
The seed wires a default scheme with rules such as:
- **Assigned** → notify assignee (in‑app + email).
- **CommentAdded** (public) → notify requestor + watchers.
- **CommentAddedPrivate** → notify assignee + group members (never the requestor).
- **StatusChanged / Resolved / Closed** → notify requestor + watchers.
- **Mentioned** → notify the mentioned users.
- **SLAWarning / SLABreach** → notify assignee + group lead (escalation path).

## 10. Channels
| Channel | MVP‑1 | Notes |
|---|---|---|
| `in_app` | ✅ | written synchronously; powers the bell/inbox. |
| `email` | ✅ | console (dev) / SMTP (prod) via the outbox flusher. Now **BIDIRECTIONAL + threaded**: the flusher sends via `EmailMultiAlternatives` and the `email_thread_headers` hook stamps `Message-ID`/`In-Reply-To`/`References` + a plus-addressed `Reply-To`, so customer replies thread back into the ticket as comments. Byte-identical when no channel exists. See `EMAIL_CHANNEL.md`. |
| `webhook` | stub | registry slot reserved; deferred. |
| `slack` | stub | registry slot reserved; deferred. |
