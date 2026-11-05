/**
 * Help Center content (agents + helpdesk admins), rendered by
 * `components/help/help-center.tsx`. Plain data so the page can search it.
 *
 * Inline markup: `**UI label**` renders bold — use it for exact on-screen labels.
 * Keep copy in sync with the UI: when a button, tab or message is renamed, grep
 * this file for the old label. Article `id`s are deep-link anchors
 * (`/agent/help#<id>`) — don't rename them casually.
 */

export type HelpAudience = "agent" | "admin";

export type HelpBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "tip"; text: string }
  | { kind: "note"; text: string };

export interface HelpSection {
  id: string;
  title: string;
  description: string;
}

export interface HelpArticle {
  id: string;
  section: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  keywords?: string[];
  blocks: HelpBlock[];
}

export interface HelpFaq {
  id: string;
  audience: HelpAudience;
  q: string;
  a: string;
}

export const HELP_SECTIONS: HelpSection[] = [
  { id: "start", title: "Getting started", description: "Sign in, find your helpdesk and set up your workspace." },
  { id: "tickets", title: "Working tickets", description: "Find, create, update and resolve tickets." },
  { id: "sla", title: "SLA & approvals", description: "Service-level timers and approval sign-off." },
  { id: "insights", title: "Dashboard & reports", description: "Track performance and export data." },
  { id: "kb", title: "Knowledge base", description: "Write and publish help articles." },
  { id: "email", title: "Email & notifications", description: "How email becomes tickets, and who gets told what." },
  { id: "admin-access", title: "Admin: users & access", description: "People, roles, sign-in and branding (Tenant Settings)." },
  { id: "admin-helpdesk", title: "Admin: helpdesk setup", description: "Helpdesks, calendars, groups and shared libraries." },
  { id: "admin-projects", title: "Admin: projects & workflows", description: "Projects, workflows, fields, SLA, routing, automation and notifications." },
  { id: "admin-email", title: "Admin: email", description: "Mailboxes, keyword routing, the notification sender and the email log." },
  { id: "assets", title: "Assets", description: "Track IT assets: the asset list, Excel import, categories, statuses and masters." },
];

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ─────────────────────────────────────────────────────────
  {
    id: "sign-in",
    section: "start",
    audience: "agent",
    title: "Sign in and find your helpdesk",
    summary: "Log in, pick a helpdesk and get around the sidebar.",
    keywords: ["login", "log in", "microsoft", "sso", "workspace", "switch", "sidebar", "navigation"],
    blocks: [
      { kind: "h", text: "Sign in" },
      {
        kind: "steps",
        items: [
          "Open your organisation's sign-in page.",
          "Enter your **Username or email** and **Password**, then click **Sign in**.",
          "If your organisation uses Microsoft accounts, click **Sign in with Microsoft** instead.",
        ],
      },
      { kind: "tip", text: "Forgot your password? Click **Forgot password?** on the sign-in page and enter your username or email. We email you a link that works for 60 minutes, once. Microsoft sign-in accounts change their password through Microsoft instead." },
      { kind: "h", text: "Choose a helpdesk" },
      {
        kind: "p",
        text: "After you sign in you land on **Home**, which has a **Select Helpdesk** card for each helpdesk you belong to. Click one to open it. You'll go to the **Dashboard** if your role can see it, otherwise to **All Tickets**.",
      },
      {
        kind: "p",
        text: "To switch helpdesks later, use the grid icon at the top left (**Switch helpdesk, or go to Home**).",
      },
      { kind: "note", text: "If Home says you are not a member of any helpdesk yet, ask a supervisor to add you." },
      { kind: "h", text: "The sidebar" },
      {
        kind: "list",
        items: [
          "**Dashboard**: KPIs and charts (if your role allows it).",
          "**All Tickets**: every ticket in the helpdesk, across projects.",
          "**Projects**: one queue per project (for example Incidents and Requests).",
          "**Reports**: under Insights (if your role allows it).",
          "**Configuration**: helpdesk settings (admins only).",
        ],
      },
      {
        kind: "p",
        text: "**Collapse** shrinks the sidebar to icons and **Expand sidebar** brings it back. On a phone, tap the menu button (**Open navigation**). The top bar holds **Create** (new ticket), the Approvals inbox, the Notifications bell and your account menu.",
      },
    ],
  },
  {
    id: "account-menu",
    section: "start",
    audience: "agent",
    title: "Theme, density and your password",
    summary: "Personalise how OneDesk looks and change your password.",
    keywords: ["dark mode", "light", "compact", "comfortable", "password", "sign out", "logout", "profile"],
    blocks: [
      { kind: "p", text: "Click your initials at the top right to open the account menu." },
      {
        kind: "list",
        items: [
          "**Theme**: Light, Dark or System.",
          "**Density**: **Compact** (the default) fits more rows on screen and **Comfortable** adds breathing room. It's saved in this browser.",
          "**Help Center**: opens this page.",
          "**Change password**: enter your current password, then the new one twice (at least 8 characters).",
          "**Sign out**.",
        ],
      },
      {
        kind: "note",
        text: "If you sign in with Microsoft, **Change password** isn't shown. Change it through your Microsoft account instead.",
      },
    ],
  },

  // ── Working tickets ─────────────────────────────────────────────────────────
  {
    id: "queue",
    section: "tickets",
    audience: "agent",
    title: "Find tickets: queues, views and filters",
    summary: "Search, filter, sort, pick columns and save views.",
    keywords: ["queue", "filter", "search", "sort", "columns", "saved view", "default view", "unassigned", "overdue"],
    blocks: [
      {
        kind: "p",
        text: "Open a project from the sidebar to see its queue, or open **All Tickets** for every project in the helpdesk (that view adds a **Project** column).",
      },
      { kind: "h", text: "Views" },
      {
        kind: "p",
        text: "The left-most chip is the view menu. **Default views** include All tickets, Open, Unassigned, My open tickets, Resolved / Closed, Due today, Overdue, Created this week and Recently updated. **Helpdesk filters** are views shared with everyone in this helpdesk, **Project filters** are views shared with the project, and **My filters** are your own. A view you save shows only in the queue you saved it from (that project, or this helpdesk's All Tickets); a view shared from All Tickets reaches everyone in this helpdesk, in All Tickets and in each project queue. Star a view to make it your default: it opens automatically when you come back. Click the star again to clear it.",
      },
      { kind: "h", text: "Filter and search" },
      {
        kind: "steps",
        items: [
          "Use the chips (**Status**, **Assignee**, **Priority**, **Type**, **Created**) to narrow the list.",
          "Click **Fields** to filter on any other field, custom fields included.",
          "Type in the search box to find tickets by number (ITINC42, #42 or ITINC-42), or by words in the summary, description or comments (internal notes only if you can read them). Typos and word endings are forgiven, and the best matches come first unless you sort by a column. Search combines with your filters.",
          "Click **Save view**, give it a **Name** and choose **Only me** or **Share with project** (**Share with helpdesk** in All Tickets). Deleting a view asks you to confirm.",
          "**Clear all** resets filters and sorting but keeps your search text.",
        ],
      },
      { kind: "h", text: "Sort and columns" },
      {
        kind: "list",
        items: [
          "Click a column header to sort ascending, again for descending, and a third time to go back to newest first. Priority sorts by severity and Status by workflow order. SLA columns can't be sorted.",
          "Click **Columns** to show, hide or reorder columns. **Reset** restores the defaults.",
          "Lists show 25 tickets per page, and **Showing X–Y of N** sits beside the title.",
          "When new activity arrives, a pill such as **N new tickets · Refresh** appears. Click it to update the list.",
        ],
      },
      {
        kind: "tip",
        text: "Column layouts in a project queue are saved to your account. In **All Tickets** they're saved in this browser only.",
      },
    ],
  },
  {
    id: "create-ticket",
    section: "tickets",
    audience: "agent",
    title: "Create a ticket",
    summary: "Log a ticket on someone's behalf, with priority, category and attachments.",
    keywords: ["new ticket", "create", "requestor", "priority", "impact", "urgency", "category", "attachment", "p1", "p2", "p3", "p4"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Click **Create** in the top bar and choose a project, or click **New ticket** in a project queue.",
          "Enter a **Summary** (a short, specific title) and a **Description**.",
          "Pick the **Requestor**: search people by name.",
          "Set **Priority**: P1 Critical, P2 High, P3 Medium or P4 Low.",
          "Optionally choose an **Assigned Group** and then an **Assignee**. Leave both empty to let the project's routing rules decide.",
          "Choose a **Category**, then a **Sub-category** if offered.",
          "Add screenshots, logs or documents under attachments (choose files or drop them in).",
          "Click **Create ticket**. You're taken to the new ticket.",
        ],
      },
      {
        kind: "tip",
        text: "When the form has both **Impact** and **Urgency**, priority is calculated from them and marked **Auto**. You can still change it by hand.",
      },
      {
        kind: "p",
        text: "Ticket numbers are the project key followed by a number, for example **ITINC12**. Which fields appear, and where, depends on how your admin set up the project. Some fields can lock based on others (for example \"Locked because Impact is High\").",
      },
    ],
  },
  {
    id: "status",
    section: "tickets",
    audience: "agent",
    title: "Move a ticket through its workflow",
    summary: "Use the workflow buttons to assign, hold, resolve, close or reopen.",
    keywords: ["status", "transition", "resolve", "close", "reopen", "on hold", "workflow", "fulfil", "resolution note", "blocked"],
    blocks: [
      {
        kind: "p",
        text: "The buttons at the top of a ticket are the next steps in its workflow. In a typical Incident project they are **Assign**, **Start Progress**, **Put on Hold**, **Resume**, **Resolve**, **Close** and **Reopen**. Request projects use **Approve**, **Start Fulfilment**, **Fulfil**, **Close** and **Reopen**. Your admin can rename or add steps.",
      },
      { kind: "h", text: "Steps that ask for details" },
      {
        kind: "list",
        items: [
          "**Resolve** / **Fulfil**: a required **Resolution Note**, plus resolution details such as resolution code, root cause and workaround.",
          "**Put on Hold**: a required reason to hold.",
          "**Reopen**: an optional reason to reopen.",
          "**Record Known Error** (Problem projects): a root cause.",
        ],
      },
      {
        kind: "p",
        text: "Fill in the panel and submit. A message confirms **Moved to \"<status>\"**. The submit button stays disabled until the required fields are filled.",
      },
      { kind: "h", text: "When a step is blocked" },
      {
        kind: "list",
        items: [
          "Your admin can require a field before a step is allowed (for example, an assignee before **Assign**). Clicking the button then shows a message that explains what's missing.",
          "**Awaiting approval** in place of the buttons means the ticket is waiting for sign-off. Status is locked until the approval is approved or rejected.",
          "\"Ticket has already moved; refresh and retry\" means someone else changed it first. Refresh the page.",
        ],
      },
    ],
  },
  {
    id: "assign",
    section: "tickets",
    audience: "agent",
    title: "Assign a ticket",
    summary: "Set the group and technician, or let round-robin pick.",
    keywords: ["assign", "assignee", "group", "technician", "round robin", "reassign", "team"],
    blocks: [
      {
        kind: "steps",
        items: [
          "On the ticket, set **Assigned Group** first.",
          "Then choose an **Assignee** from that group's members. Group leads appear first, marked **Lead**.",
          "Changes save when you leave the field or press Enter. Esc cancels.",
        ],
      },
      {
        kind: "p",
        text: "The workflow's **Assign** step (and **Start Fulfilment** / **Start Investigation**) can pick a technician for you, round-robin within the group, depending on how your admin configured it. It only does this when nobody is assigned yet: a technician already on the ticket is always kept.",
      },
      {
        kind: "note",
        text: "The assignee must be an active member of the assigned group. If you change the group, pick a new assignee from that group.",
      },
    ],
  },
  {
    id: "comments",
    section: "tickets",
    audience: "agent",
    title: "Reply to the requestor or add an internal note",
    summary: "Public comments vs. internal notes, attachments and images.",
    keywords: ["comment", "reply", "internal note", "private", "public", "attach", "image", "email requestor"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the **Comments** tab on the ticket and click **Add a comment…** (or **Internal note**).",
          "Choose **Public Comment** or **Internal Note**.",
          "Type your message. You can paste or drop images inline, or click **Attach files** (up to 10 MB per file).",
          "Click **Add comment** or **Add internal note**.",
        ],
      },
      {
        kind: "list",
        items: [
          "**Public Comment**: the requestor sees it in the portal and it's emailed to the requestor, watchers and assignee. Your first public reply stops the First response SLA clock.",
          "**Internal Note**: agents only. It's never emailed to the requestor and is left out of printouts.",
          "**@mentions**: type **@** and pick a colleague to notify them (in-app and email by default). Only agents who are members of this ticket's helpdesk can be mentioned, in public comments and internal notes alike; requestors can't be.",
        ],
      },
      { kind: "p", text: "The **Activity** tab shows the full history of changes on the ticket." },
      {
        kind: "note",
        text: "The ticket keeps itself up to date: when a colleague changes it, the page refreshes on its own while you aren't editing. If you're in the middle of an edit or a reply, an **Updated by … — Refresh** button appears instead, so nothing you're typing is lost. If you save a field that someone else changed after you opened the ticket, the save is refused (\"This ticket was changed by someone else — refreshed\"); check the latest values and re-apply your change.",
      },
    ],
  },
  {
    // components/ui/rich-text-editor.tsx (spellcheck while editable) + spellCheck on
    // summary / text fields / reasons; searches and code-like boxes are off (2026-11-05c).
    id: "spelling",
    section: "tickets",
    audience: "agent",
    title: "Spelling and grammar while you type",
    summary: "Your browser underlines misspelt words in comments, notes and text boxes; right-click for suggestions.",
    keywords: ["spelling", "spell check", "grammar", "typo", "autocorrect", "dictionary", "language", "edge", "chrome"],
    blocks: [
      {
        kind: "p",
        text: "While you write a comment, an internal note, a description, a transition note, a summary or another text box, your browser checks the spelling. A misspelt word gets a red underline.",
      },
      {
        kind: "steps",
        items: [
          "Right-click the underlined word.",
          "Pick a suggestion from the top of the menu, or choose **Add to dictionary** for a name or product word.",
        ],
      },
      {
        kind: "list",
        items: [
          "**Chrome**: Settings › Languages › Spell check must be on, with an English dictionary added (English (UK) or English (US)).",
          "**Microsoft Edge**: Settings › Languages › Writing assistance (Microsoft Editor) also suggests grammar and punctuation fixes.",
          "**Firefox**: checks multi-line boxes by default; for a one-line box, right-click › **Check Spelling**.",
        ],
      },
      {
        kind: "note",
        text: "The checking is done by your browser, so how it looks and which grammar fixes you get depend on it. Search boxes, keys, email settings and asset tags aren't checked, and read-only text never is.",
      },
    ],
  },
  {
    id: "canned",
    section: "tickets",
    audience: "agent",
    title: "Use canned responses",
    summary: "Insert a saved reply in a couple of clicks.",
    keywords: ["canned", "template", "saved reply", "macro", "snippet", "shortcut"],
    blocks: [
      {
        kind: "steps",
        items: [
          "In the reply box, click **Canned response**.",
          "Search by title or shortcut keyword in **Find a response…**.",
          "Click a response. It's inserted at your cursor, ready to edit before you send.",
        ],
      },
      {
        kind: "p",
        text: "The list shows this helpdesk's shared responses, organisation-wide ones and your personal ones, grouped as **Personal**, **Project**, **Helpdesk** and **Organisation**. The badge on each says who can see it. Admins manage them under **Configuration → Canned Responses**.",
      },
    ],
  },
  {
    id: "links-watchers",
    section: "tickets",
    audience: "agent",
    title: "Link tickets, watchers and attachments",
    summary: "Relate tickets to each other and keep colleagues in the loop.",
    keywords: ["link", "related", "duplicate", "blocks", "caused by", "watcher", "follow", "attachment", "download"],
    blocks: [
      { kind: "h", text: "Linked issues" },
      {
        kind: "steps",
        items: [
          "In the ticket's right-hand panel, click **+ Link** under **Linked issues**.",
          "Choose how this ticket relates: relates to, blocks, is blocked by, duplicates, is duplicated by, causes or is caused by.",
          "Search for the other ticket by number or words and select it. The other ticket shows the matching link automatically.",
          "Click the X on a link to remove it (you'll be asked to confirm).",
        ],
      },
      { kind: "h", text: "Watchers" },
      {
        kind: "p",
        text: "Use the watchers icon in the ticket header to **Watch** / **Unwatch**, or **Add a watcher…**. Watchers get updates on status changes and public comments, and are emailed when someone else adds them. Internal notes only reach watchers who are agents on this helpdesk. A watcher who isn't an agent here can open the request read-only in the portal.",
      },
      { kind: "h", text: "Attachments" },
      { kind: "p", text: "The attachments icon in the header lists every file on the ticket. You can **Add files**, download or delete from there." },
    ],
  },
  {
    id: "move-ticket",
    section: "tickets",
    audience: "agent",
    title: "Move a ticket to another project",
    summary: "Re-file a ticket logged in the wrong project.",
    keywords: ["move", "transfer", "wrong project", "convert", "incident to request", "renumber"],
    blocks: [
      {
        kind: "steps",
        items: [
          "On the ticket, open **More actions (⋮)** and choose **Move ticket**.",
          "Pick the destination project (only projects in the same helpdesk are offered).",
          "Map the ticket type, status and fields. Anything that doesn't fit can be set to **Don't move (drop value)**. Category is always chosen again.",
          "Confirm the move.",
        ],
      },
      {
        kind: "list",
        items: [
          "The ticket gets a **new number**. Links and emails with the old number still find it.",
          "SLA clocks carry on. If the move changes the priority, running clocks switch to that priority's target.",
          "A pending approval is cancelled, and the ticket starts at the new project's first status.",
          "Comments, attachments, watchers and links come along. The group and assignee reset if they aren't valid in the new project.",
        ],
      },
      { kind: "note", text: "Moving requires the **Move ticket** permission. If you don't see it, ask your admin." },
    ],
  },
  {
    id: "print",
    section: "tickets",
    audience: "agent",
    title: "Print a ticket",
    summary: "Produce a clean, branded printout or PDF.",
    keywords: ["print", "pdf", "export ticket"],
    blocks: [
      {
        kind: "p",
        text: "Open **More actions (⋮)** → **Print**. The printout carries your organisation's branding, the ticket fields, the requestor details and public comments. Internal notes are never printed. Choose **Save as PDF** in your browser's print dialog to get a file.",
      },
    ],
  },

  // ── SLA & approvals ─────────────────────────────────────────────────────────
  {
    id: "sla",
    section: "sla",
    audience: "agent",
    title: "Understand SLA timers",
    summary: "What the SLA bars mean and what starts, pauses and stops them.",
    keywords: ["sla", "breach", "overdue", "paused", "response time", "resolution time", "business hours", "timer"],
    blocks: [
      {
        kind: "p",
        text: "The **SLA** card on a ticket lists each target with its state: time left, overdue, **Paused**, **Met**, **Breached** or **Stopped**. In the queue each bar shows how much of the target has been used, in business hours: amber from 75%, red at 100% or once overdue.",
      },
      {
        kind: "list",
        items: [
          "**First response** stops at the first **public** reply. Internal notes don't count.",
          "**Resolution** stops when the ticket reaches a done status (Resolved / Closed).",
          "**Assignment** stops when a technician is assigned.",
          "Time counts business hours only, taken from the project's calendar.",
          "If the ticket's **priority** changes, running clocks switch to the new priority's target and keep the time already used. If the new priority has no target, that clock is removed.",
          "**Put on Hold** (and any status your admin excluded from SLA) pauses the clock until the ticket moves on.",
        ],
      },
      {
        kind: "tip",
        text: "Resolve within the Resolution SLA and you'll get a celebration, and the more time left, the bigger it is. Press Esc or **Dismiss** to close it.",
      },
    ],
  },
  {
    id: "approvals",
    section: "sla",
    audience: "agent",
    title: "Approve or reject requests",
    summary: "Sign off on requests waiting for you.",
    keywords: ["approve", "approval", "reject", "sign off", "pending", "awaiting approval", "approver"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Click the Approvals icon in the top bar (the number shows how many are waiting), or **Pending approvals** on Home.",
          "Each row shows the ticket, its summary and the approval stage (for example \"Manager (Level 1)\").",
          "Click **Approve**, or **Reject** and give a reason (required). You can also do this from the **Approvals** card at the top of the ticket, or click the ticket number to open it first.",
        ],
      },
      {
        kind: "list",
        items: [
          "Approving moves the request to the next approval level, or completes it at the last one.",
          "Rejecting ends the whole approval straight away. Your reason is kept in the approval history, and if the workflow has a **Rejected** status the ticket moves there. An approval an agent sent from the ticket goes back to the status it was sent from instead.",
          "While an approval is pending, nobody (admins included) can change the ticket's status.",
        ],
      },
      { kind: "note", text: "Only the approvers of the pending stage see Approve and Reject; everyone else sees who it's waiting for. Approvers are emailed (and get a bell notification) when a step is waiting for them; the requestor and assignee hear when it's approved or rejected." },
    ],
  },
  {
    id: "send-for-approval",
    section: "sla",
    audience: "agent",
    title: "Send a ticket for approval",
    summary: "Ask a manager (or anyone) to sign off while you work a ticket.",
    keywords: ["send for approval", "on fly", "ad hoc approval", "manager approval", "withdraw", "approver", "sign off"],
    blocks: [
      {
        kind: "p",
        text: "Example: a laptop isn't working, and you find water damage. Before replacing it you need the requestor's manager to approve. **Send for approval** asks them without leaving the ticket.",
      },
      {
        kind: "steps",
        items: [
          "Open the ticket. **Send for approval** appears beside the status buttons in statuses where your admin allows it (for example In Progress).",
          "Pick an **Approval workflow**. Each one lists its stages and who approves them. One that can't start for this ticket (for example the requestor has no manager) shows why and can't be picked.",
          "For a stage that says **pick from**, choose the approver(s) yourself. You can only pick from the people the stage allows: anyone, a group, or a list.",
          "Optionally add a **Message to the approver**, then click **Send for approval**.",
        ],
      },
      {
        kind: "list",
        items: [
          "The approvers are emailed and get a bell notification, with your message.",
          "If your admin set a waiting status, the ticket moves there (for example **Awaiting Approval**). It comes back to the status you sent it from when the approval is approved, rejected or withdrawn.",
          "While it's pending, nobody can change the ticket's status. The **Approvals** card at the top of the ticket shows who it's waiting for.",
          "Picked the wrong person? Click **Withdraw** on the Approvals card. You can withdraw approvals you sent; supervisors can withdraw anyone's.",
        ],
      },
      { kind: "note", text: "The button is hidden when your role doesn't have **Send for Approval**, when the ticket's status doesn't allow it, or while another approval is pending." },
    ],
  },

  // ── Dashboard & reports ─────────────────────────────────────────────────────
  {
    id: "dashboard",
    section: "insights",
    audience: "agent",
    title: "Use the dashboard",
    summary: "Read the KPIs and drill into any number.",
    keywords: ["dashboard", "kpi", "chart", "drill down", "attention", "leaderboard", "csat"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Dashboard** from the sidebar.",
          "Pick a **Period** (Last 7, 30 or 90 days) and optionally a **Project**.",
          "Click any KPI, chart segment or **Needs attention** tile (Unassigned, Overdue, SLA at risk, SLA breached) to open a panel listing the matching tickets.",
          "Click **Open in queue** to see the full filtered list in the ticket queue.",
        ],
      },
      {
        kind: "p",
        text: "The period drives every history tile: Created, Resolved, Avg resolution, the trend chart, SLA compliance, CSAT, the status / priority / team / source charts (tickets created in the period) and the agent leaderboard. Tiles marked **Now** (Open, Needs attention, Backlog aging, Projects) are live. Days are UTC days. Resolution times are business hours on each ticket's SLA calendar. **Updated hh:mm** shows when the numbers were last refreshed; they refresh by themselves when tickets change, and at least every 5 minutes.",
      },
      { kind: "note", text: "The dashboard needs dashboard permission. Agents don't have it by default." },
    ],
  },
  {
    id: "reports",
    section: "insights",
    audience: "agent",
    title: "Run and export reports",
    summary: "Download Excel/CSV reports, including the full Ticket Data export.",
    keywords: ["report", "export", "excel", "xlsx", "csv", "ticket data", "download", "sla compliance", "agent performance"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Reports** from the sidebar.",
          "On the report's row, choose the **Project** and the **From** / **To** dates (default: the current month).",
          "Click **Download** for Excel (.xlsx) or CSV, or **Generate Report** to view it on screen first.",
          "**Export all** puts every report into one Excel workbook.",
        ],
      },
      {
        kind: "p",
        text: "Available reports include Ticket Data, Tickets by Status / Priority / Team, Open Tickets by Project, Created vs Resolved, Agent Performance, Resolution Time by Priority, SLA Compliance Summary, SLA Breach List, Backlog Aging, CSAT Summary and CSAT Responses.",
      },
      {
        kind: "note",
        text: "A date range can be up to 6 months. **Ticket Data** (every field, including custom and SLA fields) is capped at 5,000 tickets, so download longer periods in parts.",
      },
      {
        kind: "tip",
        text: "For a live summary across every helpdesk you can access, click **Reports** on Home (or **All helpdesks** on the Reports page). Resolution times are in business hours, and SLA compliance counts tickets: met only if every response and resolution SLA was met.",
      },
    ],
  },

  // ── Knowledge base ──────────────────────────────────────────────────────────
  {
    id: "kb",
    section: "kb",
    audience: "agent",
    title: "Write and publish knowledge-base articles",
    summary: "Create articles for the Service Portal or for agents only.",
    keywords: ["knowledge base", "kb", "article", "publish", "draft", "unpublish", "archive", "restore", "faq", "internal", "portal"],
    blocks: [
      {
        kind: "steps",
        items: [
          "From Home, open **Knowledge Base**.",
          "Pick a helpdesk, or **Organisation-wide** for articles shared across every helpdesk.",
          "On the **Articles** tab, click **New article**.",
          "Fill in **Title**, **Summary**, **Body**, **Category** and **Tags**.",
          "Set **Visibility**: **Portal** (end users and agents) or **Internal** (agents only).",
          "Click **Publish**, or **Save draft** to finish later.",
          "To change a live article, click **Save & keep published** (changes go live at once) or **Unpublish & save as draft** (hides it from the Service Portal until you publish again).",
          "To retire an article without deleting it, click **Archive**. Archived articles are hidden from the portal and from the article list; pick **Archived** in the status filter to find one, then **Restore to draft**.",
        ],
      },
      {
        kind: "p",
        text: "Organise articles on the **Categories** tab (one level of nesting: a sub-category can't have its own sub-categories, and a category that has some must stay top-level). Deleting a category leaves its articles uncategorised and moves its sub-categories to the top level. Only published **Portal** articles appear in the Service Portal, and its search forgives typos. You need knowledge-base permission to see this area.",
      },
    ],
  },

  // ── Email & notifications ───────────────────────────────────────────────────
  {
    id: "email-tickets",
    section: "email",
    audience: "agent",
    title: "How email becomes tickets",
    summary: "New emails, replies and threading by ticket number.",
    keywords: ["email", "mail", "inbox", "reply", "thread", "subject", "mailbox", "reopen"],
    blocks: [
      {
        kind: "list",
        items: [
          "A new email to the support mailbox creates a ticket. The subject becomes the summary, the body becomes the description and the sender becomes the requestor.",
          "Your admin's routing rules decide which project it lands in.",
          "A reply is added to the ticket as a **public comment** from the sender.",
          "Replies are matched to their ticket by the number in the subject, for example **[ITINC12]**. Every notification OneDesk sends puts that number first, so tell users to just hit Reply.",
          "By default, a reply to a resolved or closed ticket is added as a comment without reopening it. Your admin can change this per mailbox.",
        ],
      },
      { kind: "tip", text: "Auto-replies, mail loops and blocked senders are ignored, so out-of-office messages won't create tickets." },
    ],
  },
  {
    id: "notifications",
    section: "email",
    audience: "agent",
    title: "Notifications: who gets told what",
    summary: "In-app bell and email notifications by event.",
    keywords: ["notification", "bell", "alert", "email notification", "who is notified"],
    blocks: [
      {
        kind: "p",
        text: "The bell in the top bar (inside a helpdesk, and in the portal header) shows your 15 most recent notifications. Unread ones are highlighted; clicking one opens its ticket and marks just that one read. **Mark all as read** clears the rest. The usual setup, which your admin can change per project:",
      },
      {
        kind: "list",
        items: [
          "**Ticket created**: the assigned group and the requestor (in-app + email).",
          "**Assigned**: the new assignee (in-app + email).",
          "**Status changed**, **Resolved**, **Closed**: the requestor and watchers (in-app + email).",
          "**Public comment**: the requestor, watchers and assignee (in-app + email).",
          "**Internal note**: the assignee and watchers (in-app only). Only agents on the ticket's helpdesk ever get it.",
          "**SLA warning / breach**: the assignee and the group lead (in-app + email). Agents only.",
          "**Approval requested**: whoever can approve the waiting step, with a link to their Approvals inbox (in-app + email).",
          "**Approval granted / rejected**: the requestor and assignee (in-app + email). A rejection includes the approver's reason.",
          "**Watcher added**: the person who was added (in-app + email), unless they added themselves.",
        ],
      },
    ],
  },
  // ── Admin: users & access ──────────────────────────────────────────────────
  {
    id: "admin-users",
    section: "admin-access",
    audience: "admin",
    title: "Add and manage users",
    summary: "Create accounts, give helpdesk and project access, reset passwords.",
    keywords: ["user", "add user", "invite", "deactivate", "reset password", "member", "lead", "helpdesk access", "tenant settings", "edit user", "change email", "manager"],
    blocks: [
      {
        kind: "p",
        text: "Org-wide settings live in **Tenant Settings**. Open it with the gear icon in the top bar on Home.",
      },
      { kind: "h", text: "Add a user" },
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Users** and click **Add user**.",
          "Enter **Full name**, **Username** and **Email**. Email is required if the user will sign in with Microsoft.",
          "Choose the **Sign-in method**: **Username & password** or **Microsoft (SSO)**.",
          "Pick an **ITSM role** (Agent, Supervisor, Admin, Requestor or a custom role).",
          "Under **Helpdesks & projects**, tick each helpdesk, then the projects inside it the user should work in.",
          "Click **Create user**. A one-time password is shown once. Click **Copy password** and send it to the user securely.",
        ],
      },
      {
        kind: "note",
        text: "OneDesk doesn't send invitation emails. You share the first password yourself.",
      },
      { kind: "h", text: "Edit a user's name, email or manager" },
      {
        kind: "steps",
        items: [
          "In **Tenant Settings → Users**, open the **⋯** menu on the user's row and choose **Edit details**.",
          "Change the **Full name**, **Email** or **Manager**, then click **Save**. The username (sign-in ID) stays the same.",
        ],
      },
      {
        kind: "list",
        items: [
          "Incoming emails are matched to people by their email address, so no two accounts can share one. If another account already uses the address, OneDesk names it; clear or change it there first.",
          "Add an email to an account that has none (for example, one created by an asset import) so that person's emails land on their own account and their assets show on their tickets.",
          "The **Manager** is who approvals with a **Requestor's manager** stage are sent to. The roster shows it as \"Reports to …\".",
          "System accounts can't be edited, and only a superuser can edit an organisation administrator.",
        ],
      },
      { kind: "h", text: "Helpdesk and project access" },
      {
        kind: "list",
        items: [
          "Open the row's **⋯** menu → **Helpdesks & projects** to change access later.",
          "A **Member** sees only the projects ticked for them. A **Lead** sees every active project in that helpdesk.",
          "Adding someone to a helpdesk without ticking any project gives them no project queues.",
          "Requestors can't be given helpdesks, so switching a user to Requestor removes their helpdesk access.",
        ],
      },
      { kind: "h", text: "Day-to-day" },
      {
        kind: "list",
        items: [
          "Change a role with the role dropdown on the user's row.",
          "Turn the **Active** switch off to stop someone signing in. Their history is kept. Administrators (superusers), the system accounts (email-bot, automation-bot) and your own account can't be switched off here.",
          "**⋯ → Reset password** issues a new temporary password and the old one stops working immediately.",
          "**Tenant Settings → User Attributes** adds custom profile fields (text, number, date, checkbox, dropdown, multi-select), shown as user columns and filters.",
        ],
      },
    ],
  },
  {
    id: "admin-roles",
    section: "admin-access",
    audience: "admin",
    title: "Roles and permissions",
    summary: "What each built-in role can do, and how to make your own.",
    keywords: ["role", "permission", "rbac", "supervisor", "agent", "admin", "requestor", "access", "matrix"],
    blocks: [
      {
        kind: "list",
        items: [
          "**Admin**: full access, including helpdesk **Configuration**.",
          "**Supervisor**: everything an agent can do, plus configuration and admin permissions.",
          "**Agent**: works tickets, comments, internal notes, links, canned responses, the knowledge base, move and print. Read-only on configuration. No delete.",
          "**Requestor**: Service Portal only. Raises requests and reads portal articles.",
        ],
      },
      { kind: "h", text: "Edit permissions" },
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Roles & Permissions** and select a role.",
          "Tick **Read**, **Create**, **Update** or **Delete** per module. **Screens & Features** covers the app and **Settings & Administration** covers configuration.",
          "Click **Save changes**.",
        ],
      },
      {
        kind: "p",
        text: "Click **New** to create a custom role. It starts with no permissions. Built-in roles can be edited but not deleted or switched off. A custom role can be deleted only once no users have it.",
      },
      {
        kind: "note",
        text: "Agents need **Read** on Layout Designer, Transitions and Custom Fields, or ticket forms won't load properly. **Move ticket** is controlled by its **Create** box.",
      },
      {
        kind: "tip",
        text: "Users with **Projects → Update** (Supervisors and Admins by default) see every project in the helpdesks they belong to. Everyone else sees only their ticked projects.",
      },
    ],
  },
  {
    id: "admin-sso",
    section: "admin-access",
    audience: "admin",
    title: "Set up Microsoft sign-in (SSO)",
    summary: "Let people sign in with their Microsoft (Entra ID) account.",
    keywords: ["sso", "microsoft", "entra", "azure ad", "single sign-on", "office 365", "login"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Authentication** and copy the **Redirect URI**.",
          "In Microsoft Entra, register an app (or open yours) and add that address as a **Web** redirect URI.",
          "Back in OneDesk, enter the **Application (client) ID** and **Directory (tenant) ID**.",
          "Paste the **Client secret**. Use the secret's **Value**, not its Secret ID. It's stored encrypted and never shown again.",
          "Optionally turn on **Auto-create first-time users** and list **Allowed email domains**.",
          "Turn on **Enable \"Sign in with Microsoft\"** and click **Save changes**.",
        ],
      },
      {
        kind: "note",
        text: "Auto-created users become portal **Requestors**. Give agents a role and helpdesks in **Users**. A user's OneDesk email must match their Microsoft account.",
      },
    ],
  },
  {
    id: "admin-branding",
    section: "admin-access",
    audience: "admin",
    title: "Branding",
    summary: "Show your client's name and logo on login and printouts.",
    keywords: ["branding", "logo", "white label", "client name", "print header"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Branding**.",
          "Click **Upload logo** (PNG, JPG or SVG; wide logos work best).",
          "Enter the **Client name**, plus **Address**, **Website** and **Email** if you want them on printouts.",
          "Save. The login page and printed tickets update straight away.",
        ],
      },
    ],
  },
  {
    id: "admin-audit-log",
    section: "admin-access",
    audience: "admin",
    title: "Audit log: who changed what",
    summary: "See sign-ins, failed sign-ins and every change to users, roles and settings.",
    keywords: ["audit", "audit log", "history", "who changed", "security", "login", "failed login", "compliance", "export"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Audit log**. Only the **Admin** role sees it by default; grant **Audit Log** (Read) to another role in **Roles & Permissions** if needed.",
          "Pick a date range (the last 30 days by default) and, optionally, **Who**, **Area** and **Action**, or search for a record or username.",
          "Click a row to see each changed field's **Before** and **After** value, plus the reason for a failed sign-in, the IP address and the browser.",
          "Click **Export CSV** to download the matching events (newest first, up to 10,000 rows).",
        ],
      },
      {
        kind: "list",
        items: [
          "**Recorded:** sign-ins and failed sign-ins (the username tried, never the password), password changes and resets, users, roles, permissions and memberships, and changes to helpdesks, projects, groups, workflows, fields, layouts, SLA, email, notifications, surveys, approvals, the catalog, automation, branding and SSO.",
          "**Not recorded here:** ticket activity (each ticket's **Activity** tab has it), saved views and column choices, knowledge articles, canned responses and ticket templates.",
          "Secret values such as passwords and client secrets are never stored. A change shows as ••••.",
          "Changes made by the platform operator from the provisioning console show as **Platform admin: …**.",
        ],
      },
      {
        kind: "note",
        text: "Events are kept indefinitely for now; there's no automatic clean-up yet. Each export is itself recorded in the log.",
      },
    ],
  },

  // ── Admin: helpdesk setup ──────────────────────────────────────────────────
  {
    id: "admin-new-helpdesk",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Create a helpdesk",
    summary: "Add a new helpdesk (IT, HR, Facilities…) and get it ready for tickets.",
    keywords: ["helpdesk", "new helpdesk", "workspace", "prefix", "department", "enable", "disable"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Go to **Tenant Settings → Helpdesks** and click **New helpdesk**.",
          "Enter a **Name** and a **Ticket prefix** (2–5 capital letters or digits, for example **HR**).",
          "Add a description, icon and colour. Leave **Add standard Incident & Service Request projects** ticked to start with both projects, then create it. You're added as its **Lead**.",
          "To add Problem Management (or a project you skipped), open the helpdesk's **Configuration → Projects** and click **Import standard project**.",
          "Add the rest of the team under **Tenant Settings → Users → ⋯ → Helpdesks & projects**.",
          "Create at least one group under **Assigned Groups** so tickets can be routed.",
        ],
      },
      {
        kind: "note",
        text: "Untick the standard-projects box and the helpdesk starts with no projects: nobody can raise tickets in it until you import or create one. If a standard project can't be added (for example its key is already taken) the helpdesk is still created and you're told why.",
      },
      {
        kind: "p",
        text: "On the Helpdesks list you can switch helpdesks on or off and drag them to reorder the cards on Home. A helpdesk's own name, prefix and status are edited in its **Configuration → Helpdesk Config**; while a helpdesk is switched off, use the pencil on the Helpdesks list instead. Changing the prefix keeps existing ticket numbers.",
      },
    ],
  },
  {
    id: "admin-calendars",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Business hours and holidays",
    summary: "Set the working hours SLA clocks count against.",
    keywords: ["calendar", "business hours", "holiday", "timezone", "working hours", "24/7", "shift"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → Business Calendars** and click **New calendar**.",
          "Set the **Name** and **Timezone**.",
          "Under **Business hours**, adjust the working windows. A new calendar starts with Mon–Fri 09:00–17:00; add a second window for split shifts.",
          "Under **Holidays**, add the date and name of each day off. Tick **Repeats annually** for holidays on the same date every year.",
          "Click **Make default** if this should apply wherever no other calendar is chosen.",
        ],
      },
      {
        kind: "list",
        items: [
          "Calendars are shared by every helpdesk.",
          "A ticket uses its project's **Business calendar**, otherwise the SLA policy's calendar, otherwise the default. With none at all, clocks run 24/7.",
          "Changes affect SLA clocks started after you save.",
        ],
      },
      {
        kind: "note",
        text: "A calendar with no working hours runs SLA clocks 24/7 (nights and weekends count); the editors flag such calendars. An annual 29 February holiday is skipped on 28 February in other years.",
      },
    ],
  },
  {
    id: "admin-groups",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Assignment groups and round-robin",
    summary: "Create teams, add leads and agents, and understand auto-assignment.",
    keywords: ["group", "team", "lead", "round robin", "auto assign", "service desk", "members"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → Assigned Groups** and click **New group**.",
          "Enter a **Name** and **Key** (lowercase, unique across the organisation), choose a **Type** and save.",
          "Open the group again and add **Leads** and **Agents** in the **Team** section.",
        ],
      },
      {
        kind: "list",
        items: [
          "The **primary lead** receives \"assign to group lead\" tickets and group-lead notifications (such as SLA breaches).",
          "The group **Type** is a label only and doesn't affect routing.",
          "In the standard workflows, **Assign** (Incident), **Start Fulfilment** (Request) and **Start Investigation** (Problem) pick a technician round-robin from the group's active members, but only when the ticket has no assignee (an existing assignee is never replaced). Custom-project starter workflows don't auto-assign.",
        ],
      },
      { kind: "tip", text: "To pick the group automatically at creation, use the project's **Routing** tab (see \"Route new tickets to the right group\")." },
    ],
  },
  {
    id: "admin-canned",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Manage canned responses",
    summary: "Build the reply library agents insert from the composer.",
    keywords: ["canned", "template", "saved reply", "library", "shortcut", "category"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → Canned Responses** in the helpdesk where agents will use them.",
          "Click **New response** and enter a **Title** and **Body**.",
          "Optionally add a **Shortcut** keyword (agents can search by it) and a **Category**.",
          "Save. Agents in this helpdesk see it straight away under **Canned response** in the reply box.",
        ],
      },
      {
        kind: "note",
        text: "Each helpdesk has its own library. A response created in one helpdesk doesn't appear in another, and only members of that helpdesk see it.",
      },
    ],
  },
  {
    id: "admin-all-columns",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Default columns for All Tickets",
    summary: "Choose what everyone sees first in the cross-project queue.",
    keywords: ["columns", "all tickets", "default layout", "queue columns", "custom field column"],
    blocks: [
      {
        kind: "p",
        text: "Open **Configuration → All-Tickets Columns**, pick and order the columns (custom fields from any project in the helpdesk are offered) and click **Save layout**. **Reset to default** restores the product default. Agents can still adjust their own view. Each project's queue has its own defaults on the project's **Columns** tab.",
      },
    ],
  },
  {
    id: "admin-all-filters",
    section: "admin-helpdesk",
    audience: "admin",
    title: "Filters for All Tickets",
    summary: "Share filters with every agent and pick the views All Tickets offers.",
    keywords: ["filters", "all tickets", "saved views", "shared filter", "default view", "helpdesk filters"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → All-Tickets Filters**.",
          "Under **Default views**, untick any built-in view you don't want in the All Tickets menu. **All tickets** is always on.",
          "Pick the **All Tickets default view** (the view that opens when an agent hasn't starred their own), then click **Save defaults**.",
          "Click **New filter**, name it, set its conditions and click **Save filter**. Every agent in this helpdesk sees it under **Helpdesk filters**, in All Tickets and in each project's queue.",
          "Views agents shared from All Tickets are listed too, with who created them. Use the arrows to reorder, the pencil to edit, or the bin to delete one for everyone.",
        ],
      },
      {
        kind: "p",
        text: "Each project's queue keeps its own built-in views and default on the project's **Filters** tab.",
      },
    ],
  },

  // ── Admin: projects & workflows ────────────────────────────────────────────
  {
    id: "admin-projects",
    section: "admin-projects",
    audience: "admin",
    title: "Add a project",
    summary: "Import a ready-made Incident/Request/Problem project, or build a custom one.",
    keywords: ["project", "incident", "request", "problem", "import", "standard project", "custom project", "key", "itil"],
    blocks: [
      { kind: "h", text: "Import a standard project (recommended)" },
      {
        kind: "steps",
        items: [
          "Open **Configuration → Projects** and click **Import standard project**.",
          "Click **Import** next to **Incident Management**, **Request Management** or **Problem Management**.",
        ],
      },
      {
        kind: "p",
        text: "Standard projects arrive fully configured: workflow, fields, layout, notifications and survey. Problem projects are for agents only (never shown on the portal) and start without SLA targets.",
      },
      { kind: "h", text: "Create a custom project" },
      {
        kind: "steps",
        items: [
          "Click **Create custom project**.",
          "Enter a **Name** and a **Key** (2–10 capital letters, used as the ticket prefix), then **Create project**.",
          "On the **Workflow** tab click **Create workflow**. Custom projects start without one, and tickets can't change status until you add it.",
          "Set the **Default group** on the **Overview** tab, and add SLA targets on the **SLA** tab.",
          "Turn on the survey on the **Survey** tab if you want feedback. It's off for custom projects.",
        ],
      },
      {
        kind: "tip",
        text: "On **Overview** you can also choose the project's **Business calendar** and **Default workflow**, or set **Status** to Inactive to hide the project from agents and the portal.",
      },
    ],
  },
  {
    id: "admin-workflow",
    section: "admin-projects",
    audience: "admin",
    title: "Edit a workflow: statuses and transitions",
    summary: "Add statuses, connect them with transitions and validate.",
    keywords: ["workflow", "status", "transition", "done", "exclude from sla", "on hold", "validate"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Workflow** tab.",
          "Under **Statuses**, add a status with a name and **Category**. Tick **Exclude from SLA** for waiting states such as \"Waiting for customer\".",
          "Under **Transitions**, enter the button name, choose **From** and **To**, and click **Add transition**. Choose **Any status (global)** for a step available from every status.",
          "Click **Validate**. A workflow needs exactly one initial status, a create transition and at least one Done status.",
          "The **(create)** transition runs when a ticket is created: new tickets start in its To status, and a **Start approval** set on it starts the approval straight away. Its other settings don't apply at creation.",
          "Deleting asks for confirmation. A status that has tickets in it, or that new tickets start in, can't be deleted; deleting a status also deletes the transitions into and out of it.",
        ],
      },
      {
        kind: "note",
        text: "Workflows are shared, so editing one changes every project that uses it; the Workflow tab shows a **Shared by N projects** banner. To change one project only, click **Make a copy for this project**: new tickets use the copy, tickets already open keep the shared workflow, and the project's automation rules switch to the copy.",
      },
      {
        kind: "p",
        text: "Moving a ticket into a Done status emails the requestor a **Resolved** notification, or **Closed** for a status keyed \"closed\".",
      },
    ],
  },
  {
    id: "admin-transitions",
    section: "admin-projects",
    audience: "admin",
    title: "Transition rules: notes, required fields, approvals",
    summary: "Make a step ask for a note, capture fields, require approval or block until a field is set.",
    keywords: ["transition settings", "field condition", "block", "mandatory note", "approval", "portal", "reopen from portal", "assignee required"],
    blocks: [
      { kind: "p", text: "On the **Workflow** tab, click **Configure** on a transition to open **Transition settings**." },
      {
        kind: "list",
        items: [
          "**Allowed from portal**: lets requestors run it (for example **Reopen**) from the Service Portal.",
          "**Prompt for a note on this transition**: set a heading, choose Public Comment or Internal Note, and make it Optional or Mandatory.",
          "**Capture fields on this transition**: ask for fields such as root cause when the step runs (text, number, date, dropdown, radio and checkbox fields).",
          "**Field conditions to allow this transition**: block the step until a field **must not be empty**, **must be empty**, **must equal** or **must not equal** a value, with your own message. Agents see the button greyed out with your message until the rule passes. A rule on a field the ticket's project doesn't have is skipped, and a cascading field (e.g. Category) counts as filled only when every level is chosen.",
          "**Start approval when this transition runs** / **Require approval to run this transition**: see below.",
        ],
      },
      { kind: "h", text: "Example: don't allow Assign without an assignee" },
      {
        kind: "steps",
        items: [
          "Configure the **Assign** transition.",
          "Under **Field conditions**, add **Assignee** → **must not be empty**.",
          "Enter a message such as \"Pick a technician before assigning\" and save.",
        ],
      },
      { kind: "h", text: "Approvals" },
      {
        kind: "p",
        text: "First create an approval workflow on the project's **Approval** tab. Then tick **Start approval** on the transition that moves the ticket into the waiting status, and **Require approval** on the transition that moves it out. While an approval is pending, every status change on the ticket is frozen. **Require approval** lets the ticket move on only when its latest approval was approved (or it never needed one). If an approver can't be found when the approval starts (for example the requestor has no manager), the transition is refused with a message and the ticket keeps its status.",
      },
    ],
  },
  {
    id: "admin-approvals",
    section: "admin-projects",
    audience: "admin",
    title: "Approval workflows",
    summary: "Define who signs off, in which order.",
    keywords: ["approval", "approver", "manager approval", "stage", "level", "sign off"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Approval** tab.",
          "Enter a name and click **Add workflow**.",
          "Add stages in order. For each, set a **Stage name** and **Approver type**: **Specific user**, **Anyone with role**, **Anyone in group**, **Requestor's manager** (with an optional fallback approver) or **On fly (agent picks)**. A stage can't be added until you pick who approves it.",
          "Connect it to the workflow with transition rules (see \"Transition rules: notes, required fields, approvals\"), or let agents start it with **Send for approval** (below).",
        ],
      },
      {
        kind: "p",
        text: "**Sequential** runs stages one after another; **Parallel** asks every stage at once. A rejection at any stage ends the approval. Switch a workflow off (Active) to stop it starting. Approvers find waiting items under the Approvals icon, and are emailed and notified in-app.",
      },
      { kind: "h", text: "Send for approval and On-fly approvers" },
      {
        kind: "steps",
        items: [
          "On the **Workflow** tab, open a status's settings (for example In Progress) and tick **Allow Send for approval**. Agents then see **Send for approval** on tickets in that status.",
          "Optional: in **While waiting, move to**, pick a status for the ticket to wait in, such as an **Awaiting Approval** status you add to the workflow. It needs no transitions: the ticket moves there when sent and back when the approval is decided or withdrawn. Tick **Exclude from SLA** on that status to pause the SLA while it waits.",
          "On the **Approval** tab, add a workflow agents can send. For a stage where the agent chooses the approver, pick **On fly (agent picks)** and what they pick from: **Any user**, **Members of a group** or **Listed users**.",
        ],
      },
      {
        kind: "list",
        items: [
          "Agents can send any active approval workflow of the project, not only ones with On-fly stages. A **Requestor's manager** workflow works for \"ask the manager\" too.",
          "A workflow with an On-fly stage is marked **Send for approval only**: a transition's Start approval or a catalog item can't use it, because nobody would pick the approvers.",
          "Who may send is the **Send for Approval** permission (Roles & Permissions). Agents, Supervisors and Admins have it by default; Delete on it lets someone withdraw approvals other people sent.",
          "A rejected approval that was sent from the ticket returns the ticket to the status it came from. It doesn't move it to Rejected.",
        ],
      },
    ],
  },
  {
    id: "admin-fields",
    section: "admin-projects",
    audience: "admin",
    title: "Custom fields and the ticket form",
    summary: "Add fields, set validation and arrange the form layout.",
    keywords: ["custom field", "field", "dropdown", "cascading", "required", "layout", "form", "portal field", "conditional"],
    blocks: [
      { kind: "h", text: "Add a field" },
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Fields** tab.",
          "Under **Project fields**, enter a **Field name**, choose a **Type** and click **Add field**.",
          "Open **Field settings** to set **Required**, a tooltip, hint text, a validation pattern, or a **Conditional rule** (\"Show this field when…\" / \"Make read-only when…\").",
        ],
      },
      {
        kind: "p",
        text: "Types include text, multi-line, rich text, number, date, date & time, dropdown, multi-select, checkbox, radio, user picker, group picker, cascading (dependent) lists and attachments.",
      },
      { kind: "h", text: "Put it on the form" },
      {
        kind: "steps",
        items: [
          "Go to the **Layout** tab (click **Create default layout** if it's empty).",
          "Use **Add to form** and drag the field into the main area (**Ticket details**) or the **Sidebar**. Use **+ Section** and type a name to group fields; a new section is saved straight away, even before you drag a field into it.",
          "Use the **Required**, **Hidden** and **Portal** toggles. Only fields with **Portal** on appear on the Service Portal form.",
        ],
      },
      { kind: "note", text: "A field that isn't on the layout doesn't appear on the ticket, even if it exists on the Fields tab." },
      {
        kind: "note",
        text: "**Required** is checked when an agent creates a ticket and on the portal (there only if **Portal** is on). A field isn't required while it's **Hidden**, while its conditional rule hides or locks it, or while a dropdown / cascading field has no options. Tickets created by email or automation aren't checked.",
      },
      {
        kind: "tip",
        text: "Incident and Problem projects have a **Priority Matrix** tab that maps Impact × Urgency to P1–P4. **Reset to ITIL default** restores the standard grid.",
      },
    ],
  },
  {
    id: "admin-sla",
    section: "admin-projects",
    audience: "admin",
    title: "Set SLA targets",
    summary: "Response and resolution targets per priority.",
    keywords: ["sla", "policy", "target", "response time", "resolution time", "priority", "minutes", "breach"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the project and go to the **SLA** tab. Click **Set up SLA policy** if there isn't one yet.",
          "Click **Add Response SLA** and/or **Add Resolution SLA**.",
          "Enter a target in **minutes** for each priority (P1 – Critical to P4 – Low). For example, 240 = 4 hours.",
          "Optionally pick a **Business calendar**, then click **Save targets**.",
        ],
      },
      {
        kind: "list",
        items: [
          "New targets apply to tickets created after you save. Existing tickets keep the targets they started with, unless their priority changes.",
          "Leave a priority blank for **no SLA** at that priority: no clock starts, and a ticket that changes to that priority loses that clock.",
          "To pause clocks while waiting on the customer, tick **Exclude from SLA** on that status in the workflow.",
          "Warnings and breaches notify the assignee and group lead (see the **Notifications** tab).",
        ],
      },
    ],
  },
  {
    id: "admin-routing",
    section: "admin-projects",
    audience: "admin",
    title: "Route new tickets to the right group",
    summary: "Limit allowed groups and auto-route by conditions.",
    keywords: ["routing", "assignment rule", "auto route", "default group", "allowed groups", "condition"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Routing** tab.",
          "Optionally tick **Restrict to selected groups** and click **Save assignment groups**. The project's default group is always allowed.",
          "Under **Routing rules**, click **New rule**, name it and **Add condition** (match all or any), for example Category = Network.",
          "Choose **Route to group** and, optionally, **Assign technician**, then **Save rule**.",
        ],
      },
      {
        kind: "note",
        text: "Rules apply only to tickets created without a group or assignee. The first matching rule wins. If none match, the project's **Default group** is used.",
      },
    ],
  },
  {
    id: "admin-automation",
    section: "admin-projects",
    audience: "admin",
    title: "Automate ticket updates with rules",
    summary: "When a ticket changes, check conditions and move its status, set a field or add a comment.",
    keywords: ["automation", "rule", "trigger", "auto assign", "auto transition", "move to assigned", "when then", "set field", "users affected"],
    blocks: [
      {
        kind: "p",
        text: "An automation rule has three parts: **When** (the trigger), **If** (conditions, using the same fields as queue filters) and **Then** (up to five actions).",
      },
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Automation** tab.",
          "Click **Use template** for the common case (when an agent is assigned to a New ticket, move it to Assigned), or **New rule** to start from scratch.",
          "Under **When**, tick **Ticket created**, **A field is updated** (pick the fields to watch) and/or **Status changes**.",
          "Under **If**, **Add condition** for anything that must also be true, for example Status is New and Assignee is not empty.",
          "Under **Then**, add **Transition status**, **Set field** or **Add comment**, then click **Create rule**.",
        ],
      },
      {
        kind: "list",
        items: [
          "Rules run top to bottom; use the arrows to reorder. **Stop after this rule** skips the rules below once it runs.",
          "A transition runs exactly like clicking it: approvals, conditions and field conditions still apply. Auto-assign never replaces a technician already on the ticket, so running Assign keeps the person who was picked.",
          "**Set field** can change any field on the project's ticket form: Priority, Assignee, Group, the ITIL fields (Impact, Urgency, Users Affected, Business Impact, Root Cause, Resolution Code and Notes, Workaround, Service Downtime, Major Incident) and custom fields, including multi-select, cascade (such as Category) and group fields. Summary, Description and Requestor can't be set.",
          "Setting Impact or Urgency recalculates Priority from the Priority Matrix, just like a manual edit.",
          "Changes appear in the ticket's **Activity** tab as made by **Automation**.",
          "Click the history icon on a rule to see **Recent runs**: what it did, or why it failed or was skipped.",
        ],
      },
      {
        kind: "note",
        text: "Changes made by automation never trigger other rules, so rules can't loop. A public comment from automation is emailed like any reply, but doesn't count as the first response for SLA.",
      },
    ],
  },
  {
    id: "admin-notifications",
    section: "admin-projects",
    audience: "admin",
    title: "Notifications and the satisfaction survey",
    summary: "Choose who is told about what, and collect CSAT feedback.",
    keywords: ["notification", "email template", "recipient", "csat", "survey", "nps", "feedback", "rating"],
    blocks: [
      { kind: "h", text: "Notifications" },
      {
        kind: "steps",
        items: [
          "Open the project and go to the **Notifications** tab.",
          "For each event (Ticket Created, Status Changed, Assigned, Comment Added, Resolved, Closed, Approval Requested / Granted / Rejected / Cancelled, Watcher Added, SLA Warning, SLA Breach…), switch it on or off. Approval Cancelled starts switched off.",
          "Choose channels (**In-App**, **Email**) and **Recipients** (Requestor, Assignee, Assigned group, Group lead, Watchers, Approvers; Added watcher on Watcher Added). Internal notes and SLA alerts only ever reach agents on the ticket's helpdesk, whatever you pick.",
          "Click **Edit** on the email template to change its wording, use **Preview**, then **Save template**.",
        ],
      },
      { kind: "h", text: "Satisfaction survey" },
      {
        kind: "steps",
        items: [
          "Go to the **Survey** tab and switch the survey on.",
          "Choose **Send survey when ticket is** resolved or closed.",
          "Pick a **Rating scale**: CSAT (1–5), Star rating, Thumbs up / down or NPS (0–10).",
          "Edit the intro and thank-you text, then click **Save survey settings**.",
        ],
      },
      {
        kind: "p",
        text: "Each ticket gets one survey, emailed to the requestor (who needs an email address). Results appear in the **CSAT Summary** and **CSAT Responses** reports and on the dashboard.",
      },
    ],
  },
  {
    id: "admin-queue-defaults",
    section: "admin-projects",
    audience: "admin",
    title: "Queue defaults: columns and filters",
    summary: "Set the default columns, views and shared filters for a project.",
    keywords: ["columns", "filters", "default view", "shared filter", "queue"],
    blocks: [
      {
        kind: "list",
        items: [
          "**Columns** tab: pick and order the project queue's default columns (custom fields included), then **Save layout**.",
          "**Filters** tab: choose which default views are offered and the **Project default view**, then **Save defaults**. Click **New filter** to create a shared filter everyone in the project can use.",
        ],
      },
    ],
  },

  // ── Admin: email ───────────────────────────────────────────────────────────
  {
    id: "admin-mailbox",
    section: "admin-email",
    audience: "admin",
    title: "Connect a support mailbox",
    summary: "Turn a mailbox (IMAP/POP3, Google or Microsoft 365) into a ticket channel.",
    keywords: ["mailbox", "email channel", "imap", "pop3", "microsoft 365", "office 365", "gmail", "smtp", "inbound"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → Mailboxes** and click **New mailbox**.",
          "On **Connection**, enter a **Name** and the **Mailbox address**, and choose **Allowed projects** and a **Default project**.",
          "Choose the **Protocol** (IMAP or POP3) and **Auth method**: username & password, Google, or Microsoft 365. Fill in the server details, then click **Test inbound connection**.",
          "For Microsoft 365, enter the client ID, secret and tenant ID, save the mailbox, then click **Connect mailbox** to sign in.",
          "On **Outbound**, tick \"Send acknowledgement & agent replies from this mailbox\", enter SMTP settings and click **Test SMTP**.",
          "Review **Processing** (quoted-reply stripping, CC recipients as watchers, what to do with replies to closed tickets) and **Domains** (allow/block lists).",
          "Click **Create mailbox**.",
        ],
      },
      {
        kind: "list",
        items: [
          "Only mail received after the mailbox starts (**Receiving since…**) is imported, so older messages aren't.",
          "**Reply to closed ticket**: choose **Comment only** or **Reopen** (with a reopen window, 14 days by default).",
          "On **Domains**, adding even one **Allow** entry means mail from every other domain is ignored.",
          "On **Field Mapping**, if you turn off **Create the requestor…**, pick a **Default requestor** (for example a shared \"Unknown sender\" account). Tickets from senders without an account use that person as the requester. The mailbox can't be saved without one.",
        ],
      },
    ],
  },
  {
    id: "admin-email-routing",
    section: "admin-email",
    audience: "admin",
    title: "Route email to the right project",
    summary: "One shared mailbox, keyword rules to send mail to different projects.",
    keywords: ["email routing", "keyword", "rule", "project", "shared mailbox", "allowed projects", "default project"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open the mailbox and, on **Connection**, add every target project to **Allowed projects** and set the **Default project** (used when no rule matches).",
          "Go to the **Routing** tab and add a rule: keywords, **Target project**, where to look (subject or body, subject only, body only) and whether **any** or **all** keywords must match.",
          "Order the rules with the arrows. The first match wins.",
          "Save, then send a test email.",
        ],
      },
      {
        kind: "note",
        text: "Keywords match whole words and ignore case, so \"access\" won't match \"accessory\". Rules only pick the project for new emails: replies always go to their existing ticket. A rule can't target a project that isn't in **Allowed projects**.",
      },
    ],
  },
  {
    id: "admin-email-sender",
    section: "admin-email",
    audience: "admin",
    title: "Set the notification sender",
    summary: "Choose the From address for notification emails.",
    keywords: ["from address", "sender", "reply-to", "smtp", "notification email", "outgoing"],
    blocks: [
      {
        kind: "steps",
        items: [
          "Open **Configuration → Email Notification**.",
          "Keep **Use OneDesk's email system** on and set the **From name** and **Reply-to address**. Or switch it off to connect your own SMTP server or Microsoft 365 account.",
          "Save, then click **Test connection**.",
        ],
      },
      {
        kind: "p",
        text: "Tickets that came from a project mailbox reply from that mailbox. This sender is used for everything else, and as the fallback when a mailbox can't send. Which events send email is set per project on the **Notifications** tab.",
      },
    ],
  },
  {
    id: "admin-email-log",
    section: "admin-email",
    audience: "admin",
    title: "Troubleshoot with the Email Log",
    summary: "See what happened to every incoming email.",
    keywords: ["email log", "failed", "ignored", "retry", "missing email", "not creating ticket"],
    blocks: [
      {
        kind: "p",
        text: "**Configuration → Email Log** lists every message received, with its **Status** (Received, Processed, Ignored, Failed) and **Outcome**: Created ticket, Added comment, Blocked sender, Auto-reply, Mail loop, Too old or Too large. Hover an outcome for what it means and its system code. Click through to the ticket it created or updated.",
      },
      {
        kind: "p",
        text: "Failed messages are retried automatically up to 5 times. **Retry processing** runs one again by hand, using only its plain-text content.",
      },
      { kind: "tip", text: "An email didn't become a ticket? Look it up here first. The outcome usually explains why." },
    ],
  },
  // ── Assets (Asset Management v1, itsm_assets) ─────────────────────────────
  {
    id: "assets-find-add",
    section: "assets",
    audience: "agent",
    title: "Find and add assets",
    summary: "Search and filter the Asset List, open an asset, and add a new one.",
    keywords: ["asset", "asset list", "inventory", "laptop", "asset tag", "warranty", "allot", "allotment", "cmdb", "category", "sub-category", "browse"],
    blocks: [
      {
        kind: "p",
        text: "The **Assets** section in the sidebar has three pages: **Asset Dashboard** (counts and charts), **Asset List** (every asset of this helpdesk) and **Asset Report** (counts and cost grouped your way, with an Excel export). Every dashboard tile and bar opens the Asset List with that filter applied.",
      },
      { kind: "h", text: "Browse by category" },
      {
        kind: "steps",
        items: [
          "In the sidebar, click the arrow beside **Asset List** to show the categories, each with how many assets it holds.",
          "Click the arrow beside a category to show its sub-categories. **No sub-category** lists that category's assets without one.",
          "Click a category or sub-category to list just those assets. The page title shows where you are, for example \"Computer › Laptop\". Click **Asset List** itself to see everything again.",
        ],
      },
      {
        kind: "note",
        text: "The numbers count every asset in the category, whatever its status. The tree stays open (or closed) the way you left it in this browser.",
      },
      { kind: "h", text: "Find an asset" },
      {
        kind: "list",
        items: [
          "Search matches the asset tag, name, the allotted user and text in the detail fields.",
          "Filter by category, sub-category, status, state type, location, department, vendor or warranty. Filters stay in the page address, so you can bookmark or share a view.",
          "Click a column header to sort. Click a row to open the asset.",
          "The **Warranty expiry** column turns amber within 30 days of the end date and red once it has passed.",
        ],
      },
      { kind: "h", text: "Add an asset" },
      {
        kind: "steps",
        items: [
          "On **Asset List**, click **New asset**.",
          "Fill in **General**: the name, a **Category** (and optionally a **Sub-category**) and a **Status**. Leave **Asset Tag** blank to get the next number, like IT-AST-00001.",
          "Add the **Location**, who it's allotted to (**User** and/or **Department**) and the **Purchase** dates and cost.",
          "Fill in **Details**: these fields depend on the category, so a Server and a Printer ask for different things.",
          "Click **Create asset**. Changes after that are listed in the asset's **History**.",
        ],
      },
      {
        kind: "note",
        text: "An **In use** status needs a User or a Department. An Expiry Date that has passed can't be saved with an active status: pick a retired status such as **Expired**, or change the date. Once an hour, active assets whose Expiry Date has passed are moved to Expired automatically.",
      },
    ],
  },
  {
    id: "assets-import",
    section: "assets",
    audience: "agent",
    title: "Import assets from Excel",
    summary: "Download the template, fill it in, check it and import. Fix failed rows and upload them again.",
    keywords: ["import", "excel", "xlsx", "upload", "bulk", "template", "failed rows", "spreadsheet"],
    blocks: [
      {
        kind: "steps",
        items: [
          "On **Asset List**, click **Import**, then **Download template**. It has the right columns for this helpdesk (required ones marked *) and sheets listing the valid categories, statuses, vendors, locations and departments.",
          "Fill in one asset per row and save the file.",
          "Choose the file and click **Check only** to see what would happen without saving anything, or **Import** to save it.",
          "Read the summary, for example “120 created · 7 failed”. Click **View failed records** to see each failed row and why.",
          "Click **Download failed rows**: you get the same columns plus an **Errors** column. Fix them in Excel and import that file.",
        ],
      },
      {
        kind: "list",
        items: [
          "Good rows are saved and bad rows are skipped, so a few mistakes never block the whole file.",
          "Import only creates assets. A row whose Asset Tag already exists fails; leave the tag blank to auto-number.",
          "Up to 5,000 rows and 10 MB per file.",
          "A row with a blank Status gets the default status, or Expired when its Expiry Date has passed.",
          "Tick **Create missing vendors, locations and departments** to add unknown names instead of failing those rows (needs Asset Configuration → Create).",
          "Every import is listed under **Import history**, with **View imported assets** to see what it created.",
        ],
      },
    ],
  },
  {
    id: "assets-link-tickets",
    section: "assets",
    audience: "agent",
    title: "Link assets to tickets",
    summary: "Record which laptop, printer or server a ticket is about, and see every ticket raised against an asset.",
    keywords: ["asset", "link asset", "primary asset", "ticket asset", "requestor assets", "laptop", "device", "asset field"],
    blocks: [
      {
        kind: "p",
        text: "Tickets have a system **Asset** field. It holds one or more assets of the ticket's helpdesk; the **first one is the primary** asset. It only appears where an admin has turned it on in the project's Layout (it's on by default in helpdesks that use assets).",
      },
      { kind: "h", text: "While creating a ticket" },
      {
        kind: "steps",
        items: [
          "Pick the **Requestor**. Their active assets in this helpdesk appear under **Requestor's assets**. If they have exactly one, it's linked for you.",
          "Click a suggested asset to link it, or click **Find another asset** to search every asset of the helpdesk.",
          "In the finder, search by tag, name, user or detail text and narrow it with **Category**, **State**, **Location**, **Department** and **Assigned to**. Click an asset to add it; add as many as you need, then click **Done**.",
          "Use the star to make another asset the primary, or the × to remove one.",
        ],
      },
      {
        kind: "list",
        items: [
          "Once you change the Asset field yourself, choosing a different requestor no longer replaces your choice.",
          "Unallotted, retired and missing assets can be linked too. They're badged so you can tell them apart.",
          "Searching needs the **Assets → Read** permission. Without it the field says so.",
        ],
      },
      { kind: "h", text: "On an existing ticket" },
      {
        kind: "list",
        items: [
          "Each linked asset opens its asset page. Add, remove or re-order (make primary) assets in the same field; each change is saved at once and listed on the **Activity** tab.",
          "Editing the links needs the ticket **Update** permission.",
          "Requestors on the Service Portal can tick only their **own** assets when they raise a request.",
        ],
      },
      { kind: "h", text: "On the asset page" },
      {
        kind: "p",
        text: "An asset's **Tickets** card lists the tickets it's linked to (only the ones you can open), open tickets first, with the number of open ones. Linking and unlinking are also recorded in the asset's **History**.",
      },
      {
        kind: "note",
        text: "The **Ticket Data** report has an **Asset** column (the primary asset) and an **All assets** column.",
      },
    ],
  },
  {
    id: "assets-documents",
    section: "assets",
    audience: "agent",
    title: "Attach invoices and documents",
    summary: "Keep an asset's invoice, warranty card, manual and other paperwork with the asset.",
    keywords: ["asset", "invoice", "warranty", "warranty card", "manual", "document", "attachment", "file", "upload", "bill"],
    blocks: [
      {
        kind: "p",
        text: "Every asset page has a **Documents** card on the right, between **Tickets** and **History**. Files are listed Invoice first, then Warranty card, Manual and Other, newest first within each type.",
      },
      { kind: "h", text: "Add a document" },
      {
        kind: "steps",
        items: [
          "Open the asset from **Asset List** and click **Add** on the Documents card.",
          "Pick the **Type**: Invoice, Warranty card, Manual or Other. It starts on Invoice until the asset has one.",
          "Choose the file and, if you like, add a **Note** such as the invoice number.",
          "Click **Upload**. The file is listed straight away and **History** records it.",
        ],
      },
      {
        kind: "list",
        items: [
          "Allowed files: PDF, images (PNG, JPG, GIF, WebP), Word, Excel and text, up to **20 MB** each.",
          "An asset can hold several files of each type.",
          "Click a file name to open it. PDFs and images open in a new tab; other files download.",
          "Remove a file with the bin icon. History records the removal; there is no undo button.",
        ],
      },
      {
        kind: "note",
        text: "Files are private. They open only for signed-in users who can see the asset, and have no public link. Adding or removing needs the **Assets → Update** permission; opening needs **Assets → Read**.",
      },
    ],
  },
  {
    id: "admin-assets-setup",
    section: "assets",
    audience: "admin",
    title: "Set up asset categories, fields and statuses",
    summary: "Build the category tree, decide which detail fields each category has, and configure statuses.",
    keywords: ["asset category", "sub-category", "detail field", "starter set", "asset status", "state type", "expired", "required field"],
    blocks: [
      {
        kind: "p",
        text: "Open **Configuration → Asset Configuration** (or **Configure** on any asset page). Categories and detail fields belong to this helpdesk; statuses are shared by all helpdesks.",
      },
      { kind: "h", text: "Categories & Fields" },
      {
        kind: "steps",
        items: [
          "No categories yet? Click **Load IT starter set** to add Computer, Server, Printer, Network, Monitor and Mobile with typical fields, or **Add category** to start from scratch.",
          "Select a category and click **Add sub-category** (two levels only, for example Computer › Laptop).",
          "With a category or sub-category selected, click **Add field** and pick an existing field from the library or create a new one (text, number, date, checkbox, dropdown or multi-select).",
          "Use the **Required** switch and the arrows to make a field mandatory and set its order on the form.",
        ],
      },
      {
        kind: "list",
        items: [
          "A sub-category shows its category's fields too. If both link the same field, the sub-category's Required setting wins.",
          "The **Fields library** tab lists every field, where it's used and how many assets have a value. A field's type can't change once values exist.",
          "Renaming a dropdown option keeps its stored value, so existing assets keep it.",
          "A category in use can't be deleted: deactivate it instead. Existing assets keep it; new assets can't pick it.",
        ],
      },
      { kind: "h", text: "Statuses" },
      {
        kind: "list",
        items: [
          "Each status maps to a state type: Available, In use, Under maintenance, Retired or Missing. Filters, the dashboard and the expiry rules use the state type.",
          "**Default** is used when a new asset or import row has no status.",
          "**Expired target** (a Retired-type status) is where the hourly job moves active assets whose Expiry Date has passed. Turn it off on every status to stop automatic expiry.",
          "A status can't be deleted while assets use it or while it's the default.",
        ],
      },
      { kind: "h", text: "The ticket Asset field" },
      {
        kind: "p",
        text: "Tickets link assets through the system **Asset** field. It was placed on every project's layout, visible in helpdesks that had asset categories and **hidden** elsewhere. To use it in another project, open **Project settings → Layout** and un-hide **Asset**; you can also make it Required or show it on the Service Portal there. It can't be created as a new field.",
      },
    ],
  },
  {
    id: "admin-assets-masters",
    section: "assets",
    audience: "admin",
    title: "Vendors, locations and departments",
    summary: "The shared lists the asset form, filters and imports pick from.",
    keywords: ["vendor", "supplier", "location", "site", "department", "master data", "deactivate"],
    blocks: [
      {
        kind: "p",
        text: "**Vendors**, **Locations** and **Departments** are under **Configuration → Asset Configuration**. They are shared by all helpdesks: an item added in one helpdesk appears in every helpdesk's asset forms and imports.",
      },
      {
        kind: "list",
        items: [
          "Click **New vendor** (or location / department), fill in the sheet and save. Names must be unique, ignoring upper/lower case.",
          "Turn **Active** off to hide an item from asset forms. Assets that already use it keep it.",
          "An item used by assets can't be deleted: the delete confirmation offers **Deactivate instead**.",
          "Imports can create missing items for you with **Create missing vendors, locations and departments**.",
        ],
      },
      {
        kind: "note",
        text: "Asset departments are a separate list from the free-text Department user attribute.",
      },
    ],
  },
];

export const HELP_FAQS: HelpFaq[] = [
  { id: "faq-approval-cant-start", audience: "agent", q: "Why was my status change refused with “Approval can't start”?", a: "That step starts an approval, and one of its stages has nobody who could approve it, for example the requestor has no manager or the approval role has no active members. The ticket keeps its status. Ask an admin to fix the stage (Project settings → **Approval**) or the person's profile, then try again." },
  { id: "faq-no-status-buttons", audience: "agent", q: "Why are there no status buttons on my ticket?", a: "The ticket is **Awaiting approval**. Status changes stay locked for everyone, admins included, until the approval is approved or rejected." },
  { id: "faq-transition-error", audience: "agent", q: "I clicked a status button and got a message instead.", a: "Your admin has set a rule on that step, for example a field that must be filled in first. Do what the message asks and try again." },
  { id: "faq-cant-pick-assignee", audience: "agent", q: "Why can't I pick an assignee?", a: "Set the **Assigned Group** first. The assignee must be a member of that group." },
  { id: "faq-auto-assignee", audience: "agent", q: "Why was the assignee filled in automatically?", a: "The **Assign** step can pick a technician round-robin within the group when nobody is assigned yet (it never replaces an existing assignee). You can still change the assignee afterwards." },
  { id: "faq-internal-visibility", audience: "agent", q: "Who can see an internal note?", a: "Only agents. Internal notes are never emailed to the requestor and are left out of printouts." },
  { id: "faq-internal-sla", audience: "agent", q: "Does an internal note stop the response SLA?", a: "No. Only a **public** reply (or resolving the ticket) stops the First response clock." },
  { id: "faq-sla-paused", audience: "agent", q: "Why does my SLA say Paused?", a: "The ticket is in a status excluded from SLA, such as On hold. The clock resumes when it moves out of that status." },
  { id: "faq-priority-changed", audience: "agent", q: "Why did the priority change by itself?", a: "When both Impact and Urgency are on the form, priority is recalculated from them whenever either changes. You can still override it." },
  { id: "faq-no-dashboard", audience: "agent", q: "I can't see Dashboard or Reports.", a: "Your role doesn't include those permissions (agents don't have them by default). Ask your admin." },
  { id: "faq-no-move", audience: "agent", q: "I can't see Move ticket, Print or Delete.", a: "Each one needs its own permission. Ask your admin to add it to your role." },
  { id: "faq-deleted-ticket", audience: "agent", q: "What happens when a ticket is deleted?", a: "It disappears from queues, search, reports and dashboard counts. Its SLA clocks stop, pending approvals are cancelled and emails not yet sent are dropped, so nobody is emailed about it again. A requestor who replies to an old email about it gets a new ticket. Deleting can't be undone." },
  { id: "faq-collapse-sections", audience: "agent", q: "Can I collapse sections on the ticket page?", a: "Yes. Click a section's header (for example **People** or **Impact Assessment**) to collapse or expand it. Admins can make a section start collapsed: **Project settings → Layout**, switch **Collapsed** on in the section's header. Every ticket opens with the layout's setting; the create form and the Service Portal always show sections open. Long descriptions and comments show 6 lines with **Show more**." },
  { id: "faq-move-number", audience: "agent", q: "I moved a ticket and its number changed. Is the old one gone?", a: "No. The old number still opens the ticket, and email replies quoting it still land in the right place." },
  { id: "faq-mention", audience: "agent", q: "Can I @mention a colleague in a comment?", a: "Yes. In a comment or internal note, type **@** and pick an agent from this ticket's helpdesk. They get an in-app notification and an email (by default). Requestors and people outside the helpdesk can't be mentioned." },
  { id: "faq-concurrent-edit", audience: "agent", q: "A colleague changed the ticket while I was editing it. What happens?", a: "Your reply and open editors are never overwritten: an **Updated by … — Refresh** button appears and you choose when to load the changes. If you save a field after someone else changed the ticket, OneDesk refuses the save and refreshes, so you don't overwrite their change by accident. Check the latest values and re-apply yours." },
  { id: "faq-keep-filters", audience: "agent", q: "How do I keep my filters for next time?", a: "Click **Save view** (Only me or Share with project), then star it in the view menu to make it your default. Click the star again to clear it." },
  { id: "faq-columns-reset", audience: "agent", q: "My column layout disappeared in All Tickets.", a: "All Tickets layouts are saved in this browser only, so a different browser or cleared site data resets them. Project-queue layouts are saved to your account." },
  { id: "faq-email-reopen", audience: "agent", q: "A customer replied to a closed ticket. Why didn't it reopen?", a: "By default such replies are added as a comment only. Your admin can set the mailbox to reopen tickets within a time window." },
  { id: "faq-email-thread", audience: "agent", q: "How does an email reply find the right ticket?", a: "Through the ticket number in the subject line, for example **[ITINC12]**. Ask users to reply without editing the subject." },
  { id: "faq-no-survey", audience: "agent", q: "Why didn't the requestor get a satisfaction survey?", a: "Surveys are switched on per project, are sent only once per ticket and need the requestor to have an email address." },
  { id: "faq-export-year", audience: "agent", q: "Why can't I export a whole year?", a: "Report ranges are capped at 6 months, and Ticket Data at 5,000 tickets. Download in parts." },
  { id: "faq-kb-save-draft", audience: "agent", q: "How do I update a published article without taking it down?", a: "Click **Save & keep published**: your changes go live at once. **Unpublish & save as draft** saves and hides the article from the Service Portal until you publish it again." },
  { id: "faq-kb-archive", audience: "agent", q: "How do I retire an old article without deleting it?", a: "Open it and click **Archive**. It disappears from the Service Portal and from the article list. To bring it back, pick **Archived** in the status filter, open it and click **Restore to draft**." },
  { id: "faq-forgot-password", audience: "agent", q: "I forgot my password.", a: "Click **Forgot password?** on the sign-in page and enter your username or email. The emailed link works for 60 minutes, once. If no email arrives, contact your IT administrator. If you remember it and want to change it, use **Change password** in the account menu. Microsoft sign-in users change it in their Microsoft account." },
  { id: "faq-attachment-size", audience: "agent", q: "What's the largest file I can attach?", a: "10 MB per file." },
  { id: "faq-admin-who-changed", audience: "admin", q: "Who changed this setting (or this user's role)?", a: "Open **Tenant Settings → Audit log**, pick the **Area** (or search for the record's name) and click the row to see the before and after values. Ticket changes are on each ticket's **Activity** tab instead." },
  { id: "faq-admin-automation-not-firing", audience: "admin", q: "My automation rule didn't run.", a: "Open the project's **Automation** tab and click the rule's history icon. If there's no run, the trigger or conditions didn't match (rules also ignore changes made by other rules). A **failed** run shows why, for example a transition blocked by a field condition." },
  { id: "faq-admin-no-workflow", audience: "admin", q: "Tickets in my new custom project can't change status.", a: "The project has no workflow yet. Open its **Workflow** tab and click **Create workflow**, or pick a **Default workflow** on **Overview**." },
  { id: "faq-admin-shared-workflow", audience: "admin", q: "I edited a workflow and another project changed too.", a: "Workflows are shared between the projects that use them. On the project's **Workflow** tab click **Make a copy for this project**, then edit the copy." },
  { id: "faq-admin-empty-helpdesk", audience: "admin", q: "I created a helpdesk but it has no projects.", a: "It starts empty only if **Add standard Incident & Service Request projects** was unticked (or an import failed — the create message says why). Go to **Configuration → Projects → Import standard project**, then add members under **Users → ⋯ → Helpdesks & projects**." },
  { id: "faq-admin-no-projects", audience: "admin", q: "A user is in the helpdesk but sees no projects.", a: "Members only see the projects ticked for them. Tick projects in **Users → ⋯ → Helpdesks & projects**, or make them a **Lead**." },
  { id: "faq-admin-canned-missing", audience: "admin", q: "Agents can't see a canned response I created.", a: "Each helpdesk has its own library. Create the response in the helpdesk where the agents work, and check they're members of it." },
  { id: "faq-admin-email-project", audience: "admin", q: "How do I make email land in the right project?", a: "On the mailbox, add the projects to **Allowed projects**, set a **Default project**, then add keyword rules on its **Routing** tab." },
  { id: "faq-admin-rule-not-firing", audience: "admin", q: "An email routing rule isn't working.", a: "Check the rule is active, its target is an allowed project and the keyword is a whole word in the right place (subject/body). Rules never apply to replies." },
  { id: "faq-admin-nobody-can-email", audience: "admin", q: "Suddenly nobody can email the helpdesk.", a: "Check the mailbox's **Domains** tab. A single **Allow** entry makes every other domain blocked. Also check the **Email Log** for the outcome." },
  { id: "faq-admin-sla-not-updated", audience: "admin", q: "I changed SLA targets but open tickets didn't change.", a: "Tickets keep the targets they started with. New targets apply to tickets created after you save, and to a ticket whose priority changes." },
  { id: "faq-admin-sla-instant", audience: "admin", q: "SLA clocks run through nights and weekends.", a: "The business calendar in use has no working hours, so clocks run 24/7. Add hours in **Configuration → Business Calendars** (calendars without hours are flagged there and on the SLA tab)." },
  { id: "faq-admin-no-survey", audience: "admin", q: "Requestors aren't getting satisfaction surveys.", a: "Turn the survey on in the project's **Survey** tab (custom projects start with it off). The requestor also needs an email address." },
  { id: "faq-admin-block-assign", audience: "admin", q: "How do I stop agents assigning without picking a technician?", a: "Configure the **Assign** transition → **Field conditions** → Assignee **must not be empty**, with your own message." },
  { id: "faq-admin-portal-reopen", audience: "admin", q: "Requestors can't reopen tickets from the portal.", a: "Configure the **Reopen** transition and tick **Allowed from portal**." },
  { id: "faq-admin-portal-field", audience: "admin", q: "A field doesn't appear on the portal form.", a: "On the project's **Layout** tab, turn on **Portal** for that field. It must also be on the layout. A dropdown or cascading field with no options yet is hidden from requestors." },
  { id: "faq-admin-supervisor-config", audience: "admin", q: "A supervisor can't find Configuration in the sidebar.", a: "The helpdesk **Configuration** link is shown to the Admin role only." },
  { id: "faq-admin-sso-user", audience: "admin", q: "A user can't sign in with Microsoft.", a: "Check SSO is enabled with the client ID, tenant ID and secret saved, and that the user's OneDesk email matches their Microsoft account. Auto-created users are portal Requestors until you change their role." },
  { id: "faq-admin-delete", audience: "admin", q: "How do I let someone delete tickets?", a: "Give their role **Tickets → Delete** in **Roles & Permissions**. Admin and Supervisor have it by default, Agent doesn't." },
  { id: "faq-admin-holiday-next-year", audience: "admin", q: "Last year's holiday didn't carry over to this year.", a: "Tick **Repeats annually** when you add a holiday, and it is skipped on the same date every year. Without it, only the exact date entered is skipped." },
  { id: "faq-asset-expired", audience: "agent", q: "Why did an asset's status change to Expired by itself?", a: "Its **Expiry Date** had passed while its status was active (Available, In use or Under maintenance). Once an hour such assets are moved to the Expired status. The asset's **History** shows the change as made by **System**." },
  { id: "faq-asset-cant-save-status", audience: "agent", q: "I can't save an asset: it says the expiry date has passed.", a: "An active status can't be saved with an Expiry Date in the past. Click **Use Expired** (or pick another retired status), or correct the Expiry Date." },
];
