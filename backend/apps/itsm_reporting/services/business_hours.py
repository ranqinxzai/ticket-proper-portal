"""Business-time measurement for reports (SLA "Overdue by", resolution time).

Reuses the SLA engine's calendar math (``itsm_sla.business_time`` — lazy-imported so
reporting keeps working without the SLA app) and mirrors the engine's calendar
precedence, so a report's "business hours" are the same hours the SLA clocks count.

Build ONE ``BusinessClock`` per report call: it caches calendar specs and the
project → calendar map for that call only (calendars are tenant data — never share
an instance across requests / tenant schemas).
"""

from __future__ import annotations

_UNSET = object()


class BusinessClock:
    def __init__(self):
        try:
            from apps.itsm_sla import business_time
        except (ImportError, ModuleNotFoundError):  # SLA app not installed
            business_time = None
        self._bt = business_time
        self._specs: dict = {}
        self._default_cal = _UNSET
        self._project_map = None

    # ── calendar resolution ────────────────────────────────────────────────
    def default_calendar_id(self):
        """Mirror of ``sla_engine._default_calendar``: the is_default calendar, else any."""
        if self._default_cal is _UNSET:
            cid = None
            if self._bt is not None:
                from apps.itsm_sla.models import BusinessCalendar
                cid = (BusinessCalendar.objects.filter(is_default=True)
                       .values_list("id", flat=True).first()
                       or BusinessCalendar.objects.values_list("id", flat=True).first())
            self._default_cal = cid
        return self._default_cal

    def tracker_calendar_id(self, calendar_id):
        """The calendar an SLA tracker is measured on: its own snapshot, else the
        default — exactly what ``sla_engine._spec`` reads."""
        return calendar_id or self.default_calendar_id()

    def project_calendar_id(self, project_id):
        """Same precedence as ``sla_engine.start_trackers``: the project's calendar →
        its SLA policy's calendar (the project's own active policy, else the tenant
        default policy) → the default calendar. Approximation: a project policy's
        ``applies_to`` (priority / ticket type) filter is ignored."""
        if self._bt is None:
            return None
        if self._project_map is None:
            self._project_map = self._build_project_map()
        proj_cal, policy_cal, global_cal = self._project_map
        cid = proj_cal.get(project_id)
        if cid:
            return cid
        cid = policy_cal[project_id] if project_id in policy_cal else global_cal
        return cid or self.default_calendar_id()

    def _build_project_map(self):
        from apps.itsm_projects.models import Project
        from apps.itsm_sla.models import SLAPolicy

        proj_cal = dict(Project.all_objects.values_list("id", "calendar_id"))
        policy_cal: dict = {}
        for pid, cid in (SLAPolicy.objects.filter(is_active=True, project__isnull=False)
                         .order_by("created_at").values_list("project_id", "calendar_id")):
            policy_cal.setdefault(pid, cid)
        global_cal = (SLAPolicy.objects.filter(project__isnull=True, is_default=True,
                                               is_active=True)
                      .values_list("calendar_id", flat=True).first())
        return proj_cal, policy_cal, global_cal

    # ── measurement ──────────────────────────────────────────────────────────
    def _spec(self, calendar_id):
        if calendar_id not in self._specs:
            from apps.itsm_sla.models import BusinessCalendar
            # all_objects: an FK snapshot may point at a soft-deleted calendar, which
            # the engine still reads through the FK.
            cal = BusinessCalendar.all_objects.filter(pk=calendar_id).first()
            spec = None
            if cal is not None:
                try:
                    spec = self._bt.spec_from_calendar(cal)
                except Exception:  # noqa: BLE001 — bad calendar data ⇒ wall-clock
                    spec = None
            self._specs[calendar_id] = spec
        return self._specs[calendar_id]

    def minutes(self, calendar_id, start, end) -> float:
        """Business minutes between two instants on ``calendar_id`` (0 when end ≤ start).

        Wall-clock minutes when there is no calendar at all (the SLA clock is then
        24/7), the SLA app isn't installed, or the calendar can't be used (no working
        hours / bad timezone)."""
        if not start or not end or end <= start:
            return 0.0
        wall = (end - start).total_seconds() / 60.0
        if self._bt is None or not calendar_id:
            return wall
        spec = self._spec(calendar_id)
        if spec is None or not spec.has_any_window():
            return wall
        try:
            return self._bt.business_minutes_between(spec, start, end)
        except (self._bt.MisconfiguredCalendar, KeyError, ValueError):
            return wall
