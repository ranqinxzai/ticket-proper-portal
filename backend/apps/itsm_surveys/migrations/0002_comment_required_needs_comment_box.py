"""B6 (2026-10-18): a survey with "Require a comment" on but the comment box off
could never be submitted. Clear ``comment_required`` wherever ``comment_enabled``
is off. Idempotent; touches only the impossible combination."""

from django.db import migrations


def fix(apps, schema_editor):
    SurveyConfig = apps.get_model("itsm_surveys", "SurveyConfig")
    SurveyConfig.objects.filter(comment_enabled=False, comment_required=True).update(
        comment_required=False)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_surveys", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(fix, migrations.RunPython.noop),
    ]
