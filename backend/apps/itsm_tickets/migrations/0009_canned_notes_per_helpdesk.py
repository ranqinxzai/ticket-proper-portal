"""Re-pin the seeded canned-response library to each helpdesk (existing tenants).

Migration 0008 seeded the library as **org-wide** notes (``helpdesk=NULL``). But
canned responses are managed per-helpdesk — the settings UI and the composer
picker both list with ``?helpdesk=<id>`` (an exact match), so a ``helpdesk=NULL``
note is invisible in every one of those surfaces (an org's canned-responses page
shows "No canned responses yet" despite the rows existing). The original 4-note
seed had the same latent problem.

This migration fixes already-seeded schemas: it drops the communal null-helpdesk
seed notes, then recreates the library **once per active helpdesk** via the
shared ``seed.seed_canned_notes`` builder (the same code new tenants run).

Per-schema under ``migrate_schemas`` and idempotent. On a freshly created schema
this runs *before* ``seed_itsm``, so there are no helpdesks yet and no null seed
notes to drop — it's a no-op and ``seed.run`` does the real per-helpdesk seeding
later. Only shared, unowned notes matching a seeded title are dropped, so a
personal note or a helpdesk-pinned note an agent made is never touched.
"""

from django.db import migrations

from apps.itsm_core.services.html import html_to_text
from apps.itsm_tickets.seed import CANNED, seed_canned_notes

_SEEDED_TITLES = [title for _cat, title, _body, _sc in CANNED]


def repin_to_helpdesks(apps, schema_editor):
    CannedNoteCategory = apps.get_model("itsm_tickets", "CannedNoteCategory")
    CannedNote = apps.get_model("itsm_tickets", "CannedNote")
    Helpdesk = apps.get_model("itsm_helpdesks", "Helpdesk")

    # Drop the invisible org-wide seed notes (communal + unowned + our titles).
    CannedNote.objects.filter(
        title__in=_SEEDED_TITLES, helpdesk__isnull=True, is_shared=True, owner__isnull=True,
    ).delete()

    # Recreate the library pinned per active helpdesk (idempotent).
    seed_canned_notes(CannedNote, CannedNoteCategory, Helpdesk, to_text=html_to_text)


def unpin(apps, schema_editor):
    """Best-effort reverse: remove the per-helpdesk seed notes we created. The
    dropped null-helpdesk notes are not resurrected (the forward step is lossy)."""
    CannedNote = apps.get_model("itsm_tickets", "CannedNote")
    CannedNote.objects.filter(
        title__in=_SEEDED_TITLES, helpdesk__isnull=False, is_shared=True, owner__isnull=True,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_tickets", "0008_seed_canned_responses"),
        ("itsm_helpdesks", "0003_helpdesk_notification_from"),
    ]

    operations = [
        migrations.RunPython(repin_to_helpdesks, unpin),
    ]
