# itsm-projects — User Flows

## Flow A — Browsing projects
1. Agent opens the Projects nav → `GET projects` (read allowed for agents).
2. Picks INC → `projects/[projectKey]` overview; the queue and create-wizard scope to that project.

## Flow B — Supervisor creates a new project
1. `POST projects` `{ name, key:"NET", project_type:"incident", default_workflow, default_group }`.
2. `key` is validated (uppercase, 2–10) and must be unique.
3. Supervisor adds `ticket-types` for it (`POST ticket-types` `{ project, name, key, base_category,
   is_default }`).
4. Project is now usable: opening a ticket auto-numbers `NET-1` and starts the default workflow.

## Flow C — Configuring a project (config hub)
1. Supervisor opens `admin/projects/[projectKey]/...`.
2. From there, jumps to fields/layouts (itsm-fields), workflows (itsm-workflows), SLAs (itsm-sla),
   notifications (itsm-notifications), groups (itsm-groups), canned notes, templates — each a
   separate module that scopes to this project.

## Flow D — Seeded bootstrap
`seed_itsm` creates INC + REQ with default workflow/group + starter ticket types, so the product is
immediately demoable after migrate + seed.
