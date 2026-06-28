"""Seed the default notification scheme + rules + email templates, and provision
per-project copies.

The global ``is_default`` scheme is the out-of-box library + safety fallback. Each
project gets its OWN editable clone (rules + project-owned templates) via
``ensure_notification_scheme`` so editing one project's notifications/templates
never affects another. ``backfill_notification_schemes`` provisions every existing
project (run from ``seed_itsm`` after the projects step). All idempotent.
"""

from __future__ import annotations

from django.db import transaction

# event_type: (recipients, channels)
DEFAULT_RULES = [
    ("TicketCreated", ["assigned_group", "requestor"], ["in_app", "email"]),
    ("TicketUpdated", ["requestor", "watchers"], ["in_app"]),
    ("Assigned", ["assignee"], ["in_app", "email"]),
    ("StatusChanged", ["requestor", "watchers"], ["in_app"]),
    ("CommentAdded", ["requestor", "watchers", "assignee"], ["in_app", "email"]),
    ("CommentAddedPrivate", ["assignee", "watchers"], ["in_app"]),
    ("Mentioned", ["mentioned"], ["in_app", "email"]),
    ("Resolved", ["requestor", "watchers"], ["in_app", "email"]),
    ("Closed", ["requestor", "watchers"], ["in_app"]),
    ("SLAWarning", ["assignee", "group_lead"], ["in_app", "email"]),
    ("SLABreach", ["assignee", "group_lead"], ["in_app", "email"]),
]


def _p(*paragraphs: str) -> str:
    """Wrap message lines into sanitiser-safe paragraphs. The branded shell
    (services/email_layout.py) adds the header, ticket-details card and CTA button
    at send time, so the stored body is just the per-event MESSAGE — no layout, no
    link. Keeping it to <p>/<strong> means it also survives the rich-text editor."""
    return "".join(f"<p>{p}</p>" for p in paragraphs)


# (name, event_type, subject_template, body_text_template, body_html_template).
# Every event that can send email has a template so enabling Email on any event
# renders a real subject/body instead of the generic fallback in templates.render.
# Keep the "[{{ ticket.number }}]" subject prefix on EVERY event — itsm_email
# threads inbound replies back onto the ticket via that subject token.
TEMPLATES = [
    ("Ticket Created", "TicketCreated", "[{{ ticket.number }}] New ticket: {{ ticket.summary }}",
     "Ticket {{ ticket.number }} has been logged: {{ ticket.summary }}\n"
     "Priority: {{ ticket.priority }}\n{{ ticket.url }}",
     _p("Ticket <strong>{{ ticket.number }}</strong> has been logged and added to the queue. "
        "We'll keep you updated here as it progresses.")),
    ("Ticket Updated", "TicketUpdated", "[{{ ticket.number }}] Updated: {{ ticket.summary }}",
     "{{ ticket.number }} was updated by {{ actor }}.\n{{ ticket.url }}",
     _p("<strong>{{ actor }}</strong> made an update to this ticket. The latest details are below.")),
    ("Status Changed", "StatusChanged", "[{{ ticket.number }}] Status: {{ ticket.status }}",
     "{{ ticket.number }} is now {{ ticket.status }}.\n{{ ticket.url }}",
     _p("This ticket has moved to <strong>{{ ticket.status }}</strong>.")),
    ("Ticket Assigned", "Assigned", "[{{ ticket.number }}] Assigned to you: {{ ticket.summary }}",
     "{{ ticket.number }} has been assigned to you.\n{{ ticket.url }}",
     _p("This ticket has been assigned to you. Please review the details and take it forward.")),
    ("Comment Added", "CommentAdded", "[{{ ticket.number }}] New comment on {{ ticket.summary }}",
     "{{ actor }} commented on {{ ticket.number }}.\n{{ ticket.url }}",
     _p("<strong>{{ actor }}</strong> added a comment to this ticket. "
        "Open it to read the full conversation and reply.")),
    ("Internal Comment Added", "CommentAddedPrivate", "[{{ ticket.number }}] Internal note added",
     "{{ actor }} added an internal note on {{ ticket.number }}.\n{{ ticket.url }}",
     _p("<strong>{{ actor }}</strong> added an internal note (visible to agents only) on this ticket.")),
    ("Mentioned", "Mentioned", "[{{ ticket.number }}] You were mentioned",
     "{{ actor }} mentioned you on {{ ticket.number }}.\n{{ ticket.url }}",
     _p("<strong>{{ actor }}</strong> mentioned you in a comment on this ticket. Your input is requested.")),
    ("Ticket Resolved", "Resolved", "[{{ ticket.number }}] Resolved: {{ ticket.summary }}",
     "{{ ticket.number }} has been resolved.\n{{ ticket.url }}",
     _p("Good news — this ticket has been resolved. If everything looks right, there's nothing more "
        "you need to do. If the issue persists, you can reopen it from the link below.")),
    ("Ticket Closed", "Closed", "[{{ ticket.number }}] Closed: {{ ticket.summary }}",
     "{{ ticket.number }} has been closed.\n{{ ticket.url }}",
     _p("This ticket has been closed. Thanks for working with us — if you need anything else, "
        "you can always raise a new request.")),
    ("SLA Warning", "SLAWarning", "[{{ ticket.number }}] SLA at risk: {{ ticket.summary }}",
     "SLA is at risk on {{ ticket.number }} ({{ ticket.summary }}).\n{{ ticket.url }}",
     _p("This ticket is approaching its SLA target and may breach soon. "
        "It needs attention to stay on track.")),
    ("SLA Breach", "SLABreach", "[{{ ticket.number }}] SLA breached: {{ ticket.summary }}",
     "SLA breached on {{ ticket.number }} ({{ ticket.summary }}).\n{{ ticket.url }}",
     _p("This ticket has breached its SLA target and needs immediate attention.")),
]


def run():
    """Seed/refresh the system template library + the global default scheme/rules."""
    from .models import EmailTemplate, NotificationRule, NotificationScheme

    tpls = {}
    for name, event, subject, body_text, body_html in TEMPLATES:
        # update_or_create keeps the system library fresh on re-run (admins edit the
        # per-project clones, never these system rows).
        t, _ = EmailTemplate.objects.update_or_create(
            name=name,
            defaults={"event_type": event, "subject_template": subject,
                      "body_text_template": body_text, "body_html_template": body_html,
                      "is_system": True},
        )
        tpls[event] = t

    scheme, _ = NotificationScheme.objects.get_or_create(
        name="Default Notification Scheme", defaults={"is_default": True,
                                                      "description": "Out-of-box notifications."}
    )
    for event, recipients, channels in DEFAULT_RULES:
        rule, created = NotificationRule.objects.get_or_create(
            scheme=scheme, event_type=event,
            defaults={"recipients": recipients, "channels": channels,
                      "email_template": tpls.get(event), "is_active": True},
        )
        # Backfill the template link on a pre-existing rule that predates this
        # event having a template (so per-project clones always get one).
        if not created and rule.email_template_id is None and tpls.get(event):
            rule.email_template = tpls[event]
            rule.save(update_fields=["email_template"])
    return {"scheme": scheme.name, "rules": len(DEFAULT_RULES), "templates": len(TEMPLATES)}


def ensure_notification_scheme(project):
    """Ensure `project` has its own notification scheme — a clone of the global
    default's rules + project-owned copies of its templates. Idempotent: returns the
    existing scheme if one is already present. Self-heals if the default is missing."""
    from .models import EmailTemplate, NotificationRule, NotificationScheme

    existing = NotificationScheme.objects.filter(project=project, is_deleted=False).first()
    if existing:
        return existing

    default = NotificationScheme.objects.filter(is_default=True, is_deleted=False).first()
    if default is None:  # self-heal if called before the default-scheme seed
        run()
        default = NotificationScheme.objects.filter(is_default=True, is_deleted=False).first()

    with transaction.atomic():
        scheme = NotificationScheme.objects.create(
            name=f"{project.name} Notifications", project=project,
            description="Per-project notification rules.",
        )
        tpl_cache: dict = {}  # source template id → project-owned clone
        if default is not None:
            for rule in default.rules.filter(is_deleted=False):
                tpl = None
                src = rule.email_template
                if src is not None:
                    if src.id not in tpl_cache:
                        tpl_cache[src.id] = EmailTemplate.objects.create(
                            name=f"{project.key} — {src.name}",
                            event_type=src.event_type,
                            subject_template=src.subject_template,
                            body_html_template=src.body_html_template,
                            body_text_template=src.body_text_template,
                            is_system=False,
                        )
                    tpl = tpl_cache[src.id]
                NotificationRule.objects.create(
                    scheme=scheme, event_type=rule.event_type,
                    recipients=list(rule.recipients or []),
                    channels=list(rule.channels or []),
                    email_template=tpl, notify_actor=rule.notify_actor,
                    is_active=rule.is_active,
                )
    return scheme


def backfill_email_templates():
    """Overwrite EVERY email template (system rows + per-project clones) with the
    current canonical content for its event. Idempotent; the approved rollout path
    so existing projects pick up the redesigned templates on re-seed. Match is by
    ``event_type``, which both system rows and clones carry."""
    from .models import EmailTemplate

    updated = 0
    for _name, event, subject, body_text, body_html in TEMPLATES:
        updated += EmailTemplate.objects.filter(event_type=event).update(
            subject_template=subject,
            body_text_template=body_text,
            body_html_template=body_html,
        )
    return {"templates_updated": updated}


def backfill_notification_schemes():
    """Provision a per-project scheme for every existing project. Idempotent."""
    from apps.itsm_projects.models import Project

    from .models import NotificationScheme

    projects = 0
    created = 0
    for project in Project.objects.filter(is_deleted=False):
        had = NotificationScheme.objects.filter(project=project, is_deleted=False).exists()
        ensure_notification_scheme(project)
        projects += 1
        if not had:
            created += 1
    return {"projects": projects, "schemes_created": created}
