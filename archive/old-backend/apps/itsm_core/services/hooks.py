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


def email_thread_headers(ticket, recipient_email, *, outbox_id=None, subject=None):
    """Ask the (optional) email channel for RFC threading headers + Reply‑To for
    an outbound notification, and record the minted Message‑ID so the reply can
    be matched back to the ticket. Returns a dict ``{"headers": {...},
    "reply_to": [...]}`` or ``None`` when itsm_email isn't installed / no channel
    exists (then the outbox sends a plain, un‑threaded mail). Never raises — a
    threading failure must not cost a delivery attempt."""
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
