# Adds FieldLayoutItem.portal_visible (end-user Service Portal visibility) and
# backfills existing layouts to preserve the prior portal behaviour: the portal used
# to hide picker fields (user/group) and assignment/source/requestor fields, so those
# items are flagged portal_visible=False; everything else stays portal_visible=True.

from django.db import migrations, models

# maps_to columns the portal never let a requestor set (server-decided).
PRIVILEGED_MAPS_TO = {"assignee", "assigned_group", "requestor", "source"}
# field types the portal form never rendered.
HIDDEN_FIELD_TYPES = {"user_picker", "group_picker"}


def backfill_portal_visible(apps, schema_editor):
    FieldLayoutItem = apps.get_model("itsm_core", "FieldLayoutItem")
    hide_ids = []
    for item in FieldLayoutItem.objects.select_related("field").all():
        field = item.field
        maps_to = (field.config or {}).get("maps_to")
        if field.field_type in HIDDEN_FIELD_TYPES or maps_to in PRIVILEGED_MAPS_TO:
            hide_ids.append(item.id)
    if hide_ids:
        FieldLayoutItem.objects.filter(id__in=hide_ids).update(portal_visible=False)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_core', '0004_fieldlayoutitem_region_fieldlayoutitem_width'),
    ]

    operations = [
        migrations.AddField(
            model_name='fieldlayoutitem',
            name='portal_visible',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(backfill_portal_visible, noop),
    ]
