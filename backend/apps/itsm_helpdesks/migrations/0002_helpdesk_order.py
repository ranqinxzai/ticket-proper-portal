from django.db import migrations, models


def backfill_order(apps, schema_editor):
    """Give existing helpdesks a deterministic initial order (by name) so the
    admin starts from a stable sequence; admins reorder from there."""
    Helpdesk = apps.get_model("itsm_helpdesks", "Helpdesk")
    for i, hd in enumerate(Helpdesk.objects.order_by("name")):
        if hd.order != i:
            hd.order = i
            hd.save(update_fields=["order"])


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_helpdesks", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="helpdesk",
            name="order",
            field=models.IntegerField(db_index=True, default=0),
        ),
        migrations.AlterModelOptions(
            name="helpdesk",
            options={"ordering": ["order", "name"]},
        ),
        migrations.RunPython(backfill_order, migrations.RunPython.noop),
    ]
