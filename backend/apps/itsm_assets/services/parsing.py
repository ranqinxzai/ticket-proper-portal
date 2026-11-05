"""Value parsing shared by the API, the detail-field engine and the Excel import.

Every parser returns ``(value, error)``: ``error`` is a user-facing sentence or None.
Blank input parses to ``(None, None)``.
"""

from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.utils import timezone

TRUE_WORDS = {"1", "true", "yes", "y", "on"}
FALSE_WORDS = {"0", "false", "no", "n", "off"}
MAX_COST = Decimal("999999999999.99")

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d")
DATE_HELP = "Use a date like 2026-03-31 (or 31-03-2026)."


def is_blank(raw) -> bool:
    if raw is None:
        return True
    if isinstance(raw, str):
        return raw.strip() == ""
    if isinstance(raw, (list, tuple)):
        return len(raw) == 0
    return False


def parse_date(raw):
    """A date from a ``date``/``datetime``, an Excel serial, ISO or day-first text."""
    if is_blank(raw):
        return None, None
    if isinstance(raw, dt.datetime):
        return raw.date(), None
    if isinstance(raw, dt.date):
        return raw, None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        # An Excel serial date in a cell that isn't formatted as a date.
        if 20000 <= raw <= 80000:
            from openpyxl.utils.datetime import from_excel

            return from_excel(raw).date(), None
        return None, DATE_HELP
    text = str(raw).strip()
    if "T" in text or " " in text:
        text = re.split(r"[T ]", text, maxsplit=1)[0]
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(text, fmt).date(), None
        except ValueError:
            continue
    return None, DATE_HELP


def parse_decimal(raw, *, label="number"):
    """A ``Decimal`` from a number or text (thousands separators allowed)."""
    if is_blank(raw):
        return None, None
    if isinstance(raw, bool):
        return None, f"Enter a {label}."
    if isinstance(raw, (int, float, Decimal)):
        text = str(raw)
    else:
        text = str(raw).strip().replace(",", "").replace(" ", "")
    try:
        value = Decimal(text)
    except (InvalidOperation, ValueError):
        return None, f"Enter a {label}."
    if not value.is_finite():
        return None, f"Enter a {label}."
    return value, None


def parse_cost(raw):
    """Purchase cost: ≥ 0, 2 decimals. A leading currency mark (₹, $, Rs, INR…) is ignored."""
    if isinstance(raw, str):
        raw = re.sub(r"^\s*(₹|\$|€|£|rs\.?|inr|usd)\s*", "", raw, flags=re.IGNORECASE)
    value, err = parse_decimal(raw, label="number, like 45000 or 45000.50")
    if err or value is None:
        return value, err
    if value < 0:
        return None, "The cost can't be negative."
    if value > MAX_COST:
        return None, "That cost is too large."
    return value.quantize(Decimal("0.01")), None


def parse_bool(raw):
    if is_blank(raw):
        return None, None
    if isinstance(raw, bool):
        return raw, None
    if isinstance(raw, (int, float)):
        if raw in (0, 1):
            return bool(raw), None
        return None, "Use Yes or No."
    text = str(raw).strip().lower()
    if text in TRUE_WORDS:
        return True, None
    if text in FALSE_WORDS:
        return False, None
    return None, "Use Yes or No."


def cell_text(raw) -> str:
    """A cell value as display text (for import error rows and history)."""
    if raw is None:
        return ""
    if isinstance(raw, dt.datetime):
        if raw.time() == dt.time(0, 0):
            return raw.date().isoformat()
        return raw.isoformat(sep=" ", timespec="minutes")
    if isinstance(raw, dt.date):
        return raw.isoformat()
    if isinstance(raw, bool):
        return "Yes" if raw else "No"
    if isinstance(raw, float) and raw.is_integer():
        return str(int(raw))
    return str(raw).strip()


def org_timezone():
    """The org's default business-calendar time zone (UTC when none is set)."""
    try:
        from apps.itsm_sla.models import BusinessCalendar

        name = (
            BusinessCalendar.objects.filter(is_default=True, is_deleted=False)
            .values_list("timezone", flat=True)
            .first()
        )
        return ZoneInfo(name) if name else dt.timezone.utc
    except Exception:  # noqa: BLE001 — a bad tz name or missing app falls back to UTC
        return dt.timezone.utc


def org_today() -> dt.date:
    """Today's date in the org's time zone — the day an Expiry Date is judged on."""
    return timezone.now().astimezone(org_timezone()).date()
