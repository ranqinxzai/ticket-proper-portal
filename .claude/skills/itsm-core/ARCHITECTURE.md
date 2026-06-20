# itsm-core — Architecture

## Layout
```
itsm_core/
  models/
    base.py     # UUIDModel, TimeStampedModel, SoftDeleteModel, BaseModel
    audit.py    # AuditEvent
    fields.py   # FieldDefinition/Option/Value/Layout/LayoutItem (see itsm-fields)
    __init__.py # re-exports
  services/
    audit.py    # log_event()
    html.py     # sanitize_html(), html_to_text()
    hooks.py    # sla_start_for_ticket / sla_on_status_change / sla_pause|resume|stop / emit_event
    __init__.py # re-exports
  management/commands/seed_itsm.py
```
No `views.py` / `urls.py` / `serializers.py` — core is a library.

## Design decisions
- **UUID PKs as external identifiers.** `UUIDModel` gives every entity a `uuid4` PK so URLs,
  webhooks and email deep-links don't leak row counts.
- **Three composable mixins → one `BaseModel`.** Timestamps and soft delete are separate
  abstract mixins so a model can opt into a subset (e.g. `AuditEvent` uses only `UUIDModel`
  because it is append-only and must never be soft-deleted or "updated").
- **Soft delete via a custom manager.** `objects` returns `.alive()` only; `all_objects` is the
  raw manager. `perform_destroy` in the RBAC base ViewSet routes DELETE → `soft_delete`.
- **Audit by explicit call, not signals.** `log_event` is the single write site. Rationale:
  greppable ("who writes audit rows?" → grep `log_event`), and the call site can pass the
  *previous* value into `payload` (impossible from `post_save`). `AuditEvent.created_at` is the
  only timestamp; it has no `updated_at` and isn't soft-deletable — it's an immutable ledger.
- **Sanitize-on-save with a plain mirror.** Rich bodies are sanitized and a `*_text` plain
  mirror is stored for search + notification previews. The allow-list explicitly permits
  `@mention` span attributes (`data-type/data-id/data-label`) so Tiptap mentions survive.
- **Hook seam decouples the domain from the engines.** `hooks.py` is the only place that knows
  SLA/notifications might exist. Each hook does a lazy import inside a `_safe()` wrapper that
  no-ops on `ImportError`/`AttributeError` and logs-and-swallows anything else. This is why the
  ticket vertical slice works before the SLA and notification engines are built.
- **Idempotent, dependency-ordered seeding.** `seed_itsm` imports each step's module by string
  and skips it (with a notice) if it's missing — so the same command works at every milestone.
  Each `run()` is wrapped in its own `transaction.atomic()`.
