import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_dashboards", "0001_initial"),
        ("itsm_projects", "0002_project_calendar"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="savedfilter",
            options={"ordering": ["sort_order", "name"]},
        ),
        migrations.AddField(
            model_name="savedfilter",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="saved_filters",
                to="itsm_projects.project",
            ),
        ),
        migrations.AddField(
            model_name="savedfilter",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddIndex(
            model_name="savedfilter",
            index=models.Index(fields=["project"], name="itsm_dashbo_project_82fa77_idx"),
        ),
    ]
