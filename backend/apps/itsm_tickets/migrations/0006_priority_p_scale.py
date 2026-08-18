"""Priority scheme → P1–P4 (incident-style). critical→p1, high→p2, medium→p3, low→p4.

Also decouples Impact/Urgency from the old shared Priority enum — they keep their
descriptive Low/Medium/High[/Critical] choices. This migration alters the choice sets
+ column default, then data-remaps existing ``Ticket.priority`` /
``TicketTemplate.default_priority`` values. Impact keeps all four levels; a stray
``urgency == "critical"`` (only reachable under the old shared enum) is folded to
``"high"``. Runs once per tenant schema via ``migrate_schemas``.
"""

from __future__ import annotations

from django.db import migrations, models

PRIORITY_MAP = {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}
P_CHOICES = [("p1", "P1 – Critical"), ("p2", "P2 – High"),
             ("p3", "P3 – Medium"), ("p4", "P4 – Low")]
IMPACT_CHOICES = [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]
URGENCY_CHOICES = [("low", "Low"), ("medium", "Medium"), ("high", "High")]


def forward(apps, schema_editor):
    Ticket = apps.get_model("itsm_tickets", "Ticket")
    TicketTemplate = apps.get_model("itsm_tickets", "TicketTemplate")
    for old, new in PRIORITY_MAP.items():
        Ticket.objects.filter(priority=old).update(priority=new)
        TicketTemplate.objects.filter(default_priority=old).update(default_priority=new)
    # Urgency dropped its (never-really-used) 4th level; fold legacy critical → high.
    Ticket.objects.filter(urgency="critical").update(urgency="high")


def backward(apps, schema_editor):
    Ticket = apps.get_model("itsm_tickets", "Ticket")
    TicketTemplate = apps.get_model("itsm_tickets", "TicketTemplate")
    for old, new in PRIORITY_MAP.items():
        Ticket.objects.filter(priority=new).update(priority=old)
        TicketTemplate.objects.filter(default_priority=new).update(default_priority=old)


class Migration(migrations.Migration):

    dependencies = [
        ("itsm_tickets", "0005_ticket_business_impact_ticket_major_incident_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="ticket", name="priority",
            field=models.CharField(choices=P_CHOICES, default="p3", max_length=10),
        ),
        migrations.AlterField(
            model_name="ticket", name="impact",
            field=models.CharField(blank=True, choices=IMPACT_CHOICES, default="", max_length=10),
        ),
        migrations.AlterField(
            model_name="ticket", name="urgency",
            field=models.CharField(blank=True, choices=URGENCY_CHOICES, default="", max_length=10),
        ),
        migrations.AlterField(
            model_name="tickettemplate", name="default_priority",
            field=models.CharField(choices=P_CHOICES, default="p3", max_length=10),
        ),
        migrations.RunPython(forward, backward),
    ]
