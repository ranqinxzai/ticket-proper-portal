"""Scope the field-engine unique constraints to LIVE (non-soft-deleted) rows.

Previously these were full unique constraints spanning every row, so a
soft-deleted record kept holding its slot — recreating a field/option/layout
with the same key after deleting it failed with an IntegrityError. Making the
constraints partial (``WHERE NOT is_deleted``) frees the slot on soft-delete
while still preventing duplicates among live rows. Live rows were already unique
under the old constraint, so the partial indexes build without any data fixup.
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_core", "0006_itil_incident_fields"),
    ]

    operations = [
        # FieldDefinition — (project, key)
        migrations.RemoveConstraint(model_name="fielddefinition", name="uniq_project_field_key"),
        migrations.AddConstraint(
            model_name="fielddefinition",
            constraint=models.UniqueConstraint(
                fields=("project", "key"),
                condition=models.Q(is_deleted=False),
                name="uniq_project_field_key",
            ),
        ),
        # FieldOption — (field, value)
        migrations.RemoveConstraint(model_name="fieldoption", name="uniq_field_option_value"),
        migrations.AddConstraint(
            model_name="fieldoption",
            constraint=models.UniqueConstraint(
                fields=("field", "value"),
                condition=models.Q(is_deleted=False),
                name="uniq_field_option_value",
            ),
        ),
        # FieldValue — (ticket, field)
        migrations.RemoveConstraint(model_name="fieldvalue", name="uniq_ticket_field"),
        migrations.AddConstraint(
            model_name="fieldvalue",
            constraint=models.UniqueConstraint(
                fields=("ticket", "field"),
                condition=models.Q(is_deleted=False),
                name="uniq_ticket_field",
            ),
        ),
        # FieldLayout — (project, ticket_type)
        migrations.RemoveConstraint(model_name="fieldlayout", name="uniq_project_type_layout"),
        migrations.AddConstraint(
            model_name="fieldlayout",
            constraint=models.UniqueConstraint(
                fields=("project", "ticket_type"),
                condition=models.Q(is_deleted=False),
                name="uniq_project_type_layout",
            ),
        ),
        # FieldLayoutItem — (layout, field)
        migrations.RemoveConstraint(model_name="fieldlayoutitem", name="uniq_layout_field"),
        migrations.AddConstraint(
            model_name="fieldlayoutitem",
            constraint=models.UniqueConstraint(
                fields=("layout", "field"),
                condition=models.Q(is_deleted=False),
                name="uniq_layout_field",
            ),
        ),
    ]
