# itsm-automation: User Flows

## Admin: create the "Move to Assigned" rule
1. Open **Project settings → Automation** (`?tab=automation`).
2. Click **Use template** (or the empty-state button). The dialog opens pre-filled:
   - **When:** Ticket created + Assignee updated.
   - **If:** Status = New and Assignee is not empty.
   - **Then:** Assign (New → Assigned), with **Keep the current assignee** ticked.
3. Click **Create rule**. This sends `POST automation-rules/`.

Editing needs `itsm.projects:update`. Anyone with read access sees the list and runs read-only, with a banner.

## Agent: the rule in action
1. Open a **New** ticket and pick an Assigned Technician inline. This sends `PATCH tickets/{id}/`.
2. The response comes back with **Status = Assigned**. A toast says "Automation moved this ticket to Assigned", and the transition buttons and comments reload.
3. **Activity** shows "Automation ran an automation rule · Move to Assigned… — Assign → Assigned", plus the normal status-change row by Automation.

## Admin: why didn't it run?
Open the rule's history icon (**Recent runs**):
- **No row:** the trigger or the conditions didn't match. Changes made by automation itself never trigger rules.
- **skipped:** the action had nothing to do (already in the target status, wrong from-status, or a different workflow).
- **failed:** the message says why (e.g. "Transition “Assign” was blocked: <field-condition message>"). The rule's actions were rolled back.

## Edge cases
- A ticket already In Progress gets a new assignee: there's no run, because the Status = New condition fails.
- A pending approval: the transition fails with the approval-freeze message, and the ticket is unchanged.
- Rules are ordered with the arrows. **Stop after this rule** skips the rules below once it runs successfully.
- Deleting a rule asks for confirmation, then soft-deletes it.
