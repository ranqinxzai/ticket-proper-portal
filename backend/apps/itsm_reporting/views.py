from __future__ import annotations

from rest_framework import viewsets
from rest_framework.response import Response

from apps.itsm_rbac.permissions import HasModulePermission

from .services import reports


class ReportViewSet(viewsets.ViewSet):
    """GET /reports/ → available reports. GET /reports/<name>/?project=&group=&days="""

    permission_classes = [HasModulePermission]
    module_code = "itsm.reports"

    def list(self, request):
        return Response({"reports": sorted(reports.REPORTS.keys())})

    def retrieve(self, request, pk=None):
        fn = reports.REPORTS.get(pk)
        if fn is None:
            return Response({"detail": "Unknown report."}, status=404)
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached, is_project_accessible
        params = {}
        for key in ("project", "group", "date_from", "date_to"):
            if request.query_params.get(key):
                params[key] = request.query_params[key]
        # A requested project must belong to a helpdesk the user can access.
        if params.get("project") and not is_project_accessible(
                request.user, params["project"], request=request):
            return Response({"detail": "You do not have access to this helpdesk."}, status=403)
        # Helpdesk clamp (None ⇒ unrestricted) — kept on the TypeError retry below too.
        params["helpdesk_ids"] = accessible_helpdesk_ids_cached(request)
        if request.query_params.get("days"):
            params["days"] = int(request.query_params["days"])
        try:
            data = fn(**params)
        except TypeError:
            # report doesn't accept some param (e.g. days) — retry without extras,
            # but NEVER drop the helpdesk clamp.
            data = fn(**{k: v for k, v in params.items()
                         if k in ("project", "group", "helpdesk_ids")})
        return Response({"report": pk, "data": data})
