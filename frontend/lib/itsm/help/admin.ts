/**
 * Hover-help copy for helpdesk-level settings (calendars, groups, helpdesk config, email),
 * tenant admin (users, roles, attributes, helpdesks, SSO, branding) and the platform console.
 *
 * Every behavioural claim here was checked against backend/apps — keep it that way: if the
 * backend changes, change the copy.
 */

// ── Business calendars (itsm_sla) ──────────────────────────────────────────

export const CALENDAR_HELP = {
  // BusinessCalendarViewSet.perform_create → services/calendars.ensure_default_hours (Mon–Fri 09–17).
  newCalendar:
    "Creates a calendar with Mon–Fri 09:00–17:00 working hours, in its own timezone. Adjust the name, timezone and hours before using it.",
  // business_time.spec_from_calendar: no windows → 24×7 (holidays still skipped) + a log warning.
  noHours:
    "This calendar has no working hours, so SLA clocks that use it run 24/7 — nights and weekends count. Add hours to fix that.",
  // sla_engine._default_calendar(): used when neither the project nor the SLA policy pins one.
  makeDefault:
    "Use this calendar for SLA clocks on projects and SLA policies that don't pick their own calendar",
  isDefault:
    "SLA clocks use this calendar whenever the project and its SLA policy don't pick a calendar of their own.",
  timezone:
    "Business hours and holidays are read in this timezone, whatever timezone the agent or requester is in.",
  holidays:
    "SLA clocks don't count time on these dates. Edits apply to new clocks; a clock already running keeps its due time until it next resumes from a pause or its priority changes.",
  addInterval: "Add another working window to this day (e.g. for a split shift or lunch break)",
  // business_time.CalendarSpec.is_holiday: same month/day every year from the entered year; 29 Feb → 28 Feb.
  recurring:
    "Skipped on the same day every year from this date on. A 29 February holiday is skipped on 28 February in other years.",
} as const;

// ── Groups (itsm_groups) ───────────────────────────────────────────────────

export const GROUP_HELP = {
  // GroupType is only stored + filterable; no service reads it.
  type: "A label for organising teams. It doesn't change how tickets are routed or assigned.",
  // Group.name / Group.key are unique=True across the whole tenant.
  name: "Must be unique across all helpdesks in the organisation.",
  key: "A short unique code for the team, unique across all helpdesks. Only lowercase letters, numbers and dashes.",
  scope: "Shared teams belong to no single helpdesk and are visible in every helpdesk. Others belong to this helpdesk only.",
  shared:
    "Shared team — visible in every helpdesk. Its details can't be edited or deleted from a helpdesk's settings, but you can manage its members here.",
  // services.resolve_assignee("group_lead") → group.lead_id; recipients.py "group_lead" → same.
  leads:
    "The primary lead receives tickets when a workflow step assigns to the group lead, and notifications addressed to the group lead. Other leads only get a Lead badge in the technician picker.",
  lead: "The primary lead — receives \"assign to group lead\" tickets and group-lead notifications",
  // members sheet role toggle does NOT change Group.lead.
  addAs:
    "Lead only adds a Lead badge in the technician picker. Round-robin and least-loaded assignment pick from leads and team members alike. The primary lead is set in Edit group.",
  setPrimary: "Make this the primary lead — receives \"assign to group lead\" tickets and group-lead notifications",
  makeLeadBadge: "Show this person with a Lead badge. Doesn't change the primary lead.",
  makeLeadForm: "Move to Leads. If there's no lead yet, this person becomes the primary lead.",
  members: "Active members are the pool for round-robin and least-loaded auto-assignment.",
} as const;

// ── Helpdesk status (itsm_helpdesks) ───────────────────────────────────────

// services.accessible_helpdesk_ids / build_helpdesk_membership filter status="active";
// views.add_member 400s on a non-active helpdesk; portal._portal_projects needs an active
// helpdesk. "inactive" and "archived" behave identically in the backend today.
export const HELPDESK_STATUS_HELP: Record<string, string> = {
  active: "Open: members can work its tickets and its projects appear in the portal.",
  inactive:
    "Hidden from everyone's Home and helpdesk switcher and from the portal. Members lose access to its tickets and no one can be added. Turn it back on from Admin → Helpdesks.",
  archived:
    "Behaves exactly like Inactive today — it just marks the helpdesk as retired. Turn it back on from Admin → Helpdesks.",
};

export const HELPDESK_STATUS_SUMMARY =
  "Active: open to its members and the portal.\nInactive / Archived: hidden from Home, the helpdesk switcher (including these settings) and the portal; members lose access to its tickets and no one can be added. The two behave the same — Archived just marks it as retired. Re-enable it (or edit its name, prefix and status) from Admin → Helpdesks. Mailboxes keep creating tickets until you turn them off.";

// ── Email: project mailboxes (itsm_email) ──────────────────────────────────

export const EMAIL_HELP = {
  // mailbox._fetch_pop: basic auth only, no folder, no \Seen.
  protocol:
    "IMAP (recommended) reads the folder below and marks processed mail as read. POP3 reads only the inbox and only supports username & password sign-in.",
  folder: "The IMAP folder to read, e.g. INBOX. Ignored for POP3.",
  copyRedirect: "Copy redirect URI",
  // transport._channel_for_ticket + outbox._resolve_delivery tier 1.
  outbound:
    "On: notifications for tickets that came in through this mailbox (or belong to its projects) are sent from this address, so replies thread back. Off — or once a send fails permanently — they go out via the helpdesk's Email Notifications sender instead.",
  // identity.resolve_or_create_user: unknown + off ⇒ channel.default_requestor.
  createUsers:
    "On: an unknown sender gets an account with no password and no role (it can't sign in) and becomes the ticket's requester. Off: the ticket's requester is the Default requestor you pick below, so the unknown sender themselves gets no updates.",
  // EmailChannelSerializer.validate: required when create_users is off (B11).
  defaultRequestor:
    "Used as the requester of tickets from senders who don't have an account yet (only while \"Create the requestor\" is off). Usually a shared account such as \"Unknown sender\". Acknowledgements and updates go to this person, not to the sender. Known senders are always matched to their own account.",
  defaultRequestorRequired:
    "Pick a default requestor, or turn on \u201cCreate the requestor\u201d. Otherwise tickets from unknown senders have no requestor and the sender gets no updates.",
  noRequestorBadge:
    "\"Create the requestor\" is off and no default requestor is set, so tickets from unknown senders get no requester and nobody receives their updates. Edit the mailbox → Field Mapping.",
  // inbound._add_cc_watchers — existing users only.
  ccWatchers:
    "CC'd people who already have an account (matched by email) are added as watchers, on new tickets and replies. Unknown addresses are skipped — no accounts are created for them.",
  // detectors.is_auto_or_bulk
  ignoreAuto:
    "Skips out-of-office replies, bounces, mailing-list and bulk mail, spam-flagged mail and mail this mailbox sent to itself. Skipped mail shows in the email log as \"auto-reply\".",
  // inbound._maybe_reopen; NEW_TICKET has no implementation.
  reopenPolicy:
    "What happens when someone replies to a resolved or closed ticket.\nComment only: the reply is added as a comment; the ticket stays closed.\nReopen: within the reopen window, the ticket moves back to an open status, then the comment is added.\nCreate a new ticket: not implemented yet — behaves like Comment only.",
  reopenNewTicketWarning:
    "Not implemented yet: replies to a closed ticket are added as a comment and the ticket stays closed.",
  reopenWindow:
    "Only used with Reopen: a reply within this many days of the ticket being resolved (or closed) reopens it; later replies are added as a comment only.",
  maxAge:
    "Mail whose Date header is older than this many days is ignored (logged as \"too old\"), e.g. a backlog found after an outage.",
  maxSize: "Whole messages larger than this, attachments included, are ignored and logged as \"too large\".",
  maxSizeHint: "Larger messages are ignored (shown in the email log).",
  maxAttachment: "Each attachment over this size is skipped; the ticket is still created and a private note lists what was skipped.",
  loopWindow:
    "Mail-loop protection: once one sender has sent \"Loop max messages\" emails within this many minutes, the rest is ignored (logged as \"mail loop\").",
  loopMax:
    "Mail-loop protection: the most emails one sender can send within the loop window. Their mail is ignored once the count is reached.",
  // poller._is_due + scheduler tick (EMAIL_POLL_INTERVAL_SECONDS, default 60).
  pollInterval:
    "How often this mailbox is checked, in seconds. Blank uses the server's poll tick (60 seconds by default). The server only checks once per tick, so a smaller value has no extra effect.",
  testInbound: "Signs in and opens the folder using the saved settings — save your changes first",
  testSmtp:
    "Signs in to the mail server with the saved settings (no mail is sent) and records whether this mailbox can send — save your changes first",
  pollNow: "Check this mailbox for new mail now",
  pollNowDetail: "Works even when the mailbox is inactive",
  defaultProject: "Where mail lands when no keyword rule matches",
  allowedProjects: "Email can never open a ticket outside these projects, even if a routing rule points elsewhere.",
  priorityMap:
    "Read from the X-Priority, Importance, X-MSMail-Priority and Priority headers, in that order. The first header with a mapping wins; otherwise the default priority is used.",
  // routing: rules apply to NEW tickets only — replies thread onto their ticket.
  routingNewOnly: "Rules only pick the project for new tickets. Replies always go to the ticket they belong to.",
  lookIn: "Which part of the email the keywords are searched in",
  matchType: "Any: one keyword is enough. All: every keyword must appear.",
  keywordsSaveOnBlur: "Saved when you leave the field. Whole words or phrases, case-insensitive, comma-separated.",
  // inbound._allowed_by_rules — runs before threading, so it applies to replies too.
  allowRules:
    "As soon as there is one Allow rule, mail from every sender that doesn't match an Allow rule is ignored — replies included. Block rules always win.",
  blockRules: "Mail from matching senders is ignored, including replies to existing tickets.",
} as const;

export const EMAIL_PROTOCOL_BADGE: Record<string, string> = {
  imap: "Fetched over IMAP",
  pop3: "Fetched over POP3",
};

// Outcome codes from itsm_email/services/inbound.py (action_taken / ignore_reason).
export const EMAIL_OUTCOME_HELP: Record<string, { label: string; help: string }> = {
  created_ticket: { label: "created ticket", help: "Opened a new ticket." },
  added_comment: { label: "added comment", help: "Threaded onto an existing ticket as a public comment." },
  blocklist: {
    label: "blocked sender",
    help: "Ignored by the mailbox's allow/block rules (Domains tab).",
  },
  auto_reply: {
    label: "auto-reply",
    help: "Ignored as an auto-reply, bounce, mailing-list/bulk or spam-flagged message.",
  },
  loop: { label: "mail loop", help: "Ignored: this sender hit the mail-loop limit (Processing tab)." },
  age: { label: "too old", help: "Ignored: the message's Date is older than the mailbox's max message age." },
  size_cap: { label: "too large", help: "Ignored: the whole message is larger than the mailbox's max message size." },
};

// InboundEmail.Status + inbound.process_inbound retry (EMAIL_MAX_INBOUND_ATTEMPTS = 5,
// backoff 10 min × attempt).
export const EMAIL_STATUS_HELP: Record<string, string> = {
  received: "Stored, but processing hasn't finished yet.",
  processed: "Turned into a new ticket or a comment.",
  ignored: "Deliberately skipped — see Outcome for why. Ignored mail is never retried.",
  failed:
    "Processing hit an error. It's retried automatically with growing delays, up to 5 attempts in total; after that use Retry processing.",
};

export const EMAIL_RETRY_HELP =
  "Runs this message through processing again from the saved copy. Only the plain-text body (first 5,000 characters) is kept, so formatting and attachments are lost.";

// ── Email: helpdesk notification sender (itsm_notifications outbox._resolve_delivery) ──

export const EMAIL_NOTIFICATION_HELP = {
  vsMailboxes:
    "Tickets that belong to a project mailbox (Settings → Email) send from that mailbox while it can send. This page sets the sender for every other notification in this helpdesk, and is the fallback whenever a mailbox can't send.",
  test: "Signs in to your mail server with the saved settings (no email is sent) and records whether it can send.",
} as const;

// ── Tenant admin: users (itsm_rbac MemberViewSet) ──────────────────────────

export const USER_HELP = {
  // check_permission: superuser bypass; no RoleAssignment ⇒ every module denied;
  // set_role("requestor") deactivates helpdesk + project memberships.
  roleColumn:
    "Each user has one ITSM role, which decides the screens and settings they can use.\n— none —: no role, so every agent screen and setting is denied.\nRequestor: portal only — choosing it also removes the user from all helpdesks and projects.\nAdministrator: an organisation admin, who bypasses role permissions entirely.",
  administrator:
    "Organisation administrator — bypasses role permissions and sees every helpdesk. Managed from the platform console.",
  ownRole: "You can't change your own role",
  // set_active: 400 on self; superusers are only blocked in this UI.
  activeSelf: "You can't deactivate your own account",
  activeAdmin: "Organisation administrators can't be deactivated here — use the platform console",
  // MemberViewSet.set_active refuses itsm_rbac.services.system_account_usernames().
  activeSystem: "System account used by email intake / automation — it can't be deactivated",
  activeNoPerm: "You don't have permission to change this",
  activeOn: "Active — can sign in. Turn off to block sign-in without deleting the account.",
  activeOff: "Inactive — can't sign in. Turn on to restore access.",
  allHelpdesks: "Administrators can open every active helpdesk",
  noHelpdesks: "Not a member of any helpdesk, so no tickets are visible",
  // itsm_projects.services.accessible_project_ids: lead ⇒ every active project of the helpdesk.
  helpdeskChip: (name: string, lead: boolean) =>
    lead
      ? `${name} — lead: sees every active project in this helpdesk`
      : `${name} — member: sees only the projects assigned to them`,
  actions: (name: string) => `Actions for ${name}`,
  // MemberViewSet.update_profile (2026-10-24)
  editDetails: "Change the person's name, email and manager. Their username (sign-in ID) stays the same.",
  // update_profile: an email another account uses (as email or username) → 400.
  email:
    "Used for notifications and to match incoming emails to this person, so no two accounts can share it. Leave it blank if they have none yet.",
  // engine.resolve_approver_ids requestor_manager → user.manager
  manager:
    "Who this person reports to. Approvals with a “Requestor's manager” stage are sent to them.",
  editSystem: "System account used by email intake / automation — it can't be edited",
  editAdmin: "Only a superuser can edit an organisation administrator's details",
} as const;

// ── Tenant admin: roles (itsm_rbac) ────────────────────────────────────────

export const ROLE_HELP = {
  // SystemRoleViewSet.destroy refuses is_system roles and roles with live assignments;
  // SystemRoleSerializer.validate locks a built-in role's code + active flag.
  builtIn:
    "Built-in role, created with the organisation. It can't be deleted or switched off, but its name and permissions can be edited.",
  cantDeleteBuiltIn: "Built-in roles can't be deleted",
  inUse: (n: number) =>
    `${n} user${n === 1 ? " still has" : "s still have"} this role (inactive users count too) — give them another role first`,
  code: "A short unique ID for the role — lowercase letters, numbers and underscores. Left blank, it is generated from the name.",
} as const;

// ── Roles & permissions matrix (itsm_rbac.registry + check_permission) ─────

/** Column-header help for the CRUD matrix. Action-style endpoints (POST) check Create. */
export const PERMISSION_ACTION_HELP: Record<"can_read" | "can_create" | "can_update" | "can_delete", string> = {
  can_read: "Read — see the screen or data. Several modules gate a whole feature on Read alone (e.g. Internal Comments, Print Ticket, Dashboards).",
  can_create:
    "Create — add new records. Actions such as Move Ticket, Bulk Operations and Retry (Email Logs) also check Create.",
  can_update: "Update — edit existing records and settings.",
  can_delete: "Delete — remove records.",
};

export const PERMISSION_GRANT_ALL_HELP = (action: string, section: string) =>
  `Tick or clear ${action} for every module in ${section}. Nothing is saved until you click Save changes.`;

/**
 * Fallback help for modules the backend seeds without a description
 * (registry.MODULE_COPY only covers some). Codes verified against registry.MODULES and
 * the module_code / hasPerm() call sites. Use as `m.description || MODULE_HELP[m.code]`.
 */
export const MODULE_HELP: Record<string, string> = {
  itsm: "The root of the permission tree. A module with no row of its own falls back to its closest ancestor.",
  "itsm.dashboard":
    "Read shows the helpdesk's Dashboard tab (otherwise agents land on All Tickets). Not the same as Dashboards (config).",
  "itsm.tickets": "Work with tickets: Read to view, Create to raise new tickets, Update to edit fields and change status.",
  "itsm.tickets.queue": "Saved filters and personal queue column/view preferences in the ticket queue.",
  // TicketViewSet.create (module override, 2026-10-18); portal/catalog/email intake not affected.
  "itsm.tickets.create":
    "Create lets the role raise tickets from the agent app (New ticket / Create menu). Portal requests use Portal Tickets; email and catalog intake aren't affected.",
  "itsm.tickets.bulk": "Change many tickets at once from the queue. Uses the Create bit.",
  "itsm.tickets.comments": "Public comments and replies on tickets.",
  "itsm.tickets.comments_private":
    "Read lets the role both see and write internal notes. Without it, only public comments are shown and can be posted.",
  "itsm.tickets.watchers": "Add and remove watchers on tickets.",
  "itsm.tickets.links": "Link and unlink related tickets.",
  "itsm.tickets.templates": "Use (and, with Create/Update/Delete, manage) ticket templates.",
  "itsm.tickets.move": "Move a ticket to another project in the same helpdesk. Uses the Create bit.",
  "itsm.tickets.print": "Read shows the Print action on a ticket.",
  "itsm.canned_notes": "Canned responses: Read to insert them, Create/Update/Delete to manage the library.",
  "itsm.workflows": "Workflows and their statuses.",
  "itsm.workflows.transitions":
    "Workflow transitions and the builder. Agents need Read here, or they can't change ticket status.",
  "itsm.fields": "Custom field definitions and their options.",
  "itsm.fields.layouts":
    "The form layout designer. Agents need Read here, or the create-ticket form can't load.",
  "itsm.sla": "SLA settings, and the SLA timers shown on tickets (Read).",
  "itsm.sla.policies": "SLA policies, targets and escalations.",
  "itsm.sla.calendars": "Business calendars — working hours and holidays (Update to edit).",
  "itsm.notifications.schemes": "Who gets notified about which ticket events.",
  "itsm.notifications.templates": "The wording of notification emails.",
  "itsm.notifications.inbox": "Not checked anywhere yet — every signed-in user has their own inbox.",
  "itsm.email": "Email channel settings.",
  "itsm.email.channels": "Project mailboxes and their routing, allow and block rules.",
  "itsm.email.logs": "The inbound email log. Create lets the role retry failed messages.",
  // itsm_reporting.views.REPORT_MODULES, checked on top of itsm.reports read.
  "itsm.reports.sla":
    "Read opens the SLA reports: SLA compliance, the SLA breach list and the dashboard's at-risk / breached lists. The role also needs Reports → Read.",
  "itsm.reports.agent":
    "Read opens the Agent performance report (and its sheet in Export all). The role also needs Reports → Read.",
  "itsm.portal": "The end-user Service Portal.",
  "itsm.portal.tickets": "Raise and follow one's own tickets in the portal (Create to raise them).",
  // itsm_rbac.permissions.CanUseApprovalInbox — my-pending / approve / reject.
  "itsm.portal.approvals":
    "Read lets the user see and act on approvals assigned to them — the Approvals inbox in the portal and the agent app. Who approves a request is still set by the approval stage. Users with no role keep their assigned approvals.",
  "itsm.admin": "Organisation-wide administration.",
  "itsm.admin.roles": "Roles & Permissions — this screen.",
  "itsm.admin.helpdesks":
    "Manage helpdesks and who belongs to them, including project access. Agents need Read to see their helpdesks.",
  "itsm.admin.sso": "Sign-in settings such as Microsoft single sign-on.",
  "itsm.admin.branding": "Company name, logo and contact details shown in the app.",
  "itsm.admin.interface":
    "Interface: Classic or Modern — the default for agents, whether they may switch, and when Classic retires.",
  "itsm.admin.audit":
    "Read opens Tenant Settings → Audit log (sign-ins, user and role changes, settings changes) and its CSV export. Admin-only by default.",
  // itsm_assets/permissions.py (Asset Management v1, 2026-10-19).
  "itsm.assets":
    "Asset Management: Read shows the Assets section (Asset Dashboard, Asset List, Asset Report and each asset's page), Create adds assets, Update edits them and Delete removes them. Only the helpdesks the user belongs to are shown.",
  "itsm.assets.import":
    "Excel import of assets: Create downloads the template and runs imports (Check only included), Read shows Import history and each import's failed records. Creating missing vendors, locations and departments during an import also needs Asset Configuration → Create.",
  "itsm.assets.config":
    "Configuration → Asset Configuration: Read views categories, detail fields, statuses, vendors, locations and departments; Create / Update / Delete change them. Statuses, vendors, locations and departments are shared by all helpdesks. The asset form's pickers work with Assets → Read alone.",
};

// ── Tenant admin: user attributes (itsm_rbac.user_attr_service) ─────────────

export const USER_ATTR_HELP = {
  required: "Must be filled in when an admin creates a user or edits their attributes.",
  showColumn:
    "Shown as a column in the Users list by default. Each admin can still show or hide it from Columns (remembered in their browser).",
  active:
    "Inactive attributes are hidden from user forms, filters and columns. Saved values are kept and come back if you turn it on again.",
  key: "Internal key, generated from the name when the attribute was created. It can't be changed here.",
  optionValue: "The stored value, generated from the label",
} as const;

// ── Tenant admin: helpdesks list (components/admin/helpdesks-admin.tsx) ────

// HelpdeskViewSet.perform_create → itsm_projects.standard_projects.import_standard_project.
export const HELPDESK_CREATE_HELP = {
  standardProjects:
    "Imports Incident Management (<prefix>INC) and Request Management (<prefix>REQ) with their workflow, fields, layout, notifications and survey — the same as Settings → Projects → Import standard project. Needs Projects → Create. If one can't be added (for example the key is taken) the helpdesk is still created and you're told why.",
} as const;

export const HELPDESK_ADMIN_HELP = {
  drag: "Drag (or focus and use Space + arrow keys) to reorder. Sets the order of helpdesk cards on everyone's Home.",
  key: (key: string) => `Ticket prefix — tickets are numbered like ${key}INC-1`,
  disable: (name: string) =>
    `Disable ${name}: hides it from Home, the helpdesk switcher and the portal, and members lose access to its tickets. Memberships are kept for when you turn it back on.`,
  enable: (name: string) =>
    `Enable ${name}: its members get access again and it shows on Home and in the portal.`,
  editInactive:
    "Edit its name, prefix, icon and status. Projects, groups and mailboxes open in its settings once it's active again.",
} as const;

// ── Platform console (backend/apps/tenants) ────────────────────────────────

export const CONSOLE_HELP = {
  // middleware: Client.objects.get(schema_name=slug, is_active=True); runtime.for_each_tenant
  // filters is_active, so scheduled jobs skip disabled orgs.
  orgActive:
    "A disabled organisation returns 404 at its URL, so nobody can sign in, and background jobs (mail polling, SLA and notification runs) skip it. Its data is kept.",
  orgEnable: (name: string) => `Enable ${name} — its URL and background jobs start working again`,
  orgDisable: (name: string) =>
    `Disable ${name} — its URL returns 404 and background jobs stop. Data is kept.`,
  // services.validate_slug + RESERVED_SLUGS
  slugRules:
    "2–31 characters: lowercase letters, digits, '-' or '_', starting with a letter. Reserved words (public, t, api, admin, console, static, media, healthz, schema, docs, auth, www) can't be used.",
  passwordMin: "At least 8 characters.",
  // views.user_detail: is_admin ⇒ is_superuser + is_staff inside the org schema.
  orgAdmin:
    "Org admin = an administrator of this organisation: bypasses every role permission, sees every helpdesk and can open Tenant Settings.",
  adminBadge: "Organisation administrator — bypasses role permissions",
  inactiveBadge: "Inactive — this user can't sign in",
  systemBadge: "A built-in system account (email-bot creates tickets from inbound mail; automation-bot runs automation rules). It can't be deleted, deactivated or made an admin — only its password can be changed.",
  userActive: "Inactive users can't sign in. Their tickets and history are kept.",
  deleteUser: (username: string) => `Delete ${username}`,
  deleteUserDetail: "Asks for confirmation. Permanently removes the account.",
  cantDeleteSystem: "System accounts (email intake / automation) can't be deleted",
  // tenants.services.org_user_guard: keep ≥1 ACTIVE superuser (inactive ones don't count).
  cantDeleteLastAdmin: "This is the organisation's only active administrator — make someone else an org admin first",
  cantDemoteLastAdmin: "This is the organisation's only active administrator — make someone else an org admin first",
  cantDeactivateLastAdmin: "This is the organisation's only active administrator — make someone else an org admin first",
  saveNeedsName: "Enter an organisation name first",
  saveBadSlug: "Fix the slug first",
  createUserNeeds: "Enter a username and a password of at least 8 characters",
  showPassword: "Show password",
  hidePassword: "Hide password",
  generate: "Fill in a strong random 16-character password and show it so you can copy it",
  copyPassword: "Copy password",
  copyEmpty: "Type or generate a password first",
  deleteOrgNeedsSlug: (slug: string) => `Type ${slug} exactly to enable this`,
} as const;

// ── Tenant admin: audit log (itsm_core.services.audit + audit_mixin) ─────────

export const AUDIT_HELP = {
  // AUDITED_AREAS in services/audit.py; ticket traffic is excluded on purpose.
  whatsRecorded:
    "Recorded: sign-ins and failed sign-ins (the username tried, IP address and browser — never the password), password changes and resets, users, roles, permissions and memberships, and changes to settings: helpdesks, projects, groups, workflows, fields and layouts, SLA policies and calendars, email channels, notification rules and templates, surveys, approval workflows, the request catalog, automation, branding and SSO.\nNot recorded here: ticket activity (see each ticket's Activity tab), personal preferences such as saved views and columns, knowledge articles, canned responses and ticket templates.",
  retention:
    "Events are kept indefinitely for now — there's no automatic clean-up yet. Secret values (passwords, client secrets, mail credentials, tokens) are never stored; a change to one shows as ••••.",
  actor:
    "Who did it. A failed sign-in has no user — the username that was typed is shown instead. Changes made by the platform operator from the provisioning console show as \"Platform admin: …\".",
  action:
    "Created / Updated / Deleted for settings; Signed in / Sign-in failed; password, role, permission, activation and membership changes; Audit log exported.",
  area: "The settings area that changed — matches the permission module that controls it. \"Sign-in & passwords\" covers authentication events.",
  ip: "The client's IP address as seen through the site's proxies. It can be a company gateway or VPN address rather than the person's own device.",
  object: "The record that changed, named as it was at the time of the change.",
  redacted: "Secret value — it's never stored in the audit log, only the fact that it changed.",
  search: "Matches the record's name or type, the username (including usernames tried at failed sign-ins) or an exact record id.",
  dates: "Dates are in your local time zone. Leave a date empty for no limit.",
  export: (cap: number) =>
    `Download the events matching these filters as CSV (newest first, up to ${cap.toLocaleString()} rows). The export itself is recorded in the log.`,
  exportEmpty: "No events match these filters",
  exportBusy: "Exporting…",
  reset: "Back to the last 30 days with no other filters",
  resetDisabled: "Filters are already at their defaults",
  expand: "Show details",
  collapse: "Hide details",
  badDates: "‘From’ is after ‘To’",
} as const;

/** Tenant Settings → Interface: Classic or Modern (2026-11-05). Written from
 *  `itsm_rbac/views.py` (InterfaceConfigAdminView / UserPreferencesView) and
 *  `lib/itsm/interface-settings.ts` (resolveUi). */
export const INTERFACE_HELP = {
  page:
    "Modern is the agent workbench (icon menu that opens on hover, page titles in the top bar, ⌘K search, tickets beside the queue, softer colours) and the default. Classic is the previous layout. Both show the same pages and data.",
  default:
    "What agents get until they choose for themselves in their profile menu (Modern unless you change it). When switching is off, everyone gets this.",
  allowSwitch:
    "On: each agent picks Classic or Modern in their profile menu, and the choice follows them to other devices. Off: everyone gets the default and the switch is hidden.",
  retire:
    "From this date Classic is gone: everyone gets Modern and the switch is hidden, even for agents who chose Classic. Leave empty to keep both. Classic can't be the default once retired.",
  usage: "Agents who chose an interface keep it until switching is turned off or Classic is retired.",
};
