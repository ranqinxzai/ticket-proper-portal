# itsm-assets: User Flows

## Admin: set up asset configuration (once per helpdesk)
1. Sidebar **Configuration → Asset Configuration → Categories & Fields** (or **Configure** on any Assets page).
2. Empty helpdesk → **Load IT starter set**: Computer (Laptop, Desktop, Workstation), Server (Physical Server, Virtual Machine), Printer (Laser, Inkjet, Multifunction), Network Device (Switch, Router, Firewall, Access Point), Monitor, Mobile Device (Phone, Tablet), each with its detail fields (Serial Number, Service Tag, OS, RAM, Hostname, IP Address, …). Running it again adds nothing.
3. Select a category or sub-category → its fields: inherited ones ("from Computer", read-only) and its own (Required switch, reorder, unlink). **Add field** picks one from the helpdesk's library or creates a new one (text, number, date, checkbox, dropdown, multi-select).
4. **Statuses** (shared by all helpdesks): rename, add (each needs a state type), pick the default and the Expired target.
5. **Vendors / Locations / Departments** (shared): add, edit, deactivate. A record used by assets can't be deleted.

## Agent: add an asset
1. **Assets → Asset List → New asset**.
2. **General**: Asset Name, Asset Tag (blank = next `<HD>-AST-00001`), Category, Sub-category, Vendor, Status (defaults to In Stock).
3. **Location**, **Allotment** (User, Department, Notes), **Purchase** (Purchase Date, Purchase Cost, Expiry Date, Warranty Expiry Date).
4. **Details** shows the chosen category's fields (a Server shows Hostname / IP Address, a Printer shows Toner Model…). Required ones are marked.
5. Save. Errors appear under the fields; the API is the source of truth:
   - "“In Use” needs a User or a Department."
   - "The expiry date (…) has passed, so the status can't be “In Stock”…" — pick Expired or change the date.
   - "This field is required." on a detail field.

## Agent: find and update assets
- **Asset List**: search (tag, name, user, serial or any text detail), filters (category, sub-category, status, state type, location, department, vendor, warranty), sortable columns. The URL keeps the filters, so a link opens the same view.
- **Asset Dashboard** tiles and bars open the list pre-filtered (e.g. "Warranty ends in 30 days").
- Open an asset → edit any section → Save. Changing the category asks to confirm when detail values would be removed. **History** shows who changed what (old → new), imports, and "Marked Expired" by System.

## Admin / Supervisor: import from Excel
1. **Asset List → Import → Download template** (per helpdesk: Instructions, Assets with drop-downs, Lists, Fields by category).
2. Fill one asset per row; save as .xlsx; choose the file.
3. **Check only** (nothing saved) or **Import**. Optionally tick **Create missing vendors, locations and departments** (needs Asset Configuration → Create).
4. Result: "120 created · 7 failed". Good rows are saved; failed rows stay on **Import history → <file>** with "Row N — Column: message".
5. **Download failed rows** → fix in Excel → upload that file again (its Errors column is ignored). **View imported assets** opens the list filtered to that import.

## Anyone with Assets read: report
**Asset Report**: same filters as the list + **Group by** (category, sub-category, status, state type, location, department, vendor, user) → count, %, total purchase cost, chart, and the rows. **Export to Excel** → Summary + Assets sheets (every column incl. detail fields).

## System: hourly expiry
Once an hour (at :05 UTC), each org's active assets (Available / In use / Maintenance types) whose Expiry Date is before today (org's default calendar time zone) move to the Expired status. History: "Marked Expired — Expiry date … has passed." To keep using such an asset, change its Expiry Date.

## Edge cases
- Another helpdesk's asset → 404; its categories never appear in the pickers.
- A deactivated vendor/location/department/category stays on existing assets but can't be picked for new ones.
- Deactivating a detail field hides it (values kept); deleting it unlinks it everywhere (values kept, hidden).
- Deleting an asset frees its tag for reuse.
- Requestors have no Assets section and the API returns 403.

## Agent: link assets to a ticket (phase 2, 2026-10-23)
1. **New ticket** in a project whose layout shows the **Asset** field (on by default where the helpdesk has asset categories; otherwise Project settings → Layout → un-hide Asset).
2. Pick the **Requestor**: their active assets appear under "Requestor's assets"; if they have exactly one it is linked automatically (until you change the field yourself).
3. **Find another asset** opens a search with Category, State, Location, Department and Assigned-to filters (including "Not allotted"). Click results to add; the first asset is **Primary** (☆ makes another one primary; × unlinks).
4. On the ticket, the Asset field edits the same way; Activity records "linked / unlinked an asset" and "made … the primary asset".
5. The asset page's **Tickets** card lists every ticket linked to it (open first) and History shows "Linked to a ticket".

## Requestor: portal
The portal request form shows the requestor's own active assets as checkboxes (only when the layout's Asset field is Portal-visible and they own at least one). The request page shows the linked assets read-only.

