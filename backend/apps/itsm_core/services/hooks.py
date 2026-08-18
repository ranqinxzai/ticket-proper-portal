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


def emit_event(event_type: str, ticket, actor=None, context=None):
    def _run():
        from apps.itsm_notifications.services import bus
        bus.emit(event_type, ticket=ticket, actor=actor, context=context or {})
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
