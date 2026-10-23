"""GridCrest one-off (2026-10-23) — split four HR exit notices out of INC66 into their own tickets.

Why: on 2026-10-23 taniya.kuri@gridcrest.io sent four separate "GT - Exit Information"
requests as replies inside HR's long-running Outlook conversation. Their References chain
carried the Message-ID of the 2026-10-15 email that opened INC66, so threading's header-map
step filed all four as comments on INC66 (Resolved; mailbox reopen policy comment_only).
Agreed with GridCrest: each is its own ticket, requester Taniya, created exactly like a
normal email ticket (routing, automation, Mode=Email, TicketCreated notifications).

Per InboundEmail row (oldest first):
  1. rebuild the ParsedEmail from the stored row, taking the body from the comment
     (the row's body_text is empty);
  2. route + create the ticket through the inbound pipeline's own helpers;
  3. re-point her Message-ID's EmailThreadMessage and the InboundEmail row to the new ticket;
  4. soft-delete the comment on INC66 and log a comment_deleted audit event there that
     names the new ticket.

Dry run by default (one transaction, rolled back, so no notifications leave); APPLY=1 commits.
Run:  docker exec -i ticketprod-backend python manage.py shell < scripts/oneoff_20261023_gridcrest_split_inc66.py
      docker exec -i -e APPLY=1 ticketprod-backend python manage.py shell < scripts/oneoff_20261023_gridcrest_split_inc66.py
"""
import os

from django.db import transaction
from django_tenants.utils import schema_context

APPLY = os.environ.get("APPLY") == "1"
SOURCE_TICKET = "INC66"
INBOUND_IDS = [
    "54a0c946-bf85-4a99-9d9b-398278a0408c",  # 13:24 IST  GT - Exit Information - 30th October, 2026
    "ce8258f4-4d8e-4f56-be8d-7c6f66335c05",  # 13:36 IST  ... Mr. Preeth J (Employee ID - 190)
    "56a6e67d-9c77-49fa-bc52-377fcd379485",  # 13:36 IST  ... Mr. Vijay Kumar (Employee ID - 194)
    "ea9ca338-d8e1-4a4d-95ca-a2d39908b009",  # 13:38 IST  ... Ms. Parna Saha (Employee ID - 321)
]


class _Rollback(Exception):
    pass


with schema_context("gridcrest"):
    from apps.itsm_core.services import log_event
    from apps.itsm_email.models import EmailThreadMessage, InboundEmail
    from apps.itsm_email.services import inbound, routing
    from apps.itsm_email.services import threading as email_threading
    from apps.itsm_email.services.poller import _reconstruct
    from apps.itsm_email.services.system_user import get_email_bot
    from apps.itsm_tickets.models import Comment, Ticket

    bot = get_email_bot()
    try:
        with transaction.atomic():
            rows = list(
                InboundEmail.objects.filter(id__in=INBOUND_IDS)
                .select_related("channel", "ticket", "comment", "requestor")
                .order_by("created_at")
            )
            assert len(rows) == len(INBOUND_IDS), f"expected {len(INBOUND_IDS)} inbound rows, found {len(rows)}"
            source = Ticket.objects.get(ticket_number=SOURCE_TICKET)
            before = Comment.objects.filter(ticket=source, is_deleted=False).count()
            print(f"[start] {SOURCE_TICKET} has {before} live comments; mode={'APPLY' if APPLY else 'DRY RUN'}")

            for row in rows:
                assert row.ticket_id == source.id and row.comment_id and row.action_taken == "added_comment", \
                    f"{row.id} is not a merged comment on {SOURCE_TICKET}"
                comment = row.comment
                assert not comment.is_deleted, f"comment {comment.id} already deleted"
                sender = row.requestor
                assert sender and (sender.email or "").lower() == row.from_addr.lower(), \
                    f"requestor mismatch on {row.id}"
                channel = row.channel

                parsed = _reconstruct(row)
                parsed.body_html = comment.body_html
                parsed.body_text = comment.body_text

                target_project, matched_rule = routing.resolve_target(channel, parsed)
                ticket = inbound._create_ticket(channel, parsed, sender, bot, project=target_project)
                email_threading.record_message(channel, ticket, parsed.message_id, "inbound")
                inbound._attach_and_watch(channel, ticket, parsed, sender, is_new=True)

                row.ticket = ticket
                row.comment = None
                row.matched_rule = matched_rule
                row.action_taken = "created_ticket"
                row.save(update_fields=["ticket", "comment", "matched_rule", "action_taken", "updated_at"])

                comment.soft_delete(bot)
                log_event(source, bot, "comment_deleted", payload={
                    "comment_id": str(comment.id),
                    "moved_to": ticket.ticket_number,
                    "note": ("Email threaded here by mistake (HR conversation reused); "
                             f"recreated as {ticket.ticket_number} on 2026-10-23"),
                })

                ticket.refresh_from_db()
                tm = EmailThreadMessage.objects.get(channel=channel, message_id=parsed.message_id)
                print(f"[split] {row.created_at:%H:%M}Z  {parsed.subject[:60]!r}\n"
                      f"        -> {ticket.ticket_number} project={ticket.project.key} "
                      f"priority={ticket.priority} status={ticket.status.name} "
                      f"assignee={getattr(ticket.assignee, 'username', None)} "
                      f"requestor={ticket.requestor.email} thread_msg->{tm.ticket.ticket_number} "
                      f"desc_len={len(ticket.description_html)}")

            after = Comment.objects.filter(ticket=source, is_deleted=False).count()
            still = EmailThreadMessage.objects.filter(ticket=source).count()
            print(f"[end] {SOURCE_TICKET}: live comments {before} -> {after}; thread messages still on it: {still}")
            if not APPLY:
                raise _Rollback
    except _Rollback:
        print("DRY RUN - rolled back, nothing written, no notifications sent. Re-run with APPLY=1 to commit.")
    else:
        print("APPLIED - committed. TicketCreated notifications are queued for the outbox flush.")
