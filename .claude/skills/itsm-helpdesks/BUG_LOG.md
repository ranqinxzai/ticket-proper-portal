# itsm-helpdesks — Bug Log / Gotchas

- **"pending trigger events" Postgres error when adding `Project.helpdesk`.** Deleting the old
  global INC/REQ projects (RunPython) **and** running `ALTER TABLE` (AddField/constraint) in one
  migration fails: Postgres can't ALTER a table with pending FK-trigger events from the just-issued
  DELETEs. **Fix: split into two migrations** — `0002_drop_legacy_global_projects` (the RunPython
  that drops old globals + their PROTECTed dependents, so the DELETEs commit) then
  `0003_project_helpdesk_field` (AddField + index + constraint). Recorded as a general gotcha.
- **`None` means "unrestricted", not "no access".** `accessible_helpdesk_ids` returns `None` for
  superusers and `[]` for a member of nothing. Any caller that treats `None` as an empty set will
  hide everything from superusers. Always branch `if accessible is not None:` before filtering, and
  use `scope_ticket_queryset` (which no-ops on `None`).
- **Scoping must live in shared services, not one viewset.** Row-level scope was originally only on
  `TicketViewSet.get_queryset`, which **leaked** through saved-filter results, widget data,
  bulk-by-filter, reports, and the SLA tracker. All 8 surfaces had to thread
  `accessible_helpdesk_ids` themselves (see INTERLINKING). Treat any new ticket-reading surface as a
  leak until it's clamped.
- **The bulk endpoint has two branches.** `_bulk` by **ids** must clamp `project__helpdesk_id__in`
  separately from the by-**filter** branch (which goes through `query_builder`). Forgetting the ids
  branch lets an agent mutate a foreign ticket by guessing its id.
- **`?helpdesk=` never widens and never 403s.** It's advisory. A foreign/unknown value is silently
  ignored and scope falls back to the accessible set. Don't add a 403 here — write guards (403) are
  separate and live on create/links/apply_template, not on this param.
- **Retire via `status='archived'`, never soft delete.** `BaseModel.soft_delete()` doesn't cascade,
  so soft-deleting a helpdesk would orphan its projects/tickets. Archived is what
  `accessible_helpdesk_ids` excludes (it filters `helpdesk__status="active"`).
- **`key` is write-once in spirit.** It prefixes every project key (`<key>INC`) and thus every
  ticket number. There's no rename migration; changing it after tickets exist desyncs old
  `ticket_number`s. Keep it ≤ 5 chars so `<key>INC` stays inside `Project.KEY_VALIDATOR`.
- **Broken Notification frontend contract (pre-existing, was silently dead).** The bell badge +
  attention panel needed the API↔UI field names fixed: `read`→`is_read`, `message`/`body`→
  `body_text`, `{count}`→`{unread}`. Until fixed, the unread badge never rendered. Recorded so the
  Home attention panel's unread-notifications source is trusted.
- **`remove_member` is a soft remove.** It sets `is_active=False`, it does not delete the row;
  `add_member` re-activates the same row via `update_or_create`. Don't expect the membership to vanish.
