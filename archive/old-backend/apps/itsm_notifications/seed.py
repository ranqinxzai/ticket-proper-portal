"""Seed the default notification scheme + rules + email templates."""

from __future__ import annotations

# event_type: (recipients, channels)
DEFAULT_RULES = [
    ("TicketCreated", ["assigned_group", "requestor"], ["in_app", "email"]),
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

TEMPLATES = [
    ("Ticket Created", "TicketCreated", "[{{ ticket.number }}] New ticket: {{ ticket.summary }}",
     "A new ticket {{ ticket.number }} was created.\nPriority: {{ ticket.priority }}\n{{ ticket.url }}"),
    ("Ticket Assigned", "Assigned", "[{{ ticket.number }}] Assigned to you: {{ ticket.summary }}",
     "{{ ticket.number }} has been assigned to you.\n{{ ticket.url }}"),
    ("Comment Added", "CommentAdded", "[{{ ticket.number }}] New comment on {{ ticket.summary }}",
     "{{ actor }} commented on {{ ticket.number }}.\n{{ ticket.url }}"),
    ("Ticket Resolved", "Resolved", "[{{ ticket.number }}] Resolved: {{ ticket.summary }}",
     "{{ ticket.number }} has been resolved.\n{{ ticket.url }}"),
    ("SLA Breach", "SLABreach", "[{{ ticket.number }}] SLA breached",
     "SLA breached on {{ ticket.number }} ({{ ticket.summary }}).\n{{ ticket.url }}"),
]


def run():
    from .models import EmailTemplate, NotificationRule, NotificationScheme

    tpls = {}
    for name, event, subject, body in TEMPLATES:
        t, _ = EmailTemplate.objects.get_or_create(
            name=name, defaults={"event_type": event, "subject_template": subject,
                                 "body_text_template": body, "is_system": True}
        )
        tpls[event] = t

    scheme, _ = NotificationScheme.objects.get_or_create(
        name="Default Notification Scheme", defaults={"is_default": True,
                                                      "description": "Out-of-box notifications."}
    )
    for event, recipients, channels in DEFAULT_RULES:
        NotificationRule.objects.get_or_create(
            scheme=scheme, event_type=event,
            defaults={"recipients": recipients, "channels": channels,
                      "email_template": tpls.get(event), "is_active": True},
        )
    return {"scheme": scheme.name, "rules": len(DEFAULT_RULES), "templates": len(TEMPLATES)}
