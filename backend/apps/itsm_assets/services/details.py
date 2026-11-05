"""Detail-field engine: which fields apply to an asset, and typed values.

A trimmed cousin of ``itsm_rbac.user_attr_service`` with three deliberate fixes:
dates are real dates, a bad number / unknown choice is an ERROR (never a silent
blank), and dropdown values are checked against the field's live options.

Which fields apply = the links on the asset's category, plus the links on its
sub-category. A field linked at both levels takes the sub-category's link.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from decimal import Decimal

from ..models import (
    OPTION_FIELD_TYPES,
    AssetCategoryField,
    AssetField,
    AssetFieldOption,
    AssetFieldValue,
    FieldType,
)
from .parsing import is_blank, parse_bool, parse_date, parse_decimal

TEXT_MAX = 1000
_EMPTY = {
    "value_text": "",
    "value_number": None,
    "value_date": None,
    "value_bool": None,
    "value_json": None,
}


@dataclass
class EffectiveField:
    field: AssetField
    required: bool
    inherited: bool  # comes from the parent category (not the sub-category itself)
    options: list = dc_field(default_factory=list)  # live, active AssetFieldOption rows

    @property
    def key(self) -> str:
        return self.field.key

    def option_values(self) -> list[str]:
        return [o.value for o in self.options]


class FieldResolver:
    """Loads a helpdesk's fields, options and category links once (no per-row queries)."""

    def __init__(self, helpdesk_id):
        self.helpdesk_id = helpdesk_id
        fields = list(
            AssetField.objects.filter(helpdesk_id=helpdesk_id, is_deleted=False, is_active=True)
        )
        self.fields_by_id = {f.id: f for f in fields}
        self.options_by_field: dict = {f.id: [] for f in fields}
        for opt in AssetFieldOption.objects.filter(
            field_id__in=self.fields_by_id, is_deleted=False, is_active=True
        ).order_by("sort_order", "label"):
            self.options_by_field[opt.field_id].append(opt)
        self.links_by_category: dict = {}
        for link in AssetCategoryField.objects.filter(
            field_id__in=self.fields_by_id, category__is_deleted=False
        ).order_by("sort_order", "created_at"):
            self.links_by_category.setdefault(link.category_id, []).append(link)
        self._cache: dict = {}

    @property
    def all_fields(self) -> list[AssetField]:
        return sorted(self.fields_by_id.values(), key=lambda f: f.name.lower())

    def for_category(self, category_id, sub_category_id=None) -> list[EffectiveField]:
        cache_key = (category_id, sub_category_id)
        if cache_key in self._cache:
            return self._cache[cache_key]
        ordered: dict = {}
        # "inherited" = comes from the parent category of the chosen sub-category.
        for link in self.links_by_category.get(category_id, []):
            ordered[link.field_id] = (link, sub_category_id is not None)
        # A field linked at both levels takes the sub-category's link (re-assigning an
        # existing dict key keeps the category's position).
        for link in self.links_by_category.get(sub_category_id, []) if sub_category_id else []:
            ordered[link.field_id] = (link, False)
        out = []
        for field_id, (link, inherited) in ordered.items():
            f = self.fields_by_id.get(field_id)
            if f is None:
                continue
            out.append(EffectiveField(
                field=f, required=link.is_required, inherited=inherited,
                options=self.options_by_field.get(field_id, []),
            ))
        self._cache[cache_key] = out
        return out


def _match_option(eff: EffectiveField, raw) -> tuple[str | None, str | None]:
    text = str(raw).strip()
    for opt in eff.options:
        if opt.value == text:
            return opt.value, None
    low = text.lower()
    for opt in eff.options:
        if opt.value.lower() == low or opt.label.lower() == low:
            return opt.value, None
    choices = ", ".join(o.label for o in eff.options[:12]) or "none set up yet"
    return None, f"“{text}” isn't one of the choices ({choices})."


def coerce(eff: EffectiveField, raw) -> tuple[dict | None, str | None]:
    """Raw input → the typed ``value_*`` columns. Blank → ``(None, None)``."""
    t = eff.field.field_type
    if is_blank(raw):
        return None, None
    kw = dict(_EMPTY)
    if t == FieldType.TEXT:
        text = str(raw).strip()
        if len(text) > TEXT_MAX:
            return None, f"Keep this under {TEXT_MAX:,} characters."
        kw["value_text"] = text
    elif t == FieldType.NUMBER:
        value, err = parse_decimal(raw)
        if err:
            return None, err
        if abs(value) >= Decimal("1e18"):
            return None, "That number is too large."
        kw["value_number"] = value
    elif t == FieldType.DATE:
        value, err = parse_date(raw)
        if err:
            return None, err
        kw["value_date"] = value
    elif t == FieldType.CHECKBOX:
        value, err = parse_bool(raw)
        if err:
            return None, err
        kw["value_bool"] = value
    elif t == FieldType.DROPDOWN:
        value, err = _match_option(eff, raw)
        if err:
            return None, err
        kw["value_text"] = value
    elif t == FieldType.MULTISELECT:
        items = raw if isinstance(raw, (list, tuple)) else [
            p for p in str(raw).replace(";", ",").split(",")
        ]
        values = []
        for item in items:
            if is_blank(item):
                continue
            value, err = _match_option(eff, item)
            if err:
                return None, err
            if value not in values:
                values.append(value)
        if not values:
            return None, None
        kw["value_json"] = values
    else:  # pragma: no cover — unknown type
        kw["value_text"] = str(raw).strip()
    return kw, None


def serialize(field_type: str, row) -> object:
    """A stored value (an ``AssetFieldValue`` or kw dict) → a JSON-safe value."""
    get = row.get if isinstance(row, dict) else (lambda k: getattr(row, k))
    if field_type in (FieldType.TEXT, FieldType.DROPDOWN):
        return get("value_text") or None
    if field_type == FieldType.NUMBER:
        n = get("value_number")
        if n is None:
            return None
        text = format(Decimal(n).normalize(), "f")
        return text
    if field_type == FieldType.DATE:
        d = get("value_date")
        return d.isoformat() if d else None
    if field_type == FieldType.CHECKBOX:
        return get("value_bool")
    if field_type == FieldType.MULTISELECT:
        return list(get("value_json") or [])
    return get("value_text") or None


def display(field: AssetField, value, options=None) -> str:
    """A serialized value → human text (history, Excel export)."""
    if value is None or value == "" or value == []:
        return ""
    t = field.field_type
    labels = {o.value: o.label for o in (options or [])}
    if t == FieldType.CHECKBOX:
        return "Yes" if value else "No"
    if t == FieldType.DROPDOWN:
        return labels.get(value, str(value))
    if t == FieldType.MULTISELECT:
        return ", ".join(labels.get(v, str(v)) for v in value)
    return str(value)


def validate_values(
    eff_fields: list[EffectiveField], raw: dict, *, strict_unknown=False, known_keys=None,
) -> tuple[dict, dict]:
    """Validate ``{key: raw}`` against the fields that apply.

    Returns ``(clean, errors)``: ``clean`` maps field id → kw (None = clear);
    ``errors`` maps key → [message]. With ``strict_unknown`` (the import), a
    non-blank value for a field that doesn't apply is an error; the API ignores it.
    ``known_keys`` names the keys that exist in the helpdesk library (for messages).
    """
    raw = raw or {}
    clean: dict = {}
    errors: dict = {}
    by_key = {e.key: e for e in eff_fields}
    for eff in eff_fields:
        value = raw.get(eff.key)
        kw, err = coerce(eff, value)
        if err:
            errors[eff.key] = [err]
            continue
        if kw is None and eff.required:
            if eff.field.field_type in OPTION_FIELD_TYPES and not eff.options:
                clean[eff.field.id] = None  # an unconfigured dropdown can't be required
                continue
            errors[eff.key] = ["This field is required."]
            continue
        clean[eff.field.id] = kw
    if strict_unknown:
        for key, value in raw.items():
            if key not in by_key and not is_blank(value):
                errors[key] = ["This field doesn't apply to the chosen category."]
    return clean, errors


def values_for(asset) -> dict:
    """{key: serialized} of the asset's live, active fields (one query, or the prefetched cache)."""
    return {
        r.field.key: serialize(r.field.field_type, r)
        for r in asset.field_values.all()
        if not r.field.is_deleted and r.field.is_active
    }


def write_values(asset, eff_fields: list[EffectiveField], clean: dict | None, *, existing=None):
    """Upsert the asset's detail values and drop the ones that no longer apply.

    ``clean`` is ``validate_values``'s result (None = keep the current values of the
    fields that still apply). Returns history changes ``[{field,label,old,new}]``.
    """
    existing = existing if existing is not None else {
        r.field_id: r for r in AssetFieldValue.objects.filter(asset=asset).select_related("field")
    }
    eff_by_id = {e.field.id: e for e in eff_fields}
    changes = []

    # Values for fields that no longer apply (category changed / unlinked) are dropped.
    # A deactivated or deleted field's values are kept (hidden), so re-activating it
    # brings them back.
    for field_id, row in list(existing.items()):
        if row.field.is_deleted or not row.field.is_active:
            continue
        if field_id not in eff_by_id:
            old = display(row.field, serialize(row.field.field_type, row))
            if old:
                changes.append({"field": f"detail:{row.field.key}", "label": row.field.name,
                                "old": old, "new": None, "dropped": True})
            row.delete()
            existing.pop(field_id)

    if clean is None:
        return changes

    for field_id, kw in clean.items():
        eff = eff_by_id.get(field_id)
        if eff is None:
            continue
        row = existing.get(field_id)
        old_val = serialize(eff.field.field_type, row) if row else None
        new_val = serialize(eff.field.field_type, kw) if kw else None
        if old_val == new_val:
            continue
        if kw is None:
            row.delete()
        elif row is None:
            AssetFieldValue.objects.create(asset=asset, field=eff.field, **kw)
        else:
            for attr, val in kw.items():
                setattr(row, attr, val)
            row.save()
        changes.append({
            "field": f"detail:{eff.key}", "label": eff.field.name,
            "old": display(eff.field, old_val, eff.options) or None,
            "new": display(eff.field, new_val, eff.options) or None,
        })
    return changes


def field_definition(eff: EffectiveField) -> dict:
    """The shape the form renders (mirrors the user-attribute definition)."""
    return {
        "id": str(eff.field.id),
        "key": eff.field.key,
        "name": eff.field.name,
        "field_type": eff.field.field_type,
        "help_text": eff.field.help_text,
        "is_required": eff.required,
        "inherited": eff.inherited,
        "options": [{"id": str(o.id), "value": o.value, "label": o.label} for o in eff.options],
    }
