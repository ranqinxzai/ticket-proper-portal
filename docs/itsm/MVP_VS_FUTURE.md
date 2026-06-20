# MVP‑1 Scope vs Future — ITSM Platform

What ships in MVP‑1 (agent experience), and what is deliberately deferred — with the **reserved hooks** already in the code so the deferred work bolts on without rework.

---

## 1. In Scope (MVP‑1)

The full **agent experience** across the 13 modules:

| Area | In MVP‑1 |
|---|---|
| **Tickets** | Create (auto‑numbered `KEY‑N`), queue/list with filter/search/order, 2‑pane detail, inline edits, assign, transition, public + internal comments, watchers, links, attachments, activity feed. |
| **Projects & types** | Incident + Request projects seeded; ticket‑type scheme; default workflow/group per project. |
| **Groups & routing** | Groups, memberships (member/lead), round‑robin cursor, create‑time `RoutingRule`s. |
| **Workflows** | Visual builder (React Flow), statuses/transitions, conditions, validators, post‑functions, auto‑assign strategies, reopen, graph validation, copy‑on‑publish versioning, 2 seeded workflows. |
| **Custom fields** | Typed field engine bound to `(project, ticket_type)` + Layout Designer + dynamic forms. |
| **SLA** | Business calendars + holidays, first‑response & resolution metrics, pause/resume, breach sweep, escalations (notify/reassign/raise_priority), countdown widgets. |
| **Notifications** | Per‑project schemes/rules, recipient resolvers, email templates, in‑app inbox, durable outbox + flusher. Channels: in‑app + email. |
| **Email Channel** | Bidirectional email (shipped): inbound IMAP/POP polling → ticket/comment via `ticket_service`; Google + Microsoft 365 OAuth2 (XOAUTH2) + basic auth; Fernet‑encrypted credentials; threaded outbound (Message‑ID/In‑Reply‑To/References + plus‑addressed Reply‑To); JSM‑parity guards (idempotency, allow/block, auto‑reply/loop, caps); durable inbound log + retry. See `EMAIL_CHANNEL.md`. |
| **Canned notes & templates** | Reusable comment snippets; ticket templates (prefill + apply). |
| **Reports** | SLA compliance, agent performance, volume/trend, distribution, group workload (chart‑ready JSON + CSV). |
| **Dashboards** | SavedFilter‑driven widgets, drag‑grid builder, sharing. |
| **RBAC & auth** | JWT, module RBAC, Agent + Supervisor roles, roles & permissions admin. |
| **Auditability** | Append‑only activity feed via explicit `log_event`. |

## 2. Deferred (Future)

| Deferred capability | Why deferred | Reserved hook in code today |
|---|---|---|
| **End‑User / Self‑Service Portal** | MVP‑1 is agent‑experience first. | `Ticket.requestor` FK; `Source.PORTAL` enum value; comment `visibility=public` already separates customer‑visible content. |
| **Knowledge Base** | Not needed for the agent loop. | — (new app later). |
| **Problem / Change / Release management** | Heavier ITIL practices beyond Incident + Request. | `TicketLink` types (`causes`/`caused_by`) + workflow engine generalize to other practices. |
| **Asset / CMDB** | Out of the agent‑ticketing core. | — (new app later). |
| **Approvals (beyond a workflow condition)** | A dedicated approval entity is out of scope. | Workflow `TransitionCondition` (`role_in`, etc.) covers simple gating now. |
| **CSAT surveys** | Post‑resolution feedback loop. | `resolved_at` / `closed_at` timestamps available as triggers later. |
| **Multi‑org tenancy** | Single org for v1. | `SystemRole.org` nullable UUID **reserved**; nullable org hook noted in the plan. |
| **Webhook / Slack delivery** | Email + in‑app suffice for MVP. | Notification **channel registry** has `webhook` / `slack` **stubs**. |
| **Notification digests / storm control** | Default off. | `NotificationRule.batch_window_seconds` + digest job **built but defaulted off**. |
| **Per‑channel OAuth SMTP send** | Outbound goes through the existing notification backend (console/SMTP); sending *as* each connected mailbox over OAuth is deferred. | OAuth tokens already stored per `EmailChannel`; the outbox is the single send choke‑point. |
| **Inbound webhook ingest (SendGrid / Mailgun)** | Polling (IMAP/POP) covers MVP; push‑based ingest is a later optimization. | the ingest pipeline (guards → `create_ticket`/`add_comment` → `InboundEmail`) is transport‑agnostic — a webhook view can feed the same path. |
| **Shared‑mailbox digests** | Per‑mailbox summary roll‑ups are out of scope. | `InboundEmail` rows + `EmailChannel` scoping provide the data for a future digest job. |
| **AI features** | Not in MVP scope. | — (future). |

## 3. Guardrails that keep deferral cheap
- **UUID PKs + shared `BaseModel`** — new apps slot in uniformly.
- **One choke‑point per concern** — adding a practice/channel means extending a registry, not rewriting call sites.
- **Config snapshots on the ticket** — workflow chosen at create time, so introducing new workflows/versions never strands existing tickets.
- **No signals; explicit `log_event`** — new events are explicit, greppable additions.
- **Hooks no‑op if engine absent** — the domain already runs at every milestone, so engines (and future practices) attach incrementally.

## 4. Explicitly Out for MVP‑1 (summary line)
End‑User Portal · Knowledge Base · Problem/Change/CMDB · approvals beyond a workflow condition · CSAT · multi‑org tenancy (hook only) · webhook/Slack channels (stub) · notification digests (hook only) · per‑channel OAuth SMTP send · inbound webhook ingest (SendGrid/Mailgun) · shared‑mailbox digests · AI.
