# Generated for per-transition field-condition validators (Transition.field_conditions).
# JIRA-style "block with a custom message" rules: each item is
#   {field_key, operator, value?, message}  (operators: is_not_empty|is_empty|equals|not_equals)
# Enforced in the engine (services/engine.py::_check_field_conditions) after mandatory-field
# validation and before post-functions; unlike `conditions` the transition stays VISIBLE.
# Non-destructive: default=list backfills every existing Transition row with []. Per tenant.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_workflows', '0006_priority_p_scale'),
    ]

    operations = [
        migrations.AddField(
            model_name='transition',
            name='field_conditions',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
