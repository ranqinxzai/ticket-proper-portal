"""Excel workbooks: the import template, the asset export and the failed-rows file.

Every text cell goes through :func:`put`, the formula-injection guard: text that
starts with ``= + - @`` (or a tab / CR) is stored as plain text with Excel's
quote-prefix flag, so it never runs as a formula — and round-trips unchanged when
the failed-rows file is fixed and uploaded again.
"""

from __future__ import annotations

import datetime as dt
import io

from ..models import AssetCategory, AssetStatus, Department, Location, StateType, Vendor
from .details import FieldResolver, display, serialize

BRAND = "E60053"
DATE_FMT = "yyyy-mm-dd"
MONEY_FMT = "#,##0.00"
TEMPLATE_ROWS = 5000
_RISKY = ("=", "+", "-", "@", "\t", "\r")

# Import / template columns: (key, header, required)
IMPORT_COLUMNS: list[tuple[str, str, bool]] = [
    ("name", "Asset Name", True),
    ("asset_tag", "Asset Tag", False),
    ("category", "Category", True),
    ("sub_category", "Sub-category", False),
    ("status", "Status", False),
    ("vendor", "Vendor", False),
    ("location", "Location", False),
    ("assigned_user", "User", False),
    ("department", "Department", False),
    ("allotment_notes", "Allotment Notes", False),
    ("purchase_date", "Purchase Date", False),
    ("purchase_cost", "Purchase Cost", False),
    ("expiry_date", "Expiry Date", False),
    ("warranty_expiry_date", "Warranty Expiry Date", False),
]
DATE_COLUMNS = {"purchase_date", "expiry_date", "warranty_expiry_date"}


def put(ws, row, col, value, *, number_format=None):
    """Write one cell. Risky text is stored as quote-prefixed plain text."""
    cell = ws.cell(row=row, column=col, value=value)
    if isinstance(value, str) and value.startswith(_RISKY):
        cell.data_type = "s"
        cell.quotePrefix = True
    if number_format:
        cell.number_format = number_format
    return cell


def _styles():
    from openpyxl.styles import Alignment, Font, PatternFill

    return {
        "head_font": Font(bold=True, color="FFFFFF"),
        "head_fill": PatternFill("solid", fgColor=BRAND),
        "title_font": Font(bold=True, size=14),
        "bold": Font(bold=True),
        "left": Alignment(horizontal="left", vertical="top"),
        "wrap": Alignment(wrap_text=True, vertical="top"),
    }


def _header_row(ws, row, headers, st):
    for c, h in enumerate(headers, start=1):
        cell = put(ws, row, c, h)
        cell.font, cell.fill, cell.alignment = st["head_font"], st["head_fill"], st["left"]


def _widths(ws, headers, rows, *, cap=48):
    from openpyxl.utils import get_column_letter

    for c, h in enumerate(headers, start=1):
        width = max([len(str(h))] + [len(str(r[c - 1])) for r in rows[:500] if c - 1 < len(r)]) + 3
        ws.column_dimensions[get_column_letter(c)].width = min(max(width, 10), cap)


def _save(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── Import template ───────────────────────────────────────────────────────────

def build_template(helpdesk) -> bytes:
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    st = _styles()
    resolver = FieldResolver(helpdesk.id)
    fields = resolver.all_fields
    cats = list(AssetCategory.objects.filter(helpdesk=helpdesk, is_deleted=False, is_active=True)
                .order_by("sort_order", "name"))
    tops = [c for c in cats if c.parent_id is None]
    subs_by_parent: dict = {}
    for c in cats:
        if c.parent_id:
            subs_by_parent.setdefault(c.parent_id, []).append(c)
    statuses = list(AssetStatus.objects.order_by("sort_order", "name"))
    lists = {
        "Categories": [c.name for c in tops],
        "Sub-categories": sorted({c.name for c in cats if c.parent_id}, key=str.lower),
        "Statuses": [s.name for s in statuses],
        "Vendors": list(Vendor.objects.filter(is_active=True).values_list("name", flat=True)),
        "Locations": list(Location.objects.filter(is_active=True).values_list("name", flat=True)),
        "Departments": list(Department.objects.filter(is_active=True).values_list("name", flat=True)),
    }

    wb = Workbook()
    ws = wb.active
    ws.title = "Assets"
    headers = [f"{label} *" if req else label for _, label, req in IMPORT_COLUMNS]
    headers += [f.name for f in fields]
    _header_row(ws, 1, headers, st)
    ws.freeze_panes = "B2"
    for c, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(c)].width = min(max(len(h) + 4, 14), 36)

    # Which categories each detail field applies to (header comment).
    applies: dict = {f.id: [] for f in fields}
    for top in tops:
        for eff in resolver.for_category(top.id):
            applies[eff.field.id].append(top.name + (" *" if eff.required else ""))
        for sub in subs_by_parent.get(top.id, []):
            own = {link.field_id for link in resolver.links_by_category.get(sub.id, [])}
            for eff in resolver.for_category(top.id, sub.id):
                if eff.field.id in own:
                    applies[eff.field.id].append(f"{top.name} › {sub.name}" + (" *" if eff.required else ""))
    first_detail_col = len(IMPORT_COLUMNS) + 1
    for i, f in enumerate(fields):
        where = ", ".join(applies.get(f.id) or ["no category yet"])
        ws.cell(row=1, column=first_detail_col + i).comment = Comment(
            f"{f.get_field_type_display()} — applies to: {where}. * = required.", "OneDesk")

    # Lists sheet + drop-downs (warning style: a new vendor can still be typed when
    # "Create missing" is ticked).
    lst = wb.create_sheet("Lists")
    option_lists = [(f, [o.label for o in resolver.options_by_field.get(f.id, [])])
                    for f in fields if f.field_type in ("dropdown",)]
    columns = list(lists.items()) + [(f.name, labels) for f, labels in option_lists]
    _header_row(lst, 1, [name for name, _ in columns], st)
    ranges = {}
    for c, (name, values) in enumerate(columns, start=1):
        for r, v in enumerate(values, start=2):
            put(lst, r, c, v)
        if values:
            letter = get_column_letter(c)
            ranges[name] = f"=Lists!${letter}$2:${letter}${len(values) + 1}"
        lst.column_dimensions[get_column_letter(c)].width = 28

    def add_list(col_index, list_name, title):
        if list_name not in ranges:
            return
        dv = DataValidation(type="list", formula1=ranges[list_name], allow_blank=True,
                            showErrorMessage=True, errorStyle="warning",
                            errorTitle=title, error="That value isn't in the list. Keep it anyway?")
        letter = get_column_letter(col_index)
        dv.add(f"{letter}2:{letter}{TEMPLATE_ROWS + 1}")
        ws.add_data_validation(dv)

    col_of = {key: i for i, (key, _, _) in enumerate(IMPORT_COLUMNS, start=1)}
    add_list(col_of["category"], "Categories", "Category")
    add_list(col_of["sub_category"], "Sub-categories", "Sub-category")
    add_list(col_of["status"], "Statuses", "Status")
    add_list(col_of["vendor"], "Vendors", "Vendor")
    add_list(col_of["location"], "Locations", "Location")
    add_list(col_of["department"], "Departments", "Department")
    for i, f in enumerate(fields):
        if f.field_type == "dropdown":
            add_list(first_detail_col + i, f.name, f.name)

    # Fields by category.
    fbc = wb.create_sheet("Fields by category")
    _header_row(fbc, 1, ["Category", "Sub-category", "Detail fields (* = required)"], st)
    r = 2
    for top in tops:
        effs = resolver.for_category(top.id)
        put(fbc, r, 1, top.name)
        put(fbc, r, 3, ", ".join(e.field.name + (" *" if e.required else "") for e in effs) or "—")
        r += 1
        for sub in subs_by_parent.get(top.id, []):
            own = {link.field_id for link in resolver.links_by_category.get(sub.id, [])}
            effs = [e for e in resolver.for_category(top.id, sub.id) if e.field.id in own]
            put(fbc, r, 1, top.name)
            put(fbc, r, 2, sub.name)
            text = ", ".join(e.field.name + (" *" if e.required else "") for e in effs)
            put(fbc, r, 3, (text + " — plus " if text else "") + f"{top.name}'s fields")
            r += 1
    fbc.column_dimensions["A"].width = 24
    fbc.column_dimensions["B"].width = 24
    fbc.column_dimensions["C"].width = 100

    # Instructions.
    ins = wb.create_sheet("Instructions", 0)
    lines = [
        (f"Asset import template — {helpdesk.name}", "title"),
        ("", None),
        ("Fill one asset per row on the Assets sheet. Row 1 is the header; don't rename it.", None),
        ("Columns marked * are required. Asset Name and Category are always required.", None),
        ("Asset Tag: leave blank to get the next number "
         f"({helpdesk.key}-AST-00001…). A tag already used by another asset is an error.", None),
        ("Category / Sub-category / Status / Vendor / Location / Department: use the exact "
         "names from the Lists sheet (upper/lower case doesn't matter).", None),
        ("Status: leave blank for the default status. If the Expiry Date has already passed, "
         "a blank Status imports the asset as Expired.", None),
        ("An “In use” status needs a User or a Department.", None),
        ("User: the person's username or email address.", None),
        ("Dates: an Excel date, or text like 2026-03-31 or 31-03-2026 (day first).", None),
        ("Purchase Cost: a number such as 45000 or 45000.50.", None),
        ("Detail columns (after Warranty Expiry Date) only apply to some categories — see the "
         "“Fields by category” sheet, or hover a header. Leave the others blank.", None),
        ("Multi-select values: separate the choices with commas.", None),
        ("Rows with errors are skipped and listed on the import screen; the other rows are "
         "saved. Download the failed rows, fix them and upload that file again.", None),
        ("Import adds new assets only. It never changes existing assets.", None),
        (f"Up to {TEMPLATE_ROWS:,} rows and 10 MB per file.", None),
    ]
    for i, (text, kind) in enumerate(lines, start=1):
        cell = put(ins, i, 1, text)
        cell.alignment = st["wrap"]
        if kind == "title":
            cell.font = st["title_font"]
    ins.column_dimensions["A"].width = 120
    wb.active = wb.index(ws)
    return _save(wb)


# ── Export ────────────────────────────────────────────────────────────────────

EXPORT_COLUMNS = [
    "Asset Tag", "Asset Name", "Category", "Sub-category", "Status", "State Type", "Vendor",
    "Location", "User", "User Email", "Department", "Allotment Notes", "Allotted On",
    "Purchase Date", "Purchase Cost", "Expiry Date", "Warranty Expiry Date", "Created", "Updated",
]
STATE_LABELS = dict(StateType.choices)


def _local(value: dt.datetime | None, tz):
    """An aware datetime → naive org-local time (Excel has no time zones)."""
    if value is None:
        return None
    return value.astimezone(tz).replace(tzinfo=None)


def build_export(helpdesk, assets, *, summary: dict | None, scope_label: str) -> bytes:
    from openpyxl import Workbook

    from .parsing import org_timezone

    st = _styles()
    tz = org_timezone()  # once per export, not per cell
    resolver = FieldResolver(helpdesk.id)
    fields = resolver.all_fields
    wb = Workbook()

    cover = wb.active
    cover.title = "Summary"
    put(cover, 1, 1, f"Asset report — {helpdesk.name}").font = st["title_font"]
    put(cover, 2, 1, scope_label)
    if summary:
        group_label = summary["group_by"].replace("_", " ").title()
        _header_row(cover, 4, [group_label, "Assets", "%", "Total purchase cost"], st)
        r = 5
        for row in summary["rows"]:
            put(cover, r, 1, row["label"])
            put(cover, r, 2, row["count"])
            put(cover, r, 3, row["percent"])
            put(cover, r, 4, float(row["cost"]), number_format=MONEY_FMT)
            r += 1
        put(cover, r, 1, "Total").font = st["bold"]
        put(cover, r, 2, summary["total"]["count"]).font = st["bold"]
        put(cover, r, 4, float(summary["total"]["cost"]), number_format=MONEY_FMT).font = st["bold"]
    cover.column_dimensions["A"].width = 36
    cover.column_dimensions["B"].width = 12
    cover.column_dimensions["D"].width = 22

    ws = wb.create_sheet("Assets")
    headers = EXPORT_COLUMNS + [f.name for f in fields]
    _header_row(ws, 1, headers, st)
    ws.freeze_panes = "C2"
    sample: list[list] = []
    r = 2
    for a in assets:
        values = {}
        for v in a.field_values.all():
            values[v.field_id] = display(v.field, serialize(v.field.field_type, v),
                                         resolver.options_by_field.get(v.field_id))
        user = a.assigned_user
        row = [
            a.asset_tag, a.name, a.category.name, a.sub_category.name if a.sub_category else None,
            a.status.name, STATE_LABELS.get(a.status.state_type, a.status.state_type),
            a.vendor.name if a.vendor else None, a.location.name if a.location else None,
            ((user.full_name or "").strip() or user.username) if user else None,
            user.email if user else None, a.department.name if a.department else None,
            a.allotment_notes or None, _local(a.allotted_at, tz), a.purchase_date,
            float(a.purchase_cost) if a.purchase_cost is not None else None,
            a.expiry_date, a.warranty_expiry_date, _local(a.created_at, tz), _local(a.updated_at, tz),
        ] + [values.get(f.id) or None for f in fields]
        for c, value in enumerate(row, start=1):
            fmt = None
            if isinstance(value, (dt.date, dt.datetime)):
                fmt = DATE_FMT if not isinstance(value, dt.datetime) else "yyyy-mm-dd hh:mm"
            elif c == EXPORT_COLUMNS.index("Purchase Cost") + 1 and value is not None:
                fmt = MONEY_FMT
            put(ws, r, c, value, number_format=fmt)
        if len(sample) < 300:
            sample.append(["" if v is None else str(v) for v in row])
        r += 1
    if r == 2:
        put(ws, 2, 1, "No assets match these filters.")
    _widths(ws, headers, sample)
    return _save(wb)


# ── Failed rows ───────────────────────────────────────────────────────────────

def build_failed_rows(run) -> bytes:
    from openpyxl import Workbook

    st = _styles()
    wb = Workbook()
    ws = wb.active
    ws.title = "Assets"
    headers = [h for h in (run.headers or []) if h and str(h).strip().lower() != "errors"]
    out_headers = headers + ["Errors"]
    _header_row(ws, 1, out_headers, st)
    ws.freeze_panes = "B2"
    sample = []
    for r, row in enumerate(run.rows.all().order_by("row_number"), start=2):
        values = [row.data.get(h, "") for h in headers]
        errors = "; ".join(
            f"{e.get('column')}: {e.get('message')}" if e.get("column") else str(e.get("message"))
            for e in row.errors
        )
        values.append(f"Row {row.row_number}: {errors}")
        for c, v in enumerate(values, start=1):
            put(ws, r, c, v if v != "" else None)
        if len(sample) < 300:
            sample.append(values)
    _widths(ws, out_headers, sample, cap=60)
    return _save(wb)

