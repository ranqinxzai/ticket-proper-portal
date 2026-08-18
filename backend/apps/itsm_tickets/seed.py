"""Seed canned-note categories/notes and example ticket templates.

The ``CANNED`` list below is the single source of truth for the starter
canned-response library. NEW tenants get it from ``run()`` at provision time
(``seed_itsm`` → idempotent get_or_create by title). EXISTING tenants get the
same list backfilled by migration ``0008_seed_canned_responses``, which imports
``CANNED``/``CATEGORY_ORDER`` from here so the two never drift.
"""

from __future__ import annotations

from apps.itsm_core.services.html import html_to_text

# Category display order for the picker (name → sort_order). Categories not
# listed fall back to 0 and sort alphabetically after the ordered ones.
CATEGORY_ORDER = {
    "Acknowledgement": 10,
    "Triage": 20,
    "How-to": 30,
    "Access & Accounts": 40,
    "Escalation": 50,
    "Resolution": 60,
    "Closure": 70,
    "Follow-up": 80,
}

# (category, title, body_html, shortcut). Ready-to-send professional replies;
# `body_text` is derived from `body_html` at seed time. Shortcuts are the
# "/slash" triggers agents type in the composer, so they must stay unique.
CANNED = [
    # ── Acknowledgement ─────────────────────────────────────────────────────
    ("Acknowledgement", "Ticket Received",
     "<p>Hi,</p><p>Thanks for getting in touch. We've logged your request and a "
     "member of our support team will review it and follow up shortly. You can "
     "reply to this message at any time to add more detail.</p>"
     "<p>Kind regards,<br>Support Team</p>", "received"),
    ("Acknowledgement", "Now Assigned",
     "<p>Good news — your ticket has been assigned to one of our agents and is now "
     "being worked on. We'll keep you updated as we make progress.</p>", "assigned"),

    # ── Triage ──────────────────────────────────────────────────────────────
    ("Triage", "Awaiting User Response",
     "<p>We're awaiting your response to proceed. Please reply with the requested "
     "details.</p>", "awaiting"),
    ("Triage", "More Information Needed",
     "<p>Hi,</p><p>To investigate this further we need a little more information. "
     "Could you please share:</p><ul><li>What you were trying to do</li>"
     "<li>The exact error message (if any)</li><li>When it started happening</li></ul>"
     "<p>Thanks — this will help us get you a fix faster.</p>", "moreinfo"),
    ("Triage", "Please Send Screenshots or Logs",
     "<p>Would you be able to attach a screenshot of the issue (and any error "
     "message shown)? If it's an application problem, the relevant log file would "
     "help us pinpoint the cause. You can drag files straight into your reply.</p>",
     "logs"),

    # ── How-to ──────────────────────────────────────────────────────────────
    ("How-to", "VPN Troubleshooting",
     "<p>1. Disconnect and reconnect the VPN client.<br>"
     "2. Confirm your credentials.<br>3. Restart your device and retry.</p>", "vpn"),
    ("How-to", "Password Reset Steps",
     "<p>1. Go to the self-service portal.<br>2. Click 'Forgot password'.<br>"
     "3. Follow the emailed link.</p>", "pwreset"),
    ("How-to", "Multi-Factor Authentication Setup",
     "<p>To set up MFA:</p><ol><li>Install an authenticator app (e.g. Microsoft "
     "Authenticator or Google Authenticator).</li><li>Sign in and open your "
     "security settings.</li><li>Choose 'Add sign-in method' and scan the QR "
     "code.</li><li>Enter the 6-digit code to confirm.</li></ol>", "mfa"),
    ("How-to", "Email Setup on Mobile",
     "<p>To add your work email to your phone, use the built-in Mail app and "
     "choose the Exchange/Office 365 option, then sign in with your work address "
     "and password. Approve the MFA prompt if asked. Your mail, calendar and "
     "contacts will sync automatically.</p>", "emailsetup"),
    ("How-to", "Clear Browser Cache",
     "<p>Many web issues clear up after a cache reset:</p><ol><li>Press "
     "<strong>Ctrl+Shift+Delete</strong> (Cmd+Shift+Delete on Mac).</li>"
     "<li>Select 'Cached images and files'.</li><li>Clear, then reopen the "
     "browser and try again.</li></ol>", "cache"),

    # ── Access & Accounts ───────────────────────────────────────────────────
    ("Access & Accounts", "Access Granted",
     "<p>Your access request has been approved and applied. Please sign out and "
     "back in for the change to take effect. Let us know if anything still looks "
     "off.</p>", "accessok"),
    ("Access & Accounts", "Approval Required for Access",
     "<p>Thanks for your request. Access to this resource needs manager approval "
     "before we can proceed. We've routed it for sign-off and will action it as "
     "soon as approval comes through.</p>", "approval"),
    ("Access & Accounts", "Account Unlocked",
     "<p>Your account has been unlocked. You should be able to sign in now. If you "
     "were locked out after too many attempts, consider resetting your password to "
     "avoid it happening again.</p>", "unlocked"),

    # ── Escalation ──────────────────────────────────────────────────────────
    ("Escalation", "Escalated to Specialist Team",
     "<p>We've escalated your ticket to our specialist team for a closer look. "
     "They'll pick this up and reach out with next steps. Thanks for your "
     "patience while we get you the right expertise.</p>", "escalated"),
    ("Escalation", "Known Issue — Fix in Progress",
     "<p>Thanks for reporting this. It relates to a known issue our team is "
     "already working to resolve. We've linked your ticket to the fix and will "
     "notify you the moment service is restored.</p>", "knownissue"),

    # ── Resolution ──────────────────────────────────────────────────────────
    ("Resolution", "Ticket Resolved",
     "<p>This issue has been resolved. We'll close the ticket shortly unless you "
     "let us know otherwise.</p>", "resolved"),
    ("Resolution", "Workaround Provided",
     "<p>While we work on a permanent fix, here's a workaround you can use in the "
     "meantime. We'll keep this ticket open and update you once the underlying "
     "issue is fully resolved.</p>", "workaround"),
    ("Resolution", "Resolved — Please Confirm",
     "<p>We believe this is now fixed. Could you please confirm everything is "
     "working as expected on your side? If we don't hear back within a few days "
     "we'll assume all is well and close the ticket.</p>", "confirm"),

    # ── Closure ─────────────────────────────────────────────────────────────
    ("Closure", "Closing Due to Inactivity",
     "<p>We haven't heard back, so we're closing this ticket for now. No problem "
     "at all if you still need help — just reply here and it will reopen "
     "automatically.</p>", "autoclose"),
    ("Closure", "Ticket Closed",
     "<p>This ticket is now closed. Thanks for working with us. If a related "
     "issue comes up, feel free to raise a new request any time.</p>", "closed"),

    # ── Follow-up ───────────────────────────────────────────────────────────
    ("Follow-up", "Checking In",
     "<p>Just checking in on this one. Are you still experiencing the issue, or "
     "is it safe for us to close the ticket? Happy to keep helping either way.</p>",
     "checkin"),
    ("Follow-up", "Scheduled Maintenance Notice",
     "<p>Please note there is planned maintenance during which this service may be "
     "briefly unavailable. No action is needed on your part; we'll confirm once "
     "everything is back to normal.</p>", "maintenance"),
    ("Follow-up", "Apology for the Delay",
     "<p>Apologies for the delay in getting back to you — thanks for your "
     "patience. Your ticket has our attention and we're working to resolve it as "
     "quickly as we can.</p>", "apology"),
]

# project_type, name, ticket_type_key, priority, summary, field_defaults.
# Seeded into EACH helpdesk's matching (incident / service_request) project.
TEMPLATES = [
    ("incident", "Printer Not Working", "incident", "p2", "Printer not working — {location}",
     {"category": "hardware"}),
    ("incident", "VPN Issue", "incident", "p2", "VPN connection issue",
     {"category": "network"}),
    ("service_request", "New User Access Request", "service_request", "p3",
     "New user access request", {}),
    # Lands only in helpdesks that imported the Problem project (the loop skips
    # helpdesks without a matching project_type).
    ("problem", "Recurring Incident Investigation", "problem", "p3",
     "Recurring incident investigation — {service}", {}),
]


def seed_canned_notes(CannedNote, CannedNoteCategory, Helpdesk, *, to_text=html_to_text):
    """Seed the canned-note library, pinned **once per active helpdesk**.

    Canned responses are managed per-helpdesk (the settings UI and the composer
    picker both filter by ``?helpdesk=<id>``), so a note must carry
    ``helpdesk=<hd>`` to be visible there — an org-wide ``helpdesk=NULL`` note
    never shows in those surfaces. We therefore create the whole library for
    each active helpdesk. Categories stay global (no helpdesk FK).

    Works with either the live models or historical (``apps.get_model``) ones,
    so the seed and the data migrations share this single implementation.
    Idempotent: notes keyed on ``(title, helpdesk)``; categories on ``name``.
    Returns ``(notes_created, helpdesk_count)``.
    """
    cats = {}

    def _category(name):
        cat = cats.get(name)
        if cat is None:
            # update_or_create so a category that pre-dates CATEGORY_ORDER (the
            # original Triage/Resolution/How-to seed) still gets its intended
            # sort_order on a re-seed, not left stuck at the old value.
            cat, _ = CannedNoteCategory.objects.update_or_create(
                name=name, defaults={"sort_order": CATEGORY_ORDER.get(name, 0)},
            )
            cats[name] = cat
        return cat

    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    created = 0
    for hd in helpdesks:
        for cat_name, title, body, shortcut in CANNED:
            _, was_created = CannedNote.objects.get_or_create(
                title=title, helpdesk=hd,
                defaults={"category": _category(cat_name), "body_html": body,
                          "body_text": to_text(body), "shortcut": shortcut,
                          "scope": "workspace", "is_shared": True},
            )
            created += int(was_created)
    return created, len(helpdesks)


def ensure_ticket_templates(project):
    """Idempotently seed the starter TicketTemplates whose ``project_type``
    matches `project`. Used by ``run()`` (per helpdesk) AND the standard-project
    import (`itsm_projects.standard_projects`) so an imported project reaches
    parity with a seeded one. Returns the number created."""
    from apps.itsm_projects.models import TicketType

    from .models import TicketTemplate

    made = 0
    for project_type, name, tt_key, priority, summary, defaults in TEMPLATES:
        if project_type != project.project_type:
            continue
        tt = TicketType.objects.filter(project=project, key=tt_key).first()
        _, created = TicketTemplate.objects.get_or_create(
            name=name, project=project,
            defaults={"ticket_type": tt, "default_priority": priority,
                      "summary_template": summary, "field_defaults": defaults,
                      "is_active": True},
        )
        made += int(created)
    return made


def run():
    from apps.itsm_helpdesks.models import Helpdesk
    from apps.itsm_projects.models import Project

    from .models import CannedNote, CannedNoteCategory

    notes_made, hd_count = seed_canned_notes(CannedNote, CannedNoteCategory, Helpdesk)

    made = 0
    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    for hd in helpdesks:
        seen_types = set()
        for project_type, *_rest in TEMPLATES:
            if project_type in seen_types:
                continue
            seen_types.add(project_type)
            project = Project.objects.filter(
                helpdesk=hd, project_type=project_type, is_deleted=False
            ).first()
            if project is None:
                continue
            made += ensure_ticket_templates(project)
    return {"canned_notes": len(CANNED) * hd_count, "canned_created": notes_made,
            "templates": len(helpdesks) * len(TEMPLATES), "created": made}
