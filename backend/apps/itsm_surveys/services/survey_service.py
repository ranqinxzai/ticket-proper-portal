"""CSAT survey service — the single write site for sending surveys and recording
responses.

``maybe_send_survey`` is called (post-commit, via ``itsm_core.hooks``) when a
ticket enters a done-category status; if the project's survey is enabled and the
trigger matches, it creates a ``pending`` SurveyResponse (once per ticket) and
enqueues a branded survey email through the **existing notification outbox** (no
new sender). ``submit`` records the requestor's answer, normalising the raw rating
into a scale-agnostic CSAT score. Never raises into the ticket write path.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import connection
from django.template import Context, Template
from django.utils import timezone

from apps.itsm_core.services.html import html_to_text

from ..models import SurveyConfig, SurveyResponse, SurveyTrigger, is_valid_rating, normalize

logger = logging.getLogger("itsm")


def config_for(project):
    """The project's own survey config, else the global default (disabled) fallback."""
    return (SurveyConfig.objects.filter(project=project, is_deleted=False).first()
            or SurveyConfig.objects.filter(is_default=True, is_deleted=False).first())


def _trigger_matches(config, to_status) -> bool:
    """True when a transition into ``to_status`` should fire this config's survey.

    Only done-category statuses qualify. ``closed`` trigger fires on the terminal
    ``closed`` status; ``resolved`` trigger fires on the first done status that
    isn't closed (e.g. resolved / fulfilled)."""
    cat = getattr(getattr(to_status, "category", None), "key", None)
    if cat != "done":
        return False
    is_closed = getattr(to_status, "key", "") == "closed"
    if config.trigger == SurveyTrigger.CLOSED:
        return is_closed
    return not is_closed  # RESOLVED


def _feedback_url(ticket) -> str:
    """Absolute URL to the portal feedback page (login-required, requestor-scoped)."""
    base = getattr(settings, "FRONTEND_BASE_URL", "")
    org = getattr(connection, "schema_name", "") or ""
    return f"{base}/t/{org}/portal/requests/{ticket.ticket_number}/feedback"


def maybe_send_survey(ticket, to_status):
    """Fire a CSAT survey for ``ticket`` if its project config opts in and the
    transition matches. Idempotent: one survey per ticket (no resend). Requestor
    must have an email. Safe — logs and swallows any error."""
    try:
        config = config_for(ticket.project)
        if config is None or not config.enabled:
            return
        if not _trigger_matches(config, to_status):
            return
        requestor = ticket.requestor
        if requestor is None or not getattr(requestor, "email", ""):
            return
        if SurveyResponse.objects.filter(ticket=ticket, is_deleted=False).exists():
            return  # already surveyed — never double-send

        response = SurveyResponse.objects.create(
            ticket=ticket, project=ticket.project, requestor=requestor, config=config,
            status=SurveyResponse.Status.PENDING, scale_type=config.scale_type,
            sent_at=timezone.now(),
        )
        _enqueue_email(ticket, requestor, config, response)
    except Exception:  # noqa: BLE001 — a survey failure must never break the ticket write
        logger.exception("maybe_send_survey failed for ticket %s", getattr(ticket, "id", None))


def _enqueue_email(ticket, requestor, config, response):
    """Render the survey message in the branded shell (feedback-page CTA) and drop
    a queued row into the notification outbox for the flusher to deliver."""
    from apps.itsm_notifications.models import NotificationOutbox
    from apps.itsm_notifications.services import email_layout, templates as ntemplates

    ctx_data = ntemplates.build_context(ticket, recipient=requestor)
    ctx = Context(ctx_data)
    subject = Template(config.email_subject or "[{{ ticket.number }}] How did we do?").render(ctx)
    inner_html = Template(config.email_body_html or "").render(ctx) or "<p>How did we do?</p>"
    feedback_url = _feedback_url(ticket)

    html = email_layout.wrap(
        "SurveyRequest", inner_html, ctx_data, is_agent=False,
        cta_url=feedback_url, cta_label="Give feedback",
    )
    text = f"{html_to_text(inner_html)}\n{feedback_url}"

    NotificationOutbox.objects.get_or_create(
        dedupe_key=f"survey|{ticket.id}|{response.id}",
        defaults={"event_type": "SurveyRequest", "ticket": ticket, "recipient": requestor,
                  "channel": "email", "rendered_subject": subject[:300],
                  "rendered_body": text, "rendered_html": html, "status": "queued"},
    )


def public_config(config) -> dict:
    """The requestor-facing slice of a config (no email/internal fields)."""
    return {
        "scale_type": config.scale_type,
        "question_text": config.question_text,
        "intro_text": config.intro_text,
        "scale_labels": config.scale_labels or [],
        "comment_enabled": config.comment_enabled,
        "comment_prompt": config.comment_prompt,
        "comment_required": config.comment_required,
        "thank_you_text": config.thank_you_text,
    }


def response_payload(response) -> dict | None:
    if response is None:
        return None
    return {
        "id": str(response.id),
        "status": response.status,
        "scale_type": response.scale_type,
        "rating": response.rating,
        "comment": response.comment_text,
        "submitted_at": response.submitted_at.isoformat() if response.submitted_at else None,
    }


def submit(ticket, user, rating, comment: str = ""):
    """Record the requestor's answer. Validates the rating against the survey's
    scale and (optionally) requires a comment. Returns the SurveyResponse.
    Raises ``ValueError`` (→ 400) on validation failure."""
    from apps.itsm_core.services.audit import log_event

    response = SurveyResponse.objects.filter(ticket=ticket, is_deleted=False).first()
    if response is None:
        # No survey was ever sent for this ticket — refuse unsolicited feedback so
        # the CSAT numbers only reflect actual survey sends.
        raise ValueError("No survey is available for this ticket.")
    config = config_for(ticket.project)
    scale_type = response.scale_type

    try:
        rating = int(rating)
    except (TypeError, ValueError):
        raise ValueError("A rating is required.")
    if not is_valid_rating(scale_type, rating):
        raise ValueError("That rating isn't valid for this survey.")

    comment_text = html_to_text(comment or "").strip()  # bleach-strip → XSS-safe plain text
    if config and config.comment_required and not comment_text:
        raise ValueError("Please add a comment before submitting.")

    csat_score, is_satisfied = normalize(scale_type, rating)
    response.rating = rating
    response.csat_score = csat_score
    response.is_satisfied = is_satisfied
    response.comment_text = comment_text
    response.status = SurveyResponse.Status.SUBMITTED
    response.submitted_at = timezone.now()
    response.save()

    log_event(ticket, user, "survey_submitted",
              payload={"rating": rating, "scale_type": scale_type, "is_satisfied": is_satisfied})
    return response
