"""SLA models: calendars, policies/metrics/targets, per-ticket trackers,
escalations."""

from __future__ import annotations

from django.db import models

from apps.itsm_core.models import BaseModel


class BusinessCalendar(BaseModel):
    name = models.CharField(max_length=120)
    timezone = models.CharField(max_length=64, default="UTC")
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class BusinessHours(BaseModel):
    calendar = models.ForeignKey(BusinessCalendar, on_delete=models.CASCADE, related_name="hours")
    weekday = models.PositiveSmallIntegerField()  # 0=Mon … 6=Sun
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["weekday", "start_time"]


class Holiday(BaseModel):
    calendar = models.ForeignKey(BusinessCalendar, on_delete=models.CASCADE, related_name="holidays")
    date = models.DateField()
    name = models.CharField(max_length=150, blank=True)
    recurring_annually = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["calendar", "date"], name="uniq_calendar_holiday")]


class SLAPolicy(BaseModel):
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    project = models.ForeignKey(
        "itsm_projects.Project", null=True, blank=True, on_delete=models.CASCADE, related_name="sla_policies"
    )
    calendar = models.ForeignKey(BusinessCalendar, null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="+")
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    applies_to = models.JSONField(default=dict, blank=True)  # {ticket_type, priority, group} filter

    def __str__(self):
        return self.name


class SLAMetric(BaseModel):
    class Kind(models.TextChoices):
        FIRST_RESPONSE = "first_response", "Time to First Response"
        RESOLUTION = "resolution", "Time to Resolution"
        ASSIGNMENT = "assignment", "Time to Assignment"
        CUSTOM = "custom", "Custom"

    policy = models.ForeignKey(SLAPolicy, on_delete=models.CASCADE, related_name="metrics")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    name = models.CharField(max_length=120)
    pause_statuses = models.JSONField(default=list, blank=True)  # status keys that pause this metric

    def __str__(self):
        return f"{self.policy.name}:{self.kind}"


class SLATarget(BaseModel):
    metric = models.ForeignKey(SLAMetric, on_delete=models.CASCADE, related_name="targets")
    priority = models.CharField(max_length=10)  # critical/high/medium/low
    target_minutes = models.PositiveIntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["metric", "priority"], name="uniq_metric_priority")]


class SLATracker(BaseModel):
    """Per-ticket, per-metric runtime clock — the row the UI reads."""

    class State(models.TextChoices):
        RUNNING = "running", "Running"
        PAUSED = "paused", "Paused"
        MET = "met", "Met"
        BREACHED = "breached", "Breached"
        STOPPED = "stopped", "Stopped"

    ticket = models.ForeignKey("itsm_tickets.Ticket", on_delete=models.CASCADE, related_name="sla_trackers")
    metric = models.ForeignKey(SLAMetric, on_delete=models.CASCADE, related_name="trackers")
    calendar = models.ForeignKey(BusinessCalendar, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    target_minutes = models.PositiveIntegerField()
    started_at = models.DateTimeField()
    due_at = models.DateTimeField()
    stopped_at = models.DateTimeField(null=True, blank=True)
    total_paused_minutes = models.FloatField(default=0.0)
    state = models.CharField(max_length=10, choices=State.choices, default=State.RUNNING)
    breached = models.BooleanField(default=False)
    breached_at = models.DateTimeField(null=True, blank=True)
    paused_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["ticket", "metric"], name="uniq_ticket_metric_tracker")]
        indexes = [
            models.Index(fields=["state", "due_at"]),
            models.Index(fields=["ticket"]),
            models.Index(fields=["breached"]),
        ]


class SLAPauseInterval(BaseModel):
    tracker = models.ForeignKey(SLATracker, on_delete=models.CASCADE, related_name="pauses")
    paused_at = models.DateTimeField()
    resumed_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=150, blank=True)


class EscalationRule(BaseModel):
    class Trigger(models.TextChoices):
        BEFORE_BREACH = "before_breach", "Before breach"
        ON_BREACH = "on_breach", "On breach"

    class ActionType(models.TextChoices):
        NOTIFY = "notify", "Notify"
        REASSIGN = "reassign", "Reassign"
        RAISE_PRIORITY = "raise_priority", "Raise priority"

    metric = models.ForeignKey(SLAMetric, on_delete=models.CASCADE, related_name="escalations")
    threshold_pct = models.PositiveSmallIntegerField(default=100)  # 75/90/100
    action = models.CharField(max_length=20, choices=ActionType.choices, default=ActionType.NOTIFY)
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["threshold_pct"]


class SLAEscalationLog(BaseModel):
    """Idempotency record: one row per (tracker, threshold) fired."""
    tracker = models.ForeignKey(SLATracker, on_delete=models.CASCADE, related_name="escalation_logs")
    threshold_pct = models.PositiveSmallIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tracker", "threshold_pct"], name="uniq_tracker_threshold"),
        ]
