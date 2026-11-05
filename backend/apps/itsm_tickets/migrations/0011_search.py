# G6 search: pg_trgm (installed WITH SCHEMA public) + trigram/full-text GIN indexes.

import django.contrib.postgres.indexes
import django.contrib.postgres.search
import django.db.models.functions.text
from django.db import migrations


def install_pg_trgm(apps, schema_editor):
    """Make sure pg_trgm lives in the PUBLIC schema.

    Extensions are database-wide but their objects live in ONE schema. This migration
    runs once per tenant schema (`migrate_schemas`) with search_path `<tenant>, public`;
    a plain `CREATE EXTENSION pg_trgm` (or Django's `TrigramExtension()`) would put the
    functions/opclasses in the FIRST tenant's schema, invisible to every other org.
    So: create it in public if absent; move it to public if an earlier install put it
    elsewhere (pg_trgm is relocatable; existing indexes keep working — they reference
    the opclass by OID). The first tenant does the work; later tenants and new orgs
    (provision_org) no-op. Skipped on the public pass (tenant app, router-gated)."""
    if schema_editor.connection.vendor != "postgresql":
        return
    try:
        from django_tenants.utils import get_public_schema_name
        public = get_public_schema_name()
    except Exception:  # pragma: no cover - django-tenants is always installed here
        public = "public"
    q = schema_editor.quote_name(public)
    schema_editor.execute(f"""
DO $$
DECLARE ext_schema text;
BEGIN
    SELECT n.nspname INTO ext_schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm';
    IF ext_schema IS NULL THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA {q};
    ELSIF ext_schema <> '{public}' THEN
        ALTER EXTENSION pg_trgm SET SCHEMA {q};
    END IF;
END
$$;
""")


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_tickets', '0010_ticket_problem_fields'),
    ]

    operations = [
        # Never dropped on reverse: other tenant schemas use the same extension.
        migrations.RunPython(install_pg_trgm, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name='comment',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.search.SearchVector(django.db.models.functions.text.Left('body_text', 100000), config='english'), name='itsm_cmt_body_fts'),
        ),
        migrations.AddIndex(
            model_name='ticket',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.indexes.OpClass(django.db.models.functions.text.Upper('ticket_number'), name='gin_trgm_ops'), name='itsm_tkt_number_trgm'),
        ),
        migrations.AddIndex(
            model_name='ticket',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.indexes.OpClass(django.db.models.functions.text.Upper('summary'), name='gin_trgm_ops'), name='itsm_tkt_summary_trgm'),
        ),
        migrations.AddIndex(
            model_name='ticket',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.indexes.OpClass(django.db.models.functions.text.Upper('description_text'), name='gin_trgm_ops'), name='itsm_tkt_desc_trgm'),
        ),
        migrations.AddIndex(
            model_name='ticket',
            index=django.contrib.postgres.indexes.GinIndex(django.contrib.postgres.search.SearchVector('summary', django.db.models.functions.text.Left('description_text', 100000), config='english'), name='itsm_tkt_search_fts'),
        ),
    ]
