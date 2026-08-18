"""Remap stored ``Project.priority_matrix`` output values to the P1–P4 scale.

Matrix keys (impact/urgency) stay descriptive; only the cell *values* (the derived
priority) move critical→p1, high→p2, medium→p3, low→p4. Idempotent: already-p# values
are left untouched. Runs per tenant schema via ``migrate_schemas``.
"""

from __future__ import annotations

from django.db import migrations

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
REVERSE_MAP = {v: k for k, v in PRIORITY_MAP.items()}


def _remap(matrix, mapping):
    if not isinstance(matrix, dict):
        return matrix
    out = {}
    for impact, row in matrix.items():
        if isinstance(row, dict):
            out[impact] = {urg: mapping.get(pri, pri) for urg, pri in row.items()}
        else:
            out[impact] = row
    return out


def _apply(apps, mapping):
    Project = apps.get_model("itsm_projects", "Project")
    for proj in Project.objects.all().only("id", "priority_matrix"):
        remapped = _remap(proj.priority_matrix, mapping)
        if remapped != proj.priority_matrix:
            proj.priority_matrix = remapped
            proj.save(update_fields=["priority_matrix"])


def forward(apps, schema_editor):
    _apply(apps, PRIORITY_MAP)


def backward(apps, schema_editor):
    _apply(apps, REVERSE_MAP)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_projects", "0008_project_priority_matrix"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
