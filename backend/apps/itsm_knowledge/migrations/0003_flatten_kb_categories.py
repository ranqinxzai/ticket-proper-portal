# B16 data repair (idempotent, per tenant schema): enforce one-level category nesting
# and clear references to soft-deleted categories. New orgs need no seed change — the
# seed only creates top-level categories.

from django.db import migrations


def flatten_categories(category_model, article_model) -> dict:
    """Repair legacy category data (used by migration 0003; idempotent).

    - articles pointing at a soft-deleted category → uncategorised;
    - live categories under a soft-deleted parent → top level;
    - deeper-than-one-level nesting (A > B > C) → re-parented to the top-most live
      ancestor (C under A); a parent cycle → top level.
    Works on historical models (plain managers that include soft-deleted rows)."""
    deleted = set(category_model.objects.filter(is_deleted=True).values_list("id", flat=True))
    stats = {"articles_uncategorised": 0, "orphans_promoted": 0, "flattened": 0}
    if deleted:
        stats["articles_uncategorised"] = article_model.objects.filter(
            category_id__in=deleted).update(category=None)
        stats["orphans_promoted"] = category_model.objects.filter(
            is_deleted=False, parent_id__in=deleted).update(parent=None)
    parent_of = dict(category_model.objects.filter(is_deleted=False).values_list("id", "parent_id"))
    for cid, pid in parent_of.items():
        if pid is None or parent_of.get(pid) is None:
            continue  # top level, or a valid one-level child
        top, seen = pid, {cid}
        while parent_of.get(top) is not None and top not in seen:
            seen.add(top)
            top = parent_of[top]
        new_parent = None if top == cid or top in seen else top
        category_model.objects.filter(pk=cid).update(parent=new_parent)
        stats["flattened"] += 1
    return stats


def forwards(apps, schema_editor):
    flatten_categories(
        apps.get_model("itsm_knowledge", "KBCategory"),
        apps.get_model("itsm_knowledge", "Article"),
    )


class Migration(migrations.Migration):

    dependencies = [
        ('itsm_knowledge', '0002_article_search_indexes'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
