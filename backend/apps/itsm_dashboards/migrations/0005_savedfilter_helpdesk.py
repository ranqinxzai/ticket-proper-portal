"""SavedFilter.helpdesk — the helpdesk whose All-Tickets queue a cross-project
(``project=null``) saved view belongs to (S5, 2026-10-18). Schema only; existing rows
are attributed by the separate data migration 0006 (split so the RunPython never
shares a transaction with the ALTER TABLE — see the itsm-helpdesks "pending trigger
events" gotcha)."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_dashboards", "0004_queueviewpreference"),
        ("itsm_helpdesks", "0004_helpdesk_combined_queue_columns"),
    ]

    operations = [
        migrations.AddField(
            model_name="savedfilter",
            name="helpdesk",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="saved_filters",
                to="itsm_helpdesks.helpdesk",
            ),
        ),
        migrations.AddIndex(
            model_name="savedfilter",
            index=models.Index(fields=["helpdesk"], name="itsm_savedfilter_helpdesk_idx"),
        ),
    ]
