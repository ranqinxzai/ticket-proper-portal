"""CSAT survey models.

A per-project **SurveyConfig** (mirrors ``itsm_notifications.NotificationScheme``:
a nullable-project global ``is_default`` template + one editable clone per project)
holds the "input options" — the scale TYPE, the copy, and the email message.
A **SurveyResponse** is created (``pending``) when a ticket is resolved/closed and
flipped to ``submitted`` when the requestor answers from the portal. The raw
``rating`` is normalised into a scale-agnostic ``csat_score``/``is_satisfied`` at
submit time so one CSAT % KPI rolls up every scale type.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.itsm_core.models import BaseModel


class SurveyTrigger(models.TextChoices):
    RESOLVED = "resolved", "When resolved"
    CLOSED = "closed", "When closed"


class ScaleType(models.TextChoices):
    CSAT5 = "csat5", "CSAT (1–5)"
    STARS5 = "stars5", "Star rating (1–5)"
    THUMBS = "thumbs", "Thumbs up / down"
    NPS = "nps", "NPS (0–10)"


# Per-scale metadata: the valid raw ratings, the "satisfied" (top-box) predicate,
# and the linear map to a 0–100 CSAT score. Single source of truth for the editor,
# the submit validator, the reporting distribution, and the normalisation.
SCALES: dict[str, dict] = {
    ScaleType.CSAT5: {"values": [1, 2, 3, 4, 5], "satisfied_min": 4, "lo": 1, "hi": 5},
    ScaleType.STARS5: {"values": [1, 2, 3, 4, 5], "satisfied_min": 4, "lo": 1, "hi": 5},
    ScaleType.THUMBS: {"values": [1, 2], "satisfied_min": 2, "lo": 1, "hi": 2},
    ScaleType.NPS: {"values": list(range(0, 11)), "satisfied_min": 7, "lo": 0, "hi": 10},
}


def normalize(scale_type: str, rating: int) -> tuple[float, bool]:
    """Map a raw ``rating`` on ``scale_type`` to (csat_score 0–100, is_satisfied)."""
    meta = SCALES.get(scale_type) or SCALES[ScaleType.CSAT5]
    lo, hi = meta["lo"], meta["hi"]
    score = 0.0 if hi == lo else round((rating - lo) / (hi - lo) * 100, 1)
    return score, rating >= meta["satisfied_min"]


def is_valid_rating(scale_type: str, rating) -> bool:
    meta = SCALES.get(scale_type) or SCALES[ScaleType.CSAT5]
    return rating in meta["values"]


_DEFAULT_EMAIL_BODY = (
    "<p>Your ticket <strong>{{ ticket.number }}</strong> was just wrapped up. "
    "We'd love to know how we did — it only takes a few seconds.</p>"
)


class SurveyConfig(BaseModel):
    """Per-project CSAT configuration. ``project`` is nullable: the single
    ``is_default`` row (project NULL) is the seed template + fallback, every other
    row is a project's own editable copy (one per project, enforced in code +
    ``ensure_survey_config``). FK (not OneToOne) mirrors NotificationScheme so
    soft-delete + re-provision never collides on a unique constraint."""

    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.CASCADE,
        related_name="survey_configs",
    )
    is_default = models.BooleanField(default=False)

    enabled = models.BooleanField(default=False)
    trigger = models.CharField(max_length=10, choices=SurveyTrigger.choices,
                               default=SurveyTrigger.CLOSED)
    scale_type = models.CharField(max_length=10, choices=ScaleType.choices,
                                  default=ScaleType.CSAT5)

    # ── the configurable "input options" (per project) ──────────────────────
    question_text = models.CharField(
        max_length=300, default="How satisfied were you with how we handled your request?")
    intro_text = models.TextField(blank=True, default="")
    scale_labels = models.JSONField(default=list, blank=True)  # optional per-point labels
    comment_enabled = models.BooleanField(default=True)
    comment_prompt = models.CharField(max_length=300, default="Anything you'd like to add? (optional)")
    comment_required = models.BooleanField(default=False)
    thank_you_text = models.TextField(default="Thank you for your feedback!")

    # ── survey email (message only; the branded shell + CTA are added at send) ──
    email_subject = models.CharField(max_length=300,
                                     default="[{{ ticket.number }}] How did we do?")
    email_body_html = models.TextField(blank=True, default=_DEFAULT_EMAIL_BODY)

    class Meta:
        indexes = [models.Index(fields=["project"]), models.Index(fields=["is_default"])]

    def __str__(self):
        return f"SurveyConfig({self.project.key if self.project_id else 'default'})"


class SurveyResponse(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUBMITTED = "submitted", "Submitted"

    ticket = models.ForeignKey(
        "itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="survey_responses")
    # Denormalised so reporting/scoping never needs the ticket join to survive a
    # (soft-)deleted ticket and can filter by project/helpdesk directly.
    project = models.ForeignKey(
        "itsm_projects.Project", on_delete=models.CASCADE, related_name="survey_responses")
    requestor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+")
    config = models.ForeignKey(
        SurveyConfig, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    scale_type = models.CharField(max_length=10, choices=ScaleType.choices,
                                  default=ScaleType.CSAT5)
    rating = models.PositiveSmallIntegerField(null=True, blank=True)
    csat_score = models.FloatField(null=True, blank=True)      # normalised 0–100
    is_satisfied = models.BooleanField(null=True, blank=True)  # top-box, scale-agnostic
    comment_html = models.TextField(blank=True, default="")
    comment_text = models.TextField(blank=True, default="")

    sent_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["project", "submitted_at"]),
            models.Index(fields=["is_satisfied"]),
            models.Index(fields=["ticket"]),
        ]

    def __str__(self):
        return f"SurveyResponse({self.ticket_id}, {self.status})"
