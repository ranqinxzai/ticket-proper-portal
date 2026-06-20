# itsm-workflows — User Flows

## Flow A — Agent transitions a ticket
1. Ticket detail loads action buttons from `GET tickets/{id}/available-transitions/`.
2. Agent clicks "Resolve". If the transition has a screen, a modal collects mandatory fields
   (e.g. resolution).
3. `POST tickets/{id}/transition/` `{ transition_id, fields:{resolution:"Fixed"},
   comment, comment_visibility }`.
4. Engine: locks ticket → checks conditions → validates fields → sets status Resolved →
   runs PFs (`set_resolution`, `stamp_timestamp resolved_at`, deferred `stop_sla`) → saves →
   on commit logs `status_changed`, stops the SLA clock, emits `StatusChanged`, and (if a comment
   was supplied) adds it.
5. 200 returns the updated ticket; History tab shows the change.

## Flow B — Stale button
1. Two agents open the same ticket. A transitions it first.
2. B clicks an action whose `from_status` no longer matches → engine returns **409**.
3. Frontend refetches available transitions and shows the new options.

## Flow C — Supervisor builds a workflow (visual)
1. Open `admin/.../workflows/[id]` → `GET workflows/{id}/graph` renders nodes (statuses) + edges
   (transitions) at their `canvas_x/y`.
2. Drag a status, draw an edge, attach conditions / post-functions / a screen in the inspector;
   each change persists via `statuses`/`transitions` writes.
3. Click Validate → `POST workflows/{id}/validate` → fix any errors (single initial, a create
   transition, ≥1 Done) before publish.
4. Publish bumps `version` (copy-on-publish) so in-flight tickets keep their snapshot.

## Flow D — Reopen
1. From a Resolved ticket, the Reopen transition (Done → In Progress) is available within the
   reopen window.
2. Engine detects Done→not-Done, increments `reopen_count`, clears resolution, logs `reopened`,
   and (via PFs) can restart the SLA clock.
