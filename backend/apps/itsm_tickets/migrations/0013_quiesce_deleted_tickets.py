"""Quiet tickets that were deleted before ``ticket_service.delete_ticket`` existed.

Until 2026-10-29 a ticket delete was a bare soft delete: its SLA clocks kept
running (the breach sweep emailed SLABreach / SLAWarning, e.g. GridCrest REQ14),
pending approvals stayed in approvers' inboxes and queued emails still went out.
This does once, for every already-deleted ticket, what ``delete_ticket`` now does
on delete:

- running / paused SLA clocks → ``stopped`` (open pause windows closed)
- pending approval requests → ``cancelled`` (no ApprovalCancelled email)
- queued / sending outbox rows → ``dead`` with "Cancelled: ticket deleted"

Bulk ``update()`` only, so nothing is emailed. Idempotent; runs per org schema
under ``migrate_schemas``. The reverse is a no-op (nothing to restore).
"""

from django.db import migrations
from django.utils import timezone

CANCELLED_TICKET_DELETED = "Cancelled: ticket deleted"  # = outbox.CANCELLED_TICKET_DELETED


def quiesce_deleted_tickets(apps, schema_editor):
    SLATracker = apps.get_model("itsm_sla", "SLATracker")
    SLAPauseInterval = apps.get_model("itsm_sla", "SLAPauseInterval")
    ApprovalRequest = apps.get_model("itsm_approvals", "ApprovalRequest")
    NotificationOutbox = apps.get_model("itsm_notifications", "NotificationOutbox")
    now = timezone.now()

    SLAPauseInterval.objects.filter(
        tracker__ticket__is_deleted=True, tracker__state="paused", resumed_at__isnull=True,
    ).update(resumed_at=now, updated_at=now)
    SLATracker.objects.filter(
        ticket__is_deleted=True, state__in=("running", "paused"),
    ).update(state="stopped", stopped_at=now, paused_at=None, updated_at=now)
    ApprovalRequest.objects.filter(ticket__is_deleted=True, status="pending").update(
        status="cancelled", decided_at=now, current_stage=None, updated_at=now,
    )
    NotificationOutbox.objects.filter(
        ticket__is_deleted=True, status__in=("queued", "sending"),
    ).update(status="dead", last_error=CANCELLED_TICKET_DELETED, updated_at=now)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_tickets", "0012_ticket_primary_asset_ticketasset_and_more"),
        ("itsm_sla", "0002_priority_p_scale"),
        ("itsm_approvals", "0004_on_fly_and_sent_requests"),
        ("itsm_notifications", "0004_approval_and_watcher_events"),
    ]

    operations = [
        migrations.RunPython(quiesce_deleted_tickets, migrations.RunPython.noop),
    ]
