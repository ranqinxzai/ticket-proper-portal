"""Map an inbound email's priority signal → a ticket Priority.

Email clients express urgency several ways; we read them in order of reliability
and look each candidate up in the channel's editable ``priority_map``:

  - ``X-Priority``      ``1 (Highest)`` … ``5 (Lowest)``  → leading digit
  - ``Importance``      ``High`` | ``Normal`` | ``Low``
  - ``X-MSMail-Priority`` ``High`` | ``Normal`` | ``Low``
  - ``Priority``        ``urgent`` | ``normal`` | ``non-urgent``

The first candidate that yields a mapped value wins; otherwise we fall back to
``channel.default_priority``. The mapping is fully admin‑configurable per channel
(and visible in the mailbox config UI), so no signal is hard‑coded here.
"""

from __future__ import annotations

import re

from apps.itsm_tickets.models import Priority

_VALID = {p.value for p in Priority}
_DIGIT_RE = re.compile(r"\d")


def _candidates(headers: dict) -> list[str]:
    """Return the lower‑cased signal values to try, most reliable first."""
    h = {k.lower(): (v or "") for k, v in (headers or {}).items()}
    out: list[str] = []

    xpri = h.get("x-priority", "").strip()
    if xpri:
        m = _DIGIT_RE.search(xpri)
        out.append(m.group(0) if m else xpri.lower())

    for key in ("importance", "x-msmail-priority", "priority"):
        val = h.get(key, "").strip().lower()
        if val:
            out.append(val)
    return out


def resolve_priority(parsed, channel) -> str:
    """Return a valid ticket Priority for ``parsed`` per ``channel.priority_map``."""
    pmap = {str(k).strip().lower(): str(v).strip().lower()
            for k, v in (channel.priority_map or {}).items()}
    for cand in _candidates(parsed.headers):
        mapped = pmap.get(cand)
        if mapped in _VALID:
            return mapped
    default = (channel.default_priority or Priority.MEDIUM)
    return default if default in _VALID else Priority.MEDIUM
