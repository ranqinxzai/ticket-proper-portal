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
    project mailbox. Returns ``{"connection", "from_email"}`` so the outbox sends
    FROM the support address, or ``None`` to use the global backend. Never raises."""
    try:
        from apps.itsm_email.services import transport as email_transport
        return email_transport.get_outbound_config(ticket)
    except (ImportError, ModuleNotFoundError, AttributeError):
        return None
    except Exception:  # noqa: BLE001 — never break delivery on a transport error
        logger.exception("email_outbound_transport hook failed")
        return None
