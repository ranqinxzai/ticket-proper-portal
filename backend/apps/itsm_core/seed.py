"""Standard field catalog + default layout seeding.

Every project gets a *minimum configuration* surfaced in its Fields + Layout tabs:
the standard ITIL fields (Summary, Description, Priority, …) as **global system**
`FieldDefinition`s, a **per-project Category** cascade field, and a default
`FieldLayout` that places them with sensible section / required / hidden defaults.

Standard fields stay first-class columns on `Ticket`; the system `FieldDefinition`
mirrors them in the designer via `config.maps_to` (the dynamic form — a later
milestone — routes those to the column instead of a `FieldValue`). Value-backed
fields (Mode) and the per-project Category tree store in `FieldValue`.

Idempotent: re-running refreshes the global catalog and adds any missing layout
items without clobbering admin overrides (items use get_or_create — defaults only
apply on first create). Run after the projects seed.
"""

from __future__ import annotations

# Global system fields (project=None, is_system=True).
# (key, name, field_type, config, options[(value, label)] | None)
GLOBAL_FIELDS = [
    ("summary", "Summary", "text", {"maps_to": "summary"}, None),
    ("description", "Description", "richtext",
        {"maps_to": "description_html", "rich": True}, None),
    ("priority", "Priority", "dropdown",
        {"maps_to": "priority", "locked_options": True},
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]),
    ("mode", "Mode", "dropdown", {},
        [("email", "Email"), ("phone", "Phone"), ("portal", "Portal"), ("walk_in", "Walk-in")]),
    ("requestor", "Requestor", "user_picker", {"maps_to": "requestor"}, None),
    ("assigned_group", "Assigned Group", "group_picker", {"maps_to": "assigned_group"}, None),
    ("assignee", "Assigned Technician", "user_picker", {"maps_to": "assignee"}, None),
    ("source", "Source", "dropdown",
        {"maps_to": "source", "locked_options": True, "system_set": True},
        [("agent", "Agent"), ("portal", "Portal"), ("email", "Email"),
         ("phone", "Phone"), ("api", "API")]),
    ("attachments", "Attachments", "attachment", {}, None),
]

# Default placement on each project's layout. Main column = ticket details (left),
# sidebar = other details (right) — mirrors a JSM two-pane form.
# (field key, section, sort_order, is_mandatory, is_hidden, region, width, portal_visible)
# portal_visible mirrors migration 0005's backfill: assignment/source/picker fields are
# hidden from the end-user Service Portal; requestor-fillable fields are shown.
LAYOUT_SPEC = [
    ("summary", "Ticket details", 10, True, False, "main", "full", True),
    ("description", "Ticket details", 20, True, False, "main", "full", True),
    ("category", "Ticket details", 30, True, False, "main", "full", True),
    ("attachments", "Ticket details", 40, False, False, "main", "full", True),
    ("priority", "Details", 50, True, False, "sidebar", "full", True),
    ("mode", "Details", 60, False, False, "sidebar", "full", True),
    ("requestor", "People", 70, False, False, "sidebar", "full", False),
    ("assigned_group", "People", 80, False, False, "sidebar", "full", False),
    ("assignee", "People", 90, False, False, "sidebar", "full", False),
    ("source", "System", 100, False, True, "sidebar", "full", False),  # system-detected; hidden on form
]

CATEGORY_DEFAULTS = {
    "name": "Category", "field_type": "cascade", "is_system": True,
    "config": {"levels": ["Category", "Subcategory"], "depth": 2},
}


def seed_system_fields():
    """Create/refresh the global system FieldDefinitions + their options. Idempotent."""
    from apps.itsm_core.models import FieldDefinition, FieldOption

    created = 0
    for key, name, ftype, config, options in GLOBAL_FIELDS:
        defn, was = FieldDefinition.objects.get_or_create(
            project=None, key=key,
            defaults={"name": name, "field_type": ftype, "is_system": True,
                      "config": config, "is_multi": ftype == "multiselect"},
        )
        created += int(was)
        # keep label / type / config / system flag fresh on re-run
        if (defn.name, defn.field_type, defn.is_system, defn.config) != (name, ftype, True, config):
            defn.name, defn.field_type, defn.is_system, defn.config = name, ftype, True, config
            defn.save(update_fields=["name", "field_type", "is_system", "config", "updated_at"])
        for i, (val, label) in enumerate(options or []):
            FieldOption.objects.update_or_create(
                field=defn, value=val,
                defaults={"label": label, "sort_order": i, "level": 1, "parent": None},
            )
    return created


def ensure_project_layout(project):
    """Ensure `project` has its per-project Category field + a default layout placing
    the standard catalog. Idempotent; preserves admin overrides on existing items."""
    from apps.itsm_core.models import FieldDefinition, FieldLayout, FieldLayoutItem

    global_defs_qs = FieldDefinition.objects.filter(
        project__isnull=True, is_system=True, is_deleted=False
    )
    if not global_defs_qs.exists():  # self-heal if called before the catalog step
        seed_system_fields()

    category, _ = FieldDefinition.objects.get_or_create(
        project=project, key="category", defaults=CATEGORY_DEFAULTS,
    )
    layout, _ = FieldLayout.objects.get_or_create(
        project=project, ticket_type=None, defaults={"name": "Default Layout"},
    )

    global_defs = {f.key: f for f in global_defs_qs}
    for key, section, sort_order, mandatory, hidden, region, width, portal_visible in LAYOUT_SPEC:
        field = category if key == "category" else global_defs.get(key)
        if field is None:
            continue
        FieldLayoutItem.objects.get_or_create(
            layout=layout, field=field,
            defaults={"section": section, "sort_order": sort_order,
                      "is_mandatory": mandatory, "is_hidden": hidden,
                      "region": region, "width": width,
                      "portal_visible": portal_visible},
        )
    return layout


def backfill_layouts():
    """Ensure every existing project (incl. API-created custom ones) has its default layout."""
    from apps.itsm_projects.models import Project

    n = 0
    for project in Project.objects.filter(is_deleted=False):
        ensure_project_layout(project)
        n += 1
    return {"projects": n}


def run():
    """Standalone entry: seed the global catalog, then backfill all project layouts."""
    fields_created = seed_system_fields()
    layouts = backfill_layouts()
    return {"system_fields_created": fields_created, **layouts}
