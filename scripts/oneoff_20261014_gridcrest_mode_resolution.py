"""GridCrest one-off data/config correction (2026-10-14) — run via `manage.py shell`.

1. Mode = Email on every email-sourced ticket whose Mode isn't already Email.
2. One resolution note: retire REQ's custom value-backed "Resolution Note"
   (`resolution_note`) in favour of the global column-backed Resolution Notes
   (`resolution_notes` → Ticket.resolution_notes): repoint the Fulfil capture
   field, move the stored value onto the ticket column, soft-delete the custom
   value + definition.

Dry run by default (one transaction, rolled back); APPLY=1 commits.
"""
import os

from django.db import transaction
from django_tenants.utils import schema_context

APPLY = os.environ.get("APPLY") == "1"


class _Rollback(Exception):
    pass


with schema_context("gridcrest"):
    from apps.itsm_core.models import FieldDefinition, FieldLayoutItem, FieldValue
    from apps.itsm_core.services import fields as field_service
    from apps.itsm_core.services import log_event
    from apps.itsm_projects.models import Project
    from apps.itsm_tickets.models import Ticket
    from apps.itsm_tickets.services import ticket_service
    from apps.itsm_workflows.models import TransitionScreenField

    try:
        with transaction.atomic():
            # 1. Mode backfill (set_values logs a field_changed audit per ticket)
            mode_def = FieldDefinition.objects.get(project__isnull=True, key="mode")
            current = dict(FieldValue.objects.filter(field=mode_def)
                           .values_list("ticket_id", "value_text"))
            email_tickets = list(Ticket.objects.filter(source="email").order_by("created_at"))
            to_fix = [t for t in email_tickets if current.get(t.id) != "email"]
            for t in to_fix:
                field_service.set_values(t, {"mode": "email"}, user=None)
            after = FieldValue.objects.filter(field=mode_def, value_text="email",
                                              ticket__source="email").count()
            print(f"[mode] email tickets={len(email_tickets)} fixed={len(to_fix)} "
                  f"now_mode_email={after}")

            # 2. Resolution note consolidation
            req = Project.objects.get(key="REQ")
            old = FieldDefinition.objects.filter(project=req, key="resolution_note").first()
            moved = conflicts = 0
            for fv in (FieldValue.objects.filter(field=old).select_related("ticket")
                       if old else []):
                t, text = fv.ticket, (fv.value_text or "").strip()
                if text and not t.resolution_notes:
                    ticket_service.update_ticket(ticket=t, user=None, resolution_notes=text)
                    log_event(t, None, "field_changed", field_key="resolution_notes",
                              payload={"old": "", "new": text, "name": "Resolution Notes",
                                       "note": "moved from retired custom field 'Resolution Note'"})
                    moved += 1
                    print(f"[resolution] {t.ticket_number}: moved {text!r} -> resolution_notes")
                elif text:
                    conflicts += 1
                    print(f"[resolution] WARN {t.ticket_number} already has resolution_notes; "
                          f"custom value kept in history only: {text!r}")
                fv.soft_delete()
            repointed = 0
            for sf in TransitionScreenField.objects.filter(field_key="resolution_note"):
                print(f"[resolution] screen field {sf.id} on screen {sf.screen_id} "
                      f"(mandatory={sf.is_mandatory}) -> resolution_notes")
                sf.field_key = "resolution_notes"
                sf.save(update_fields=["field_key", "updated_at"])
                repointed += 1
            items = list(FieldLayoutItem.objects.filter(field=old)) if old else []
            for li in items:
                li.soft_delete()
            if old:
                old.soft_delete()
            print(f"[resolution] values moved={moved} conflicts={conflicts} "
                  f"screen fields repointed={repointed} layout items retired={len(items)} "
                  f"custom def retired={1 if old else 0}")
            if not APPLY:
                raise _Rollback
    except _Rollback:
        print("DRY RUN — rolled back, nothing changed (set APPLY=1 to commit)")
    else:
        print("APPLIED — committed")
