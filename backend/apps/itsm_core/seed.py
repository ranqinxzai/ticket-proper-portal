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
    # ── ITIL Incident fields (column-backed; placed only on Incident layouts) ──
    ("impact", "Impact", "dropdown", {"maps_to": "impact", "locked_options": True},
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")]),
    ("urgency", "Urgency", "dropdown", {"maps_to": "urgency", "locked_options": True},
        [("low", "Low"), ("medium", "Medium"), ("high", "High")]),
    ("business_impact", "Business Impact", "multiline", {"maps_to": "business_impact"}, None),
    ("users_affected", "Users Affected", "number", {"maps_to": "users_affected"}, None),
    ("service_downtime", "Service Downtime", "checkbox", {"maps_to": "service_downtime"}, None),
    ("major_incident", "Major Incident", "checkbox", {"maps_to": "major_incident"}, None),
    ("resolution_code", "Resolution Code", "dropdown",
        {"maps_to": "resolution_code", "locked_options": True},
        [("fixed", "Fixed"), ("workaround", "Workaround"),
         ("duplicate", "Duplicate"), ("user_error", "User Error")]),
    ("root_cause", "Root Cause", "multiline", {"maps_to": "root_cause"}, None),
    ("workaround_provided", "Workaround Provided", "checkbox",
        {"maps_to": "workaround_provided"}, None),
    ("resolution_notes", "Resolution Notes", "multiline", {"maps_to": "resolution_notes"}, None),
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

# ITIL Incident-only layout additions — an **Impact Assessment** section and a
# **Resolution Details** section, placed on Incident-project layouts only (see
# ensure_project_layout). All agent-only (portal_visible=False) and non-mandatory,
# matching the ITIL spec. Same 8-tuple shape as LAYOUT_SPEC. `priority` is not
# re-listed here: it already exists in the sidebar and is *relocated* into the
# Impact Assessment section for Incident projects (see ensure_project_layout).
INCIDENT_LAYOUT_SPEC = [
    ("impact",           "Impact Assessment", 200, False, False, "main", "half", False),
    ("urgency",          "Impact Assessment", 210, False, False, "main", "half", False),
    ("users_affected",   "Impact Assessment", 230, False, False, "main", "half", False),
    ("service_downtime", "Impact Assessment", 240, False, False, "main", "half", False),
    ("major_incident",   "Impact Assessment", 250, False, False, "main", "half", False),
    ("business_impact",  "Impact Assessment", 260, False, False, "main", "full", False),
    ("resolution_code",     "Resolution Details", 300, False, False, "main", "half", False),
    ("workaround_provided", "Resolution Details", 310, False, False, "main", "half", False),
    ("root_cause",          "Resolution Details", 320, False, False, "main", "full", False),
    ("resolution_notes",    "Resolution Details", 330, False, False, "main", "full", False),
]

# Where `priority` moves on an Incident layout (into the Impact Assessment section,
# between Urgency and Users Affected) so it isn't duplicated. Made agent-only there:
# on Incident tickets Priority is auto-derived from Impact × Urgency, not requestor-set.
INCIDENT_PRIORITY_PLACEMENT = {
    "section": "Impact Assessment", "region": "main", "width": "half", "sort_order": 220,
    "portal_visible": False, "is_mandatory": False,
}

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

    # Ensure the full global catalog exists before placing it (idempotent). A blunt
    # "any global system field exists?" check is insufficient now that data migrations
    # pre-create *some* global system fields (e.g. the ITIL Incident set) — that would
    # falsely satisfy the check and skip seeding the base catalog. seed_system_fields
    # is idempotent, so just run it.
    seed_system_fields()
    global_defs_qs = FieldDefinition.objects.filter(
        project__isnull=True, is_system=True, is_deleted=False
    )

    category, _ = FieldDefinition.objects.get_or_create(
        project=project, key="category", defaults=CATEGORY_DEFAULTS,
    )
    layout, _ = FieldLayout.objects.get_or_create(
        project=project, ticket_type=None, defaults={"name": "Default Layout"},
    )

    global_defs = {f.key: f for f in global_defs_qs}

    spec = list(LAYOUT_SPEC)
    is_incident = getattr(project, "project_type", None) == "incident"
    if is_incident:
        spec += INCIDENT_LAYOUT_SPEC

    for key, section, sort_order, mandatory, hidden, region, width, portal_visible in spec:
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

    # On an Incident layout, relocate Priority into the Impact Assessment section
    # (idempotent — only if it's still in its seeded sidebar spot, so admin moves
    # survive). Priority lives in a single layout item, so this moves rather than
    # duplicates it.
    if is_incident and (priority := global_defs.get("priority")):
        FieldLayoutItem.objects.filter(
            layout=layout, field=priority, section="Details",
        ).update(**INCIDENT_PRIORITY_PLACEMENT)

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
