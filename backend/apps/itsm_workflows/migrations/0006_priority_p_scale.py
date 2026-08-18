"""Remap priority values stored in workflow automation config to the P1–P4 scale.

Two sites can hold a literal ticket-priority value:
  • ``Transition.post_functions`` — a ``{"type": "set_priority", "config": {"priority": <p>}}``
    entry that sets a ticket's priority when the transition fires.
  • ``TransitionCondition.config`` — a ``field_equals`` condition on ``field == "priority"``.
Only these priority values are remapped (critical→p1 …). Defensive/idempotent — no such
config is seeded, but user-authored workflows may contain them. Runs per tenant schema.
"""

from __future__ import annotations

from django.db import migrations

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}


def _apply(apps, mapping):
    Transition = apps.get_model("itsm_workflows", "Transition")
    TransitionCondition = apps.get_model("itsm_workflows", "TransitionCondition")

    for tr in Transition.objects.all().only("id", "post_functions"):
        pfs = tr.post_functions or []
        if not isinstance(pfs, list):
            continue
        changed = False
        new_pfs = []
        for pf in pfs:
            if (isinstance(pf, dict) and pf.get("type") == "set_priority"
                    and isinstance(pf.get("config"), dict)
                    and pf["config"].get("priority") in mapping):
                cfg = dict(pf["config"])
                cfg["priority"] = mapping[cfg["priority"]]
                pf = {**pf, "config": cfg}
                changed = True
            new_pfs.append(pf)
        if changed:
            tr.post_functions = new_pfs
            tr.save(update_fields=["post_functions"])

    for cond in TransitionCondition.objects.filter(condition_type="field_equals"):
        cfg = cond.config or {}
        if isinstance(cfg, dict) and cfg.get("field") == "priority" and cfg.get("value") in mapping:
            cfg = dict(cfg)
            cfg["value"] = mapping[cfg["value"]]
            cond.config = cfg
            cond.save(update_fields=["config"])


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_workflows", "0005_status_pauses_sla"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
