from datetime import timedelta

from django.db import migrations, models
from django.db.models import ExpressionWrapper, F
from django.db.models.functions import Coalesce
import django.utils.timezone


def backfill_connected_at(apps, schema_editor):
    """Existing mailboxes start from their last poll (minus the same 15-min margin
    the poller uses when re-anchoring) — everything before it has already been
    looked at, so nothing is lost and nothing old is re-read. A never-polled
    mailbox starts from when it was created."""
    EmailChannel = apps.get_model("itsm_email", "EmailChannel")
    last_poll = ExpressionWrapper(F("last_polled_at") - timedelta(minutes=15),
                                  output_field=models.DateTimeField())
    EmailChannel.objects.update(connected_at=Coalesce(last_poll, F("created_at")))


class Migration(migrations.Migration):
    """Ingest floor + UIDVALIDITY for the IMAP cursor.

    ``uid_validity`` lands NULL, so each existing IMAP mailbox re-anchors its
    cursor on its first poll after deploy (cheap: a server-side SINCE search
    from ``connected_at``). That also repairs any cursor left over from a
    previous mailbox address.
    """

    dependencies = [
        ("itsm_email", "0008_emailchannel_signature_stripping"),
    ]

    operations = [
        migrations.AddField(
            model_name="emailchannel",
            name="connected_at",
            field=models.DateTimeField(
                default=django.utils.timezone.now,
                help_text="Only mail that arrived at or after this moment is ingested.",
            ),
        ),
        migrations.AddField(
            model_name="emailchannel",
            name="uid_validity",
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_connected_at, migrations.RunPython.noop),
    ]
