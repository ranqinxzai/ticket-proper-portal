"""Seed canned-note categories/notes and example ticket templates."""

from __future__ import annotations

from apps.itsm_core.services.html import html_to_text

CANNED = [
    ("Triage", "Awaiting User Response", "<p>We're awaiting your response to proceed. "
     "Please reply with the requested details.</p>", "awaiting"),
    ("Resolution", "Ticket Resolved", "<p>This issue has been resolved. We'll close the ticket "
     "shortly unless you let us know otherwise.</p>", "resolved"),
    ("How-to", "VPN Troubleshooting", "<p>1. Disconnect and reconnect the VPN client.<br>"
     "2. Confirm your credentials.<br>3. Restart your device and retry.</p>", "vpn"),
    ("How-to", "Password Reset Steps", "<p>1. Go to the self-service portal.<br>"
     "2. Click 'Forgot password'.<br>3. Follow the emailed link.</p>", "pwreset"),
]

# project_type, name, ticket_type_key, priority, summary, field_defaults.
# Seeded into EACH helpdesk's matching (incident / service_request) project.
TEMPLATES = [
    ("incident", "Printer Not Working", "incident", "high", "Printer not working — {location}",
     {"category": "hardware"}),
    ("incident", "VPN Issue", "incident", "high", "VPN connection issue",
     {"category": "network"}),
    ("service_request", "New User Access Request", "service_request", "medium",
     "New user access request", {}),
]


def run():
    from apps.itsm_helpdesks.models import Helpdesk
    from apps.itsm_projects.models import Project, TicketType

    from .models import CannedNote, CannedNoteCategory, TicketTemplate

    cats = {}
    for cat_name, title, body, shortcut in CANNED:
        cat = cats.get(cat_name)
        if cat is None:
            cat, _ = CannedNoteCategory.objects.get_or_create(name=cat_name)
            cats[cat_name] = cat
        CannedNote.objects.get_or_create(
            title=title,
            defaults={"category": cat, "body_html": body, "body_text": html_to_text(body),
                      "shortcut": shortcut, "is_shared": True},
        )

    made = 0
    helpdesks = list(Helpdesk.objects.filter(is_deleted=False, status="active"))
    for hd in helpdesks:
        for project_type, name, tt_key, priority, summary, defaults in TEMPLATES:
            project = Project.objects.filter(
                helpdesk=hd, project_type=project_type, is_deleted=False
            ).first()
            if project is None:
                continue
            tt = TicketType.objects.filter(project=project, key=tt_key).first()
            _, created = TicketTemplate.objects.get_or_create(
                name=name, project=project,
                defaults={"ticket_type": tt, "default_priority": priority,
                          "summary_template": summary, "field_defaults": defaults,
                          "is_active": True},
            )
            made += int(created)
    return {"canned_notes": len(CANNED),
            "templates": len(helpdesks) * len(TEMPLATES), "created": made}
