from django.db import migrations, models


class Migration(migrations.Migration):
    """Per-mailbox signature stripping.

    Both fields land at their model defaults (off / empty), so every existing
    mailbox keeps its current behaviour until an admin opts in from
    Settings → Email → Processing. No data migration is needed.
    """

    dependencies = [
        ("itsm_email", "0007_email_allowed_projects"),
    ]

    operations = [
        migrations.AddField(
            model_name="emailchannel",
            name="strip_signatures",
            field=models.BooleanField(
                default=False,
                help_text="Cut the sender's signature block off the ticket description and "
                          "reply comments. Opt-in: review a few tickets before enabling.",
            ),
        ),
        migrations.AddField(
            model_name="emailchannel",
            name="signature_markers",
            field=models.JSONField(
                blank=True, default=list,
                help_text="Extra sign-off phrases that start a signature, e.g. "
                          "[\"Thanks & Regards\", \"Best Regards\"]. Matched case-insensitively "
                          "against a whole line, on top of the built-in detection.",
            ),
        ),
    ]
