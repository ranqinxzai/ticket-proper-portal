"""Remap priority values stored in RoutingRule.match_spec to the P1–P4 scale.

A routing rule may match on priority via the legacy flat key ``{"priority": <p>}`` or a
condition ``{"field": "priority", "value": <p>|[<p>...]}``. Only priority values are
remapped (critical→p1 …); impact/urgency conditions stay descriptive. The routing-rule
*evaluation order* field (``RoutingRule.priority``, an integer rank) is unrelated and
untouched. Idempotent; runs per tenant schema.
"""

from __future__ import annotations

from django.db import migrations

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}


def _remap_value(value, mapping):
    if isinstance(value, list):
        return [mapping.get(v, v) for v in value]
    return mapping.get(value, value)


def _remap_spec(spec, mapping):
    if not isinstance(spec, dict):
        return spec, False
    new = dict(spec)
    changed = False
    if "priority" in new:
        remapped = _remap_value(new["priority"], mapping)
        if remapped != new["priority"]:
            new["priority"] = remapped
            changed = True
    conds = new.get("conditions")
    if isinstance(conds, list):
        new_conds = []
        for c in conds:
            if isinstance(c, dict) and c.get("field") == "priority" and "value" in c:
                remapped = _remap_value(c["value"], mapping)
                if remapped != c["value"]:
                    c = {**c, "value": remapped}
                    changed = True
            new_conds.append(c)
        new["conditions"] = new_conds
    return new, changed


def _apply(apps, mapping):
    RoutingRule = apps.get_model("itsm_groups", "RoutingRule")
    for rule in RoutingRule.objects.all().only("id", "match_spec"):
        new_spec, changed = _remap_spec(rule.match_spec, mapping)
        if changed:
            rule.match_spec = new_spec
            rule.save(update_fields=["match_spec"])


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_groups", "0002_initial"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
