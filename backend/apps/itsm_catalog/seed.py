"""Seed default catalog categories + items per helpdesk. Runs after approvals +
projects so approval workflows and `<KEY>REQ` projects exist. Idempotent by slug."""

from __future__ import annotations

# (helpdesk_key, category_slug, category_name, icon)
CATEGORIES = [
    ("IT", "it-hardware-software", "Hardware & Software", "laptop"),
    ("HR", "hr-people", "People & Onboarding", "users"),
    ("FAC", "fac-workplace", "Workplace & Facilities", "building-2"),
]

# (helpdesk_key, category_slug, item_slug, name, short_desc, requires_approval)
ITEMS = [
    ("IT", "it-hardware-software", "request-new-laptop", "Request a New Laptop",
     "Order a standard-issue laptop for a new or existing employee.", True),
    ("IT", "it-hardware-software", "software-access", "Software Access Request",
     "Request access to a licensed application.", False),
    ("IT", "it-hardware-software", "vpn-access", "VPN Access",
     "Request remote VPN access to the corporate network.", False),
    ("HR", "hr-people", "onboard-new-employee", "Onboard a New Employee",
     "Kick off onboarding: accounts, equipment, induction.", True),
    ("HR", "hr-people", "leave-request", "Leave / Time-off Request",
     "Submit a leave or time-off request for approval.", False),
    ("FAC", "fac-workplace", "meeting-room-booking", "Meeting Room Booking",
     "Reserve a meeting room or shared space.", False),
    ("FAC", "fac-workplace", "maintenance-request", "Maintenance Request",
     "Report a facilities issue that needs fixing.", False),
    ("FAC", "fac-workplace", "access-card", "Access Card Request",
     "Request a new or replacement building access card.", False),
]


def run():
    from apps.itsm_helpdesks.models import Helpdesk
    from apps.itsm_projects.models import Project
    from apps.itsm_approvals.models import ApprovalWorkflow

    from .models import CatalogCategory, CatalogItem

    approval_wf = ApprovalWorkflow.objects.filter(name="Standard Procurement Approval").first()

    cats = {}
    for hk, slug, name, icon in CATEGORIES:
        hd = Helpdesk.objects.filter(key=hk).first()
        cat, _ = CatalogCategory.objects.get_or_create(
            slug=slug, defaults={"name": name, "icon": icon, "helpdesk": hd, "is_portal_visible": True},
        )
        cats[slug] = cat

    created = 0
    for hk, cat_slug, item_slug, name, short, needs_approval in ITEMS:
        req_project = Project.objects.filter(key=f"{hk}REQ", is_deleted=False).first()
        if not req_project or cat_slug not in cats:
            continue
        _, was_created = CatalogItem.objects.get_or_create(
            slug=item_slug,
            defaults={
                "category": cats[cat_slug], "name": name, "short_description": short,
                "project": req_project, "is_portal_visible": True, "is_active": True,
                "summary_template": name, "default_priority": "medium",
                "requires_approval": needs_approval,
                "approval_workflow": approval_wf if needs_approval else None,
            },
        )
        created += int(was_created)

    return {"categories": len(cats), "items": len(ITEMS), "created": created}
