"""Excel import: good rows are saved, bad rows are skipped and kept for the screen.

Built for speed under gunicorn's 120 s timeout: the workbook is read in read-only
mode, every lookup is pre-loaded into a dict (no per-row queries or serializers),
and the valid rows are written with ``bulk_create``. The same validation as the
API is reused (``asset_service.validate_core`` + the detail-field engine).

Import is create-only: a row whose Asset Tag already exists is an error.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field as dc_field

from django.db import transaction
from django.utils import timezone

from apps.accounts.system_users import system_usernames

from ..models import (
    Asset,
    AssetCategory,
    AssetEvent,
    AssetFieldValue,
    AssetImport,
    AssetImportRow,
    AssetStatus,
    Department,
    FieldType,
    Location,
    Vendor,
)
from . import tags as tag_service
from .asset_service import LABELS, default_status, expire_target, validate_core
from .details import FieldResolver, validate_values
from .parsing import cell_text, is_blank, org_today, parse_cost, parse_date
from .xlsx import IMPORT_COLUMNS

MAX_ROWS = 5000
MAX_BYTES = 10 * 1024 * 1024
MAX_UNZIPPED = 150 * 1024 * 1024
FAILED_ROWS_IN_RESPONSE = 500

HEADER_ALIASES: dict[str, set[str]] = {
    "name": {"asset name", "name", "asset"},
    "asset_tag": {"asset tag", "tag", "asset id", "asset number"},
    "category": {"category"},
    "sub_category": {"sub-category", "sub category", "subcategory"},
    "status": {"status"},
    "vendor": {"vendor", "supplier"},
    "location": {"location"},
    "assigned_user": {"user", "allotted to", "assigned to", "allotted user", "assigned user"},
    "department": {"department"},
    "allotment_notes": {"allotment notes", "notes"},
    "purchase_date": {"purchase date"},
    "purchase_cost": {"purchase cost", "cost"},
    "expiry_date": {"expiry date"},
    "warranty_expiry_date": {"warranty expiry date", "warranty expiry", "warranty end date"},
}
_ALIAS = {alias: key for key, aliases in HEADER_ALIASES.items() for alias in aliases}
IGNORED_HEADERS = {"errors", "row"}
MASTERS = {"vendor": Vendor, "location": Location, "department": Department}
MASTER_PLURAL = {"vendor": "vendors", "location": "locations", "department": "departments"}


class ImportFileError(Exception):
    """The file as a whole can't be imported (wrong format, missing columns, too big)."""


def _norm_header(value) -> str:
    return " ".join(str(value or "").replace("*", " ").split()).lower()


def read_workbook(data: bytes):
    """→ (headers, [(excel_row_number, values)]). Blank rows are skipped."""
    if len(data) > MAX_BYTES:
        raise ImportFileError("The file is larger than 10 MB. Split it into smaller files.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if sum(i.file_size for i in zf.infolist()) > MAX_UNZIPPED:
                raise ImportFileError("The file is too large once unpacked. Split it into smaller files.")
    except zipfile.BadZipFile:
        raise ImportFileError("This isn't an Excel .xlsx file. Save it as .xlsx and try again.")
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 — openpyxl raises many types for corrupt files
        raise ImportFileError("The file couldn't be read as an Excel workbook.")
    try:
        ws = wb["Assets"] if "Assets" in wb.sheetnames else wb.worksheets[0]
        headers: list[str] | None = None
        rows: list[tuple[int, tuple]] = []
        for row_number, values in enumerate(ws.iter_rows(values_only=True), start=1):
            if headers is None:
                if any(not is_blank(v) for v in values):
                    headers = [cell_text(v) for v in values]
                elif row_number >= 10:
                    break
                continue
            if all(is_blank(v) for v in values):
                continue
            rows.append((row_number, values))
            if len(rows) > MAX_ROWS:
                raise ImportFileError(
                    f"The file has more than {MAX_ROWS:,} asset rows. Split it into smaller files.")
    finally:
        wb.close()
    if headers is None:
        raise ImportFileError("The file is empty.")
    while headers and not headers[-1]:
        headers.pop()
    return headers, rows


@dataclass
class _Row:
    row_number: int
    text: dict
    data: dict = dc_field(default_factory=dict)
    clean: dict = dc_field(default_factory=dict)
    pending: dict = dc_field(default_factory=dict)  # kind → name to create
    expired: bool = False
    errors: list = dc_field(default_factory=list)


class _Lookups:
    def __init__(self, helpdesk):
        from apps.accounts.models import User

        cats = list(AssetCategory.objects.filter(helpdesk=helpdesk))
        self.tops = {c.name.lower(): c for c in cats if c.parent_id is None}
        self.subs = {(c.parent_id, c.name.lower()): c for c in cats if c.parent_id}
        self.sub_names = {c.name.lower() for c in cats if c.parent_id}
        self.statuses = {}
        for s in AssetStatus.objects.all():
            self.statuses[s.name.lower()] = s
            self.statuses.setdefault(s.key.lower(), s)
        self.masters = {kind: {o.name.lower(): o for o in model.objects.all()}
                        for kind, model in MASTERS.items()}
        users = list(User.objects.filter(is_active=True).exclude(username__in=system_usernames()))
        self.by_username = {u.username.lower(): u for u in users}
        self.by_email: dict = {}
        for u in users:
            if u.email:
                self.by_email.setdefault(u.email.lower(), []).append(u)


def _map_headers(headers, resolver):
    by_name = {}
    for f in resolver.all_fields:
        by_name[f.name.lower()] = f
        by_name.setdefault(f.key.lower(), f)
    core: dict[str, int] = {}
    detail: dict[str, int] = {}
    warnings: list[str] = []
    for i, h in enumerate(headers):
        n = _norm_header(h)
        if not n or n in IGNORED_HEADERS:
            continue
        key = _ALIAS.get(n)
        if key and key not in core:
            core[key] = i
        elif n in by_name and by_name[n].key not in detail:
            detail[by_name[n].key] = i
        else:
            warnings.append(f"Column “{h}” isn't recognised, so it was ignored.")
    missing = [label for key, label, required in IMPORT_COLUMNS if required and key not in core]
    if missing:
        raise ImportFileError(
            f"The file has no {' or '.join(missing)} column. Download the template to see "
            "the expected columns.")
    return core, detail, warnings


def _validate_rows(helpdesk, headers, rows, *, create_missing):
    resolver = FieldResolver(helpdesk.id)
    core_cols, detail_cols, warnings = _map_headers(headers, resolver)
    look = _Lookups(helpdesk)
    fields_by_key = {f.key: f for f in resolver.all_fields}
    today = org_today()
    default, target = default_status(), expire_target()
    live_tags = tag_service.live_tags_lower()
    seen_tags: dict[str, int] = {}
    status_names = ", ".join(s.name for s in AssetStatus.objects.order_by("sort_order", "name")[:12])
    column_label = {key: headers[i] for key, i in core_cols.items()}
    for key, i in detail_cols.items():
        column_label[f"details.{key}"] = headers[i]

    def col(key):
        return (column_label.get(key) or LABELS.get(key) or key).replace(" *", "").strip()

    parsed: list[_Row] = []
    for row_number, values in rows:
        values = list(values) + [None] * (len(headers) - len(values))
        r = _Row(row_number=row_number,
                 text={h: cell_text(values[i]) for i, h in enumerate(headers) if h})

        def err(key, msg, r=r):
            r.errors.append({"column": col(key), "message": msg})

        def raw(key, values=values):
            i = core_cols.get(key)
            return values[i] if i is not None else None

        data: dict = {"name": cell_text(raw("name")), "asset_tag": cell_text(raw("asset_tag")),
                      "allotment_notes": cell_text(raw("allotment_notes"))}

        cat_text = cell_text(raw("category"))
        cat = look.tops.get(cat_text.lower()) if cat_text else None
        if not cat_text:
            err("category", "Enter a category.")
        elif cat is None:
            hint = (" It's a sub-category name — put it in Sub-category and its category here."
                    if cat_text.lower() in look.sub_names else "")
            err("category", f"“{cat_text}” isn't a category in this helpdesk.{hint}")
        data["category"] = cat
        sub_text = cell_text(raw("sub_category"))
        sub = None
        if sub_text and cat is not None:
            sub = look.subs.get((cat.id, sub_text.lower()))
            if sub is None:
                err("sub_category", f"“{sub_text}” isn't a sub-category of “{cat.name}”.")
        data["sub_category"] = sub

        status_text = cell_text(raw("status"))
        status = None
        if status_text:
            status = look.statuses.get(status_text.lower())
            if status is None:
                err("status", f"“{status_text}” isn't a status. Use one of: {status_names}.")

        for kind, model in MASTERS.items():
            text = cell_text(raw(kind))
            if not text:
                data[kind] = None
                continue
            obj = look.masters[kind].get(text.lower())
            if obj is None and create_missing:
                obj = model(name=" ".join(text.split())[:150])  # placeholder, created on save
                r.pending[kind] = obj.name
            elif obj is None:
                err(kind, f"“{text}” isn't in the {MASTER_PLURAL[kind].title()} list. Add it under "
                          f"Configuration → {MASTER_PLURAL[kind].title()}, or tick “Create missing "
                          "vendors, locations and departments”.")
            data[kind] = obj

        user_text = cell_text(raw("assigned_user"))
        data["assigned_user"] = None
        if user_text:
            u = look.by_username.get(user_text.lower())
            if u is None:
                matches = look.by_email.get(user_text.lower(), [])
                if len(matches) == 1:
                    u = matches[0]
                elif matches:
                    err("assigned_user", "More than one user has this email. Use the username.")
                else:
                    err("assigned_user", f"No active user with the username or email “{user_text}”.")
            data["assigned_user"] = u

        for key in ("purchase_date", "expiry_date", "warranty_expiry_date"):
            value, e = parse_date(raw(key))
            if e:
                err(key, e)
            data[key] = value
        cost, e = parse_cost(raw("purchase_cost"))
        if e:
            err("purchase_cost", e)
        data["purchase_cost"] = cost

        tag = tag_service.normalize(data["asset_tag"])
        if tag:
            if tag.lower() in live_tags:
                err("asset_tag", f"Asset tag “{tag}” is already used by another asset.")
            elif tag.lower() in seen_tags:
                err("asset_tag", f"Asset tag “{tag}” appears more than once in this file "
                                 f"(row {seen_tags[tag.lower()]}).")
            else:
                seen_tags[tag.lower()] = row_number

        if status is None and not status_text:
            expiry = data.get("expiry_date")
            if expiry and expiry < today and target is not None:
                status, r.expired = target, True
            else:
                status = default
        data["status"] = status

        # The shared business rules, so the row lists every problem at once. A column
        # that already has an error (e.g. an unknown category) isn't reported twice.
        already = {e["column"] for e in r.errors}
        for key, msgs in validate_core(data, helpdesk=helpdesk, today=today).items():
            if col(key) in already:
                continue
            for m in msgs:
                err(key, m)

        if cat is not None and not any(e["column"] in (col("category"), col("sub_category"))
                                       for e in r.errors):
            eff = resolver.for_category(cat.id, sub.id if sub else None)
            details = {}
            for key, i in detail_cols.items():
                v = values[i]
                f = fields_by_key[key]
                details[key] = cell_text(v) if f.field_type in (
                    FieldType.TEXT, FieldType.DROPDOWN, FieldType.MULTISELECT) else v
            clean, derr = validate_values(eff, details, strict_unknown=True)
            where = cat.name + (f" › {sub.name}" if sub else "")
            for key, msgs in derr.items():
                for m in msgs:
                    if m == "This field doesn't apply to the chosen category.":
                        m = f"This field doesn't apply to {where}. Leave it blank."
                    err(f"details.{key}", m)
            r.clean = clean
        r.data = data
        parsed.append(r)
    return parsed, warnings


def run_import(helpdesk, data: bytes, *, file_name: str, actor, dry_run: bool, create_missing: bool):
    headers, rows = read_workbook(data)
    parsed, warnings = _validate_rows(helpdesk, headers, rows, create_missing=create_missing)
    valid = [r for r in parsed if not r.errors]
    failed = [r for r in parsed if r.errors]

    def master_names(rows_):
        out = {}
        for kind in MASTERS:
            names = sorted({r.pending[kind] for r in rows_ if kind in r.pending}, key=str.lower)
            if names:
                out[MASTER_PLURAL[kind]] = names
        return out

    if dry_run:
        return {
            "dry_run": True,
            "total_rows": len(parsed),
            "valid_rows": len(valid),
            "failed_count": len(failed),
            "expired_count": sum(1 for r in valid if r.expired),
            "will_create": master_names(valid),
            "warnings": warnings,
            "failed_rows": [_row_out(r) for r in failed[:FAILED_ROWS_IN_RESPONSE]],
        }

    with transaction.atomic():
        tag_service.lock_tags()
        fresh = tag_service.live_tags_lower()
        for r in list(valid):
            tag = r.data["asset_tag"]
            if tag and tag.lower() in fresh:  # taken since validation (race)
                r.errors.append({"column": "Asset Tag",
                                 "message": f"Asset tag “{tag}” is already used by another asset."})
                valid.remove(r)
                failed.append(r)
        failed.sort(key=lambda r: r.row_number)

        created_masters = master_names(valid)
        for kind, model in MASTERS.items():
            names = {r.pending[kind] for r in valid if kind in r.pending}
            made = {}
            for name in names:
                obj = model.objects.filter(name__iexact=name).first() or model.objects.create(name=name)
                made[name.lower()] = obj
            for r in valid:
                if kind in r.pending:
                    r.data[kind] = made[r.pending[kind].lower()]

        file_tags = {r.data["asset_tag"].lower() for r in valid if r.data["asset_tag"]}
        auto = tag_service.allocate(helpdesk, sum(1 for r in valid if not r.data["asset_tag"]),
                                    taken_lower=fresh | file_tags)
        auto_iter = iter(auto)

        run = AssetImport.objects.create(
            helpdesk=helpdesk, file_name=file_name[:255], total_rows=len(parsed),
            created_count=len(valid), failed_count=len(failed),
            expired_count=sum(1 for r in valid if r.expired),
            created_masters=created_masters, headers=headers, warnings=warnings,
            created_by=actor if getattr(actor, "pk", None) else None,
        )
        now = timezone.now()
        assets, values, events = [], [], []
        for r in valid:
            d = r.data
            asset = Asset(
                helpdesk=helpdesk, name=d["name"], asset_tag=d["asset_tag"] or next(auto_iter),
                vendor=d["vendor"], category=d["category"], sub_category=d["sub_category"],
                status=d["status"], location=d["location"], assigned_user=d["assigned_user"],
                department=d["department"], allotment_notes=d["allotment_notes"],
                allotted_at=now if (d["assigned_user"] or d["department"]) else None,
                purchase_date=d["purchase_date"], purchase_cost=d["purchase_cost"],
                expiry_date=d["expiry_date"], warranty_expiry_date=d["warranty_expiry_date"],
                source_import=run, created_by=run.created_by, updated_by=run.created_by,
            )
            assets.append(asset)
            for field_id, kw in r.clean.items():
                if kw:
                    values.append(AssetFieldValue(asset=asset, field_id=field_id, **kw))
            note = f"Row {r.row_number} of {file_name}"[:200]
            if r.expired:
                note += " — imported as Expired (expiry date passed)"
            events.append(AssetEvent(asset=asset, actor=run.created_by,
                                     action=AssetEvent.Action.IMPORTED, note=note[:255]))
        Asset.objects.bulk_create(assets, batch_size=500)
        AssetFieldValue.objects.bulk_create(values, batch_size=1000)
        AssetEvent.objects.bulk_create(events, batch_size=1000)
        AssetImportRow.objects.bulk_create(
            [AssetImportRow(import_run=run, row_number=r.row_number, data=r.text, errors=r.errors)
             for r in failed],
            batch_size=1000,
        )
    return {
        "dry_run": False,
        "import_id": str(run.id),
        "total_rows": run.total_rows,
        "valid_rows": run.created_count,
        "failed_count": run.failed_count,
        "expired_count": run.expired_count,
        "will_create": created_masters,
        "warnings": warnings,
        "failed_rows": [_row_out(r) for r in failed[:FAILED_ROWS_IN_RESPONSE]],
    }


def _row_out(r: _Row) -> dict:
    return {"row_number": r.row_number, "data": r.text, "errors": r.errors}
