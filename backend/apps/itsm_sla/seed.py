"""Seed a default business calendar (Mon–Fri 09:00–17:00 UTC) and a default
SLA policy with first-response + resolution metrics, per-priority targets, and
escalations."""

from __future__ import annotations

from datetime import time

# business minutes per priority
FIRST_RESPONSE = {"critical": 30, "high": 60, "medium": 240, "low": 480}
RESOLUTION = {"critical": 240, "high": 480, "medium": 1440, "low": 2880}


def run():
    from .models import (
        BusinessCalendar,
        BusinessHours,
        EscalationRule,
        SLAMetric,
        SLAPolicy,
        SLATarget,
    )

    cal, _ = BusinessCalendar.objects.get_or_create(
        name="Standard Business Hours (UTC)", defaults={"timezone": "UTC", "is_default": True}
    )
    if not cal.hours.exists():
        for weekday in range(0, 5):  # Mon–Fri
            BusinessHours.objects.create(calendar=cal, weekday=weekday,
                                         start_time=time(9, 0), end_time=time(17, 0))

    policy, _ = SLAPolicy.objects.get_or_create(
        name="Default SLA", defaults={"is_default": True, "is_active": True, "calendar": cal,
                                      "description": "Default first-response + resolution targets."}
    )
    if policy.calendar_id is None:
        policy.calendar = cal
        policy.save(update_fields=["calendar", "updated_at"])

    fr, _ = SLAMetric.objects.get_or_create(
        policy=policy, kind="first_response", defaults={"name": "Time to First Response"}
    )
    res, _ = SLAMetric.objects.get_or_create(
        policy=policy, kind="resolution",
        defaults={"name": "Time to Resolution", "pause_statuses": ["pending"]},
    )
    if not res.pause_statuses:
        res.pause_statuses = ["pending"]
        res.save(update_fields=["pause_statuses", "updated_at"])

    for metric, table in ((fr, FIRST_RESPONSE), (res, RESOLUTION)):
        for priority, minutes in table.items():
            SLATarget.objects.update_or_create(
                metric=metric, priority=priority, defaults={"target_minutes": minutes}
            )

    for pct in (75, 100):
        EscalationRule.objects.get_or_create(
            metric=res, threshold_pct=pct, defaults={"action": "notify"}
        )
    return {"calendar": cal.name, "policy": policy.name, "metrics": 2}
