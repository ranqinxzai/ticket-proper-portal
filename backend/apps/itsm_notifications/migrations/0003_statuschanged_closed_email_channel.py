"""Add the email channel to existing StatusChanged/Closed notification rules.

The portal has no in-app inbox, so email is the only channel a requestor actually
sees for status movement — yet these two rules were seeded in_app-only (and seed
`run()` uses get_or_create, so changing DEFAULT_RULES alone never reaches existing
schemes: neither the global default nor the per-project clones). Additive only:
rules an admin deactivated stay deactivated, recipients are untouched, and rules
that already list email are left as-is.
"""

from django.db import migrations

EVENTS = ("StatusChanged", "Closed")


def add_email_channel(apps, schema_editor):
    NotificationRule = apps.get_model("itsm_notifications", "NotificationRule")
    for rule in NotificationRule.objects.filter(event_type__in=EVENTS, is_deleted=False):
        channels = list(rule.channels or [])
        if "email" not in channels:
            channels.append("email")
            rule.channels = channels
            rule.save(update_fields=["channels"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_notifications", "0002_notificationoutbox_rendered_html"),
    ]

    operations = [
        migrations.RunPython(add_email_channel, migrations.RunPython.noop),
    ]
