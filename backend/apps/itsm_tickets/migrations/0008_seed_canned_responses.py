"""Backfill the starter canned-response library into existing tenants.

New tenants get these from ``apps.itsm_tickets.seed.run`` at provision time
(``seed_itsm``). This migration seeds the *same* list into already-provisioned
schemas so existing orgs gain the expanded library on the next
``migrate_schemas`` run.

The data comes straight from ``seed.CANNED`` / ``seed.CATEGORY_ORDER`` — the one
source of truth — so the two paths can never drift. Importing the seed module is
safe here: it only pulls in the pure ``html_to_text`` helper at module load
(its model imports are deferred inside ``run()``).

Idempotent and runs per-schema under ``migrate_schemas`` (RunPython executes
inside each tenant schema). On a freshly created schema this runs *before*
``seed_itsm``; it creates the notes, then ``seed.run``'s get_or_create finds them
and is a no-op — so there's no duplication either way. Matching is by title, so
notes an org has already renamed/edited are left untouched.
"""

from django.db import migrations

from apps.itsm_core.services.html import html_to_text
from apps.itsm_tickets.seed import CANNED, CATEGORY_ORDER

# Titles we own, so the reverse can remove exactly what we added.
_SEEDED_TITLES = [title for _cat, title, _body, _sc in CANNED]


def seed_canned_responses(apps, schema_editor):
    CannedNoteCategory = apps.get_model("itsm_tickets", "CannedNoteCategory")
    CannedNote = apps.get_model("itsm_tickets", "CannedNote")

    cats = {}
    for cat_name, title, body, shortcut in CANNED:
        cat = cats.get(cat_name)
        if cat is None:
            # update_or_create so a category that pre-dates CATEGORY_ORDER (the
            # original Triage/Resolution/How-to seed) gets its intended sort_order
            # here too, not just on freshly created schemas.
            cat, _ = CannedNoteCategory.objects.update_or_create(
                name=cat_name,
                defaults={"sort_order": CATEGORY_ORDER.get(cat_name, 0)},
            )
            cats[cat_name] = cat
        CannedNote.objects.get_or_create(
            title=title,
            defaults={
                "category": cat,
                "body_html": body,
                "body_text": html_to_text(body),
                "shortcut": shortcut,
                "scope": "workspace",
                "is_shared": True,
            },
        )


def unseed_canned_responses(apps, schema_editor):
    """Remove the communal notes we seeded, then any seeded category left empty.

    Only workspace-shared notes matching a seeded title are touched, so a
    personal note that happens to share a title is never collateral damage.
    """
    CannedNoteCategory = apps.get_model("itsm_tickets", "CannedNoteCategory")
    CannedNote = apps.get_model("itsm_tickets", "CannedNote")

    CannedNote.objects.filter(
        title__in=_SEEDED_TITLES, is_shared=True
    ).delete()
    for cat_name in CATEGORY_ORDER:
        cat = CannedNoteCategory.objects.filter(name=cat_name).first()
        if cat is not None and not cat.notes.exists():
            cat.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_tickets", "0007_ticketnumberalias"),
    ]

    operations = [
        migrations.RunPython(seed_canned_responses, unseed_canned_responses),
    ]
