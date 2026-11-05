"""Cross-engine integration hooks.

The ticket / comment / workflow services call these to nudge the SLA and
notification engines without a hard import dependency. Each hook lazily imports
the engine's service and **no-ops if that engine isn't installed yet** (so the
domain works at every milestone of the build). All hooks swallow errors —
a notification/SLA failure must never break a ticket write.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("itsm")


def _safe(fn):
    try:
        fn()
    except (ImportError, ModuleNotFoundError, AttributeError):
        pass
    except Exception:  # noqa: BLE001 — engine side-effects must not break the caller
        logger.exception("ITSM hook failed")


def sla_start_for_ticket(ticket):
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.start_trackers(ticket)
    _safe(_run)


def sla_on_status_change(ticket, from_status, to_status):
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.on_status_change(ticket, from_status, to_status)
    _safe(_run)


def sla_pause(ticket, metric: str):
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.pause(ticket, metric)
    _safe(_run)


def sla_resume(ticket, metric: str):
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.resume(ticket, metric)
    _safe(_run)


def sla_stop(ticket, metric: str):
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.stop(ticket, metric)
    _safe(_run)


def sla_priority_changed(ticket, old_priority, new_priority, *, start_missing=True):
    """Re-target the ticket's unfinished SLA clocks after a priority change (a blank
    target = no SLA → that clock is withdrawn). Call it post-commit from EVERY write
    site that changes ``Ticket.priority``. ``start_missing=False`` only re-targets the
    clocks the ticket already has (a project move keeps its source clocks)."""
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.on_priority_change(ticket, old_priority, new_priority,
                                      start_missing=start_missing)
    _safe(_run)


def sla_sync_pauses(ticket):
    """Match the ticket's SLA clocks to its pending approvals: an approval whose policy
    has "Pause SLA while waiting" holds the clocks; once none does, only the pauses the
    approval made are released. Call post-commit after an approval starts, is decided,
    cancelled or withdrawn (2026-11-05c)."""
    def _run():
        from apps.itsm_sla.services import sla_engine
        sla_engine.sync_pauses(ticket)
    _safe(_run)


def emit_event(event_type: str, ticket, actor=None, context=None):
    # A deleted ticket is silent: no email, no bell (BUG_LOG 2026-10-29).
    if getattr(ticket, "is_deleted", False):
        return

    def _run():
        from apps.itsm_notifications.services import bus
        bus.emit(event_type, ticket=ticket, actor=actor, context=context or {})
    _safe(_run)


def automation_dispatch(event: str, ticket, *, actor=None, changed_fields=None,
                        from_status=None, to_status=None):
    """Run the project's automation rules for a ticket event (``ticket_created`` /
    ``ticket_updated`` / ``status_changed``). Call it from a post-commit callback. No-op
    until itsm_automation is installed. The dispatcher records its own failures in
    the rule's run log, because this wrapper hides exceptions."""
    def _run():
        from apps.itsm_automation.services import dispatcher
        dispatcher.dispatch(event, ticket, actor=actor, changed_fields=changed_fields,
                            from_status=from_status, to_status=to_status)
    _safe(_run)


def survey_on_resolution(ticket, from_status, to_status):
    """Nudge the (optional) CSAT survey engine on a status change. It fires a
    feedback survey only when the ticket entered a done-category status that
    matches the project's per-project trigger config. No-op until itsm_surveys is
    installed; never breaks the ticket write."""
    def _run():
        from apps.itsm_surveys.services import survey_service
        survey_service.maybe_send_survey(ticket, to_status)
    _safe(_run)


def start_approval(ticket, approval_workflow, *, user=None):
    """Kick off a multi-level approval for a ticket (itsm_approvals, P6). No-op
    until that engine is installed."""
    def _run():
        from apps.itsm_approvals.services import engine as approval_engine
        approval_engine.start_approval(ticket, approval_workflow, user=user)
    _safe(_run)


def begin_approval(ticket, approval_workflow, *, user=None):
    """Start the approval a ``request_approval`` post-function names, INSIDE the
    caller's transaction (workflow transition, ticket create).

    Unlike every other hook this one does **not** swallow errors: when the approval
    can't start (a stage has nobody who could decide it, the policy has no stages)
    itsm_approvals raises ``ApprovalStartError`` — a 400 ``TransitionError`` — so the
    caller's whole write rolls back and the ticket keeps its status. A missing,
    deleted or inactive policy starts nothing (returns None). ``approval_workflow`` is
    an ApprovalWorkflow or its id. No-op until itsm_approvals is installed."""
    try:
        from apps.itsm_approvals.services import engine as approval_engine
    except (ImportError, ModuleNotFoundError):
        return None
    return approval_engine.start_for_transition(ticket, approval_workflow, user=user)


def email_thread_headers(ticket, recipient_email, *, outbox_id=None, subject=None):
    """Ask the (optional) email channel for RFC threading headers + Reply-To for
    an outbound notification. Returns a dict or ``None`` when itsm_email isn't
    installed / no channel exists. Never raises."""
    try:
        from apps.itsm_email.services import threading as email_threading
        return email_threading.build_outbound_headers(
            ticket, recipient_email, outbox_id=outbox_id, subject=subject
        )
    except (ImportError, ModuleNotFoundError, AttributeError):
        return None
    except Exception:  # noqa: BLE001 — never break delivery on a threading error
        logger.exception("email_thread_headers hook failed")
        return None


def email_outbound_transport(ticket):
    """Ask the (optional) email channel for an SMTP transport for this ticket's
    project mailbox. Returns ``{"connection", "from_email", "channel_id"}`` so the
    outbox sends FROM the support address, or ``None`` to use the next tier. Never raises."""
    try:
        from apps.itsm_email.services import transport as email_transport
        return email_transport.get_outbound_config(ticket)
    except (ImportError, ModuleNotFoundError, AttributeError):
        return None
    except Exception:  # noqa: BLE001 — never break delivery on a transport error
        logger.exception("email_outbound_transport hook failed")
        return None


def email_helpdesk_transport(ticket):
    """Ask the (optional) email app for the ticket's helpdesk CUSTOM notification
    transport. Returns ``{"connection", "from_email", "reply_to", "transport_id"}`` or
    ``None`` (→ fall through to the platform/system SMTP). Never raises."""
    try:
        from apps.itsm_email.services import transport as email_transport
        return email_transport.get_helpdesk_transport_config(ticket)
    except (ImportError, ModuleNotFoundError, AttributeError):
        return None
    except Exception:  # noqa: BLE001 — never break delivery on a transport error
        logger.exception("email_helpdesk_transport hook failed")
        return None


def email_record_send_result(verify_ref, error):
    """Feed a send outcome back to the auto-detect layer so a confirmed PERMANENT
    failure flips the sender's ``*_verified`` flag off (→ the outbox reroutes next time).
    ``verify_ref`` is ``("channel"|"transport", id)`` from the transport dict; ``error``
    is ``None`` on success else the exception. No-op when itsm_email isn't installed.
    Never raises."""
    if not verify_ref or not verify_ref[1]:
        return
    try:
        from apps.itsm_email.services import verify as email_verify
        email_verify.record_send_result(verify_ref[0], verify_ref[1], error)
    except (ImportError, ModuleNotFoundError, AttributeError):
        return
    except Exception:  # noqa: BLE001 — self-heal must never break delivery accounting
        logger.exception("email_record_send_result hook failed")


def send_password_reset_email(user, reset_url: str, valid_minutes: int) -> bool:
    """Queue the self-service password-reset email through the notification outbox
    (accounts → itsm_notifications without a hard import). Returns True when queued,
    False when the engine isn't installed or queuing failed. Never raises."""
    try:
        from apps.itsm_notifications.services import system_emails
        system_emails.enqueue_password_reset(user, reset_url, valid_minutes)
        return True
    except (ImportError, ModuleNotFoundError, AttributeError):
        return False
    except Exception:  # noqa: BLE001 — never 500 the (generic) reset response
        logger.exception("send_password_reset_email hook failed")
        return False
