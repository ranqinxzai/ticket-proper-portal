# G6 search: KB article full-text + title trigram GIN indexes.

import django.contrib.postgres.indexes
import django.contrib.postgres.search
import django.db.models.functions.text
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_knowledge', '0001_initial'),
        # pg_trgm (gin_trgm_ops) is installed in public by itsm_tickets/0011.
        ('itsm_tickets', '0011_search'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='article',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.search.SearchVector('title', 'summary', django.db.models.functions.text.Left('body_text', 100000), config='english'), name='itsm_kb_article_fts'),
        ),
        migrations.AddIndex(
            model_name='article',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.indexes.OpClass(django.db.models.functions.text.Upper('title'), name='gin_trgm_ops'), name='itsm_kb_title_trgm'),
        ),
    ]
