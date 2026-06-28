from __future__ import annotations

from datetime import date

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.itsm_rbac.permissions import HasModulePermission

from .services import export, reports

_XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ReportContentNegotiation(DefaultContentNegotiation):
    """Report endpoints use ``?format=xlsx|csv`` as their own export-file-type
    selector. That collides with DRF's URL_FORMAT_OVERRIDE content negotiation,
    which (finding no xlsx/csv renderer registered) raises ``Http404`` during
    ``initial()`` — before the view body ever runs. We negotiate to JSON instead
    (file responses are raw ``HttpResponse``s that ignore the renderer; error
    responses render as JSON), and the view reads ``format`` from the query itself.
    """

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type

# A single report request may span at most ~6 months. For a longer period (e.g. a
# full year) download in parts. Only enforced when BOTH bounds are given — the
# dashboard's open-ended `days` windows are unaffected. The longest 6-calendar-month
# span is ~183 days (end−start, e.g. Jul 1→Dec 31); 186 adds a few days of slack
# for month-length / tz / DST edges.
MAX_RANGE_DAYS = 186


class ReportViewSet(viewsets.ViewSet):
    """GET /reports/ → available reports.
    GET /reports/<name>/?helpdesk=&project=&group=&days= → one report (JSON).
    GET /reports/<name>/export/?format=xlsx|csv&helpdesk=&project=&… → one report file.
    GET /reports/export/?format=xlsx&helpdesk=&project=&… → combined Excel pack.
    """

    permission_classes = [HasModulePermission]
    module_code = "itsm.reports"
    # See ReportContentNegotiation: ?format=xlsx|csv is our export-type param, not
    # a DRF renderer selector. JSON-only renderer + this negotiator avoid the 404.
    renderer_classes = [JSONRenderer]
    content_negotiation_class = ReportContentNegotiation

    def list(self, request):
        return Response({"reports": sorted(reports.REPORTS.keys())})

    # ── shared scope resolution ──────────────────────────────────────────────
    def _scope_params(self, request):
        """Build the kwargs passed to a report fn, or return a DRF Response on
        an access error. Honours ``?helpdesk=`` (narrows to one workspace) while
        always keeping the accessible-helpdesk clamp.
        """
        from apps.itsm_helpdesks.services import is_project_accessible, resolve_helpdesk_scope
        from apps.itsm_projects.services import accessible_project_ids_cached

        params = {}
        for key in ("project", "group", "date_from", "date_to"):
            if request.query_params.get(key):
                params[key] = request.query_params[key]
        range_error = self._validate_range(params.get("date_from"), params.get("date_to"))
        if range_error is not None:
            return range_error
        if params.get("project") and not is_project_accessible(
                request.user, params["project"], request=request):
            return Response({"detail": "You do not have access to this helpdesk."}, status=403)
        # Helpdesk clamp: scope to ?helpdesk= when given (and accessible),
        # otherwise to every helpdesk the user can access. None ⇒ unrestricted.
        params["helpdesk_ids"] = resolve_helpdesk_scope(
            request.user, request.query_params.get("helpdesk"), request=request)
        # Finer per-user project clamp (strict whitelist; None ⇒ unrestricted) so a
        # default (no ?project=) report can't roll up an unassigned project's tickets.
        params["project_ids"] = accessible_project_ids_cached(request)
        raw_days = request.query_params.get("days")
        if raw_days:
            try:
                days = int(raw_days)
            except (TypeError, ValueError):
                return Response({"detail": "days must be an integer."}, status=400)
            if days <= 0:
                return Response({"detail": "days must be a positive integer."}, status=400)
            params["days"] = days
        return params

    @staticmethod
    def _validate_range(date_from, date_to):
        """Reject a request whose explicit range exceeds the 6-month cap, or whose
        bounds are out of order. Returns a 400 Response, or None when fine. Only
        fires when BOTH bounds are present (open-ended `days` windows are exempt)."""
        if not (date_from and date_to):
            return None
        try:
            start = date.fromisoformat(str(date_from)[:10])
            end = date.fromisoformat(str(date_to)[:10])
        except ValueError:
            return Response({"detail": "Invalid date; use YYYY-MM-DD."}, status=400)
        if end < start:
            return Response({"detail": "date_to must be on or after date_from."}, status=400)
        if (end - start).days > MAX_RANGE_DAYS:
            return Response(
                {"detail": "Date range may not exceed 6 months. Download a longer "
                           "period (e.g. a year) in parts."},
                status=400)
        return None

    @staticmethod
    def _run(fn, params):
        """Call a report fn, retrying without optional kwargs it doesn't accept
        (e.g. ``days`` — only the trend reports take it). Keeps the scope clamp
        AND the date-range filters so a period selection still applies to the
        distribution reports; only the unsupported extras are dropped."""
        try:
            return fn(**params)
        except TypeError:
            return fn(**{k: v for k, v in params.items()
                         if k in ("project", "group", "helpdesk_ids", "project_ids",
                                  "date_from", "date_to")})

    def retrieve(self, request, pk=None):
        fn = reports.REPORTS.get(pk)
        if fn is None:
            return Response({"detail": "Unknown report."}, status=404)
        params = self._scope_params(request)
        if isinstance(params, Response):
            return params
        return Response({"report": pk, "data": self._run(fn, params)})

    @action(detail=True, methods=["get"], url_path="export")
    def export_single(self, request, pk=None):
        """Download ONE report as Excel (one sheet) or CSV (one table).

        Same scope params as ``retrieve`` plus ``?format=xlsx|csv`` (default xlsx).
        """
        fn = reports.REPORTS.get(pk)
        if fn is None:
            return Response({"detail": "Unknown report."}, status=404)
        params = self._scope_params(request)
        if isinstance(params, Response):
            return params
        fmt = (request.query_params.get("format") or "xlsx").lower()
        if fmt not in ("xlsx", "csv"):
            return Response({"detail": "format must be xlsx or csv."}, status=400)

        data = self._run(fn, params)
        now = timezone.localtime()
        stamp = now.strftime("%Y%m%d-%H%M")
        if fmt == "csv":
            content = export.build_csv(pk, data)
            ct, ext = "text/csv; charset=utf-8", "csv"
        else:
            content = export.build_workbook(
                {pk: data}, scope_label=self._scope_label(request, params), generated_at=now)
            ct, ext = _XLSX_CT, "xlsx"
        resp = HttpResponse(content, content_type=ct)
        resp["Content-Disposition"] = f'attachment; filename="{pk}-{stamp}.{ext}"'
        return resp

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Download the standard report pack as one Excel workbook (xlsx only).

        Same scope params as ``retrieve``. CSV is per-report only (one table each),
        so the combined pack rejects ``format=csv`` — use ``/reports/<name>/export/``.
        """
        params = self._scope_params(request)
        if isinstance(params, Response):
            return params
        fmt = (request.query_params.get("format") or "xlsx").lower()
        if fmt != "xlsx":
            return Response(
                {"detail": "Combined export is xlsx only; use /reports/<name>/export/?format=csv."},
                status=400)

        report_data = {name: self._run(reports.REPORTS[name], params)
                       for name in reports.STANDARD_REPORTS}
        now = timezone.localtime()
        stamp = now.strftime("%Y%m%d-%H%M")
        content = export.build_workbook(
            report_data, scope_label=self._scope_label(request, params), generated_at=now)
        resp = HttpResponse(content, content_type=_XLSX_CT)
        resp["Content-Disposition"] = f'attachment; filename="itsm-reports-{stamp}.xlsx"'
        return resp

    @staticmethod
    def _scope_label(request, params):
        """Human label for the export cover page / sheet."""
        from apps.itsm_helpdesks.models import Helpdesk
        from apps.itsm_helpdesks.services import _resolve_helpdesk_id
        from apps.itsm_projects.models import Project

        parts = []
        hd_id = _resolve_helpdesk_id(request.query_params.get("helpdesk"))
        if hd_id:
            hd = Helpdesk.objects.filter(pk=hd_id).first()
            if hd:
                parts.append(f"Helpdesk: {hd.name}")
        if params.get("project"):
            proj = Project.objects.filter(pk=params["project"]).first()
            if proj:
                parts.append(f"Project: {proj.name}")
        if params.get("date_from") or params.get("date_to"):
            parts.append(f"{params.get('date_from', '…')} → {params.get('date_to', '…')}")
        return " · ".join(parts) if parts else "All accessible helpdesks"
