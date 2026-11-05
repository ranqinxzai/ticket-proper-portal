"""Approval + watcher notification events (G4 / U13, 2026-10-18).

1. Adds ApprovalRequested / ApprovalGranted / ApprovalRejected / ApprovalCancelled /
   WatcherAdded to the event choices.
2. Data (per tenant schema, additive + idempotent):
   - upserts the 5 system email templates;
   - adds the 5 rules to the global default scheme when missing;
   - adds each missing rule to every project scheme, with a project-owned template
     copy (same as ``seed.ensure_notification_scheme``).
   Existing rules are never touched. ApprovalCancelled is created switched off.

The template/rule content is a frozen copy of ``seed.py`` (migrations must not
import app code that can change later); keep both in sync for new orgs.
"""

from django.db import migrations, models

EVENT_CHOICES = [
    ("TicketCreated", "Ticket Created"),
    ("TicketUpdated", "Ticket Updated"),
    ("StatusChanged", "Status Changed"),
    ("Assigned", "Assigned"),
    ("CommentAdded", "Comment Added"),
    ("CommentAddedPrivate", "Internal Comment Added"),
    ("Mentioned", "Mentioned"),
    ("WatcherAdded", "Watcher Added"),
    ("Resolved", "Resolved"),
    ("Closed", "Closed"),
    ("ApprovalRequested", "Approval Requested"),
    ("ApprovalGranted", "Approval Granted"),
    ("ApprovalRejected", "Approval Rejected"),
    ("ApprovalCancelled", "Approval Cancelled"),
    ("SLAWarning", "SLA Warning"),
    ("SLABreach", "SLA Breach"),
]


def _p(*paragraphs):
    return "".join(f"<p>{p}</p>" for p in paragraphs)


# event: (template name, subject, text, html, recipients, channels, is_active)
NEW_EVENTS = {
    "ApprovalRequested": (
        "Approval Requested",
        "[{{ ticket.number }}] Approval needed: {{ ticket.summary }}",
        "{{ ticket.number }} needs your approval: {{ ticket.summary }}\n"
        "Approve or reject it here: {{ approvals_url }}\nView the request: {{ ticket.url }}",
        _p("This request needs your approval before work can continue.",
           "Review the details below, then approve or reject it from your approvals."),
        ["approvers"], ["in_app", "email"], True,
    ),
    "ApprovalGranted": (
        "Approval Granted",
        "[{{ ticket.number }}] Approved: {{ ticket.summary }}",
        "{{ ticket.number }} has been approved by {{ approval.decided_by }}.\n{{ ticket.url }}",
        _p("This request has been approved by <strong>{{ approval.decided_by }}</strong>. "
           "Work on it can now continue."),
        ["requestor", "assignee"], ["in_app", "email"], True,
    ),
    "ApprovalRejected": (
        "Approval Rejected",
        "[{{ ticket.number }}] Request rejected: {{ ticket.summary }}",
        "{{ ticket.number }} was rejected by {{ approval.decided_by }}.\n"
        "Reason: {{ approval.reason_text }}\n{{ ticket.url }}",
        _p("This request was rejected by <strong>{{ approval.decided_by }}</strong>.",
           "<strong>Reason:</strong> {{ approval.reason_text }}",
           "No further work will be done on it. If it's still needed, you can raise a new request."),
        ["requestor", "assignee"], ["in_app", "email"], True,
    ),
    "ApprovalCancelled": (
        "Approval Cancelled",
        "[{{ ticket.number }}] Approval cancelled: {{ ticket.summary }}",
        "The pending approval on {{ ticket.number }} was cancelled.\n{{ ticket.url }}",
        _p("The pending approval on this ticket was cancelled, for example because the ticket "
           "moved to another project. Nobody needs to approve it any more."),
        ["requestor", "assignee"], ["in_app"], False,
    ),
    "WatcherAdded": (
        "Watcher Added",
        "[{{ ticket.number }}] You're now watching: {{ ticket.summary }}",
        "{{ actor }} added you as a watcher on {{ ticket.number }}.\n{{ ticket.url }}",
        _p("<strong>{{ actor }}</strong> added you as a watcher on this ticket. You'll get an "
           "email when its status changes or someone replies."),
        ["added_watcher"], ["in_app", "email"], True,
    ),
}


def add_events(apps, schema_editor):
    EmailTemplate = apps.get_model("itsm_notifications", "EmailTemplate")
    NotificationScheme = apps.get_model("itsm_notifications", "NotificationScheme")
    NotificationRule = apps.get_model("itsm_notifications", "NotificationRule")

    system = {}
    for event, (name, subject, text, html, _r, _c, _a) in NEW_EVENTS.items():
        tpl = EmailTemplate.objects.filter(name=name, is_system=True, is_deleted=False).first()
        if tpl is None:
            tpl = EmailTemplate.objects.create(
                name=name, event_type=event, subject_template=subject,
                body_text_template=text, body_html_template=html, is_system=True,
            )
        system[event] = tpl

    def has_rule(scheme, event):
        return NotificationRule.objects.filter(
            scheme=scheme, event_type=event, is_deleted=False).exists()

    for scheme in NotificationScheme.objects.filter(is_deleted=False):
        project = None
        if scheme.project_id:
            Project = apps.get_model("itsm_projects", "Project")
            project = Project.objects.filter(pk=scheme.project_id).first()
        elif not scheme.is_default:
            continue  # an orphan non-default scheme: leave it alone
        for event, (name, subject, text, html, recipients, channels, active) in NEW_EVENTS.items():
            if has_rule(scheme, event):
                continue
            if project is None:
                tpl = system[event]
            else:
                tpl = EmailTemplate.objects.create(
                    name=f"{project.key} — {name}", event_type=event,
                    subject_template=subject, body_text_template=text,
                    body_html_template=html, is_system=False,
                )
            NotificationRule.objects.create(
                scheme=scheme, event_type=event, recipients=list(recipients),
                channels=list(channels), email_template=tpl, notify_actor=False,
                is_active=active,
            )


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_notifications", "0003_statuschanged_closed_email_channel"),
        ("itsm_projects", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="emailtemplate",
            name="event_type",
            field=models.CharField(blank=True, choices=EVENT_CHOICES, default="", max_length=40),
        ),
        migrations.AlterField(
            model_name="notificationrule",
            name="event_type",
            field=models.CharField(choices=EVENT_CHOICES, max_length=40),
        ),
        migrations.RunPython(add_events, migrations.RunPython.noop),
    ]
