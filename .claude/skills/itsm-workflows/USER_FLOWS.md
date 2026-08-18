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

## Flow C2 — Supervisor excludes a state from SLA (Hold)
1. Project Settings → **Workflow** tab. Add a status (e.g. "Hold") with the **Exclude from SLA**
   checkbox ticked, **or** click the settings (⚙) icon on an existing status row and toggle
   **Exclude from SLA calculation** in the Status settings dialog (`PATCH statuses/{id}` `pauses_sla`).
2. Excluded statuses show an amber **`SLA paused`** badge. When a ticket enters one, all its running
   SLA clocks pause (first_response + resolution) and resume on leaving — see itsm-sla.

## Flow C3 — Supervisor creates & links a workflow from scratch (2026-07-13)
1. A project with no workflow shows the **Workflow** tab empty state with a **Create workflow**
   button (visible when the user has both `itsm.workflows:update` and `itsm.projects:update`).
2. Click it → dialog (name, prefilled `<Project> Workflow`) → `POST /workflows/create_starter/`
   builds a valid **To Do → In Progress → Done** starter (+ create transition).
3. The client then `PATCH /projects/{id}/ {default_workflow}` to link it and refreshes the
   workspace; the Workflow tab re-renders into the new graph, ready to edit (add statuses/
   transitions as in Flow C).
4. Alternative entry: **Overview** tab → **+ New** beside the Default-workflow dropdown creates the
   same starter, selects it in the dropdown; **Save changes** persists the link.

## Flow D — Reopen
1. From a Resolved ticket, the Reopen transition (Done → In Progress) is available within the
   reopen window.
2. Engine detects Done→not-Done, increments `reopen_count`, clears resolution, logs `reopened`,
   and (via PFs) can restart the SLA clock.
