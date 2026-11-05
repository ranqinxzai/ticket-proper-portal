"""Asset Management API (``/api/v1/t/<org>/itsm/…``).

Rule 15: every read is clamped to the caller's helpdesks via
``resolve_helpdesk_scope``; writes check the target helpdesk is accessible (403)
and that the category / sub-category / fields belong to it (400, in the service).
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import status as http_status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import User
from apps.accounts.serializers import UserDirectorySerializer
from apps.accounts.system_users import system_usernames
from apps.itsm_helpdesks.models import Helpdesk
from apps.itsm_helpdesks.services import (
    _resolve_helpdesk_id,
    accessible_helpdesk_ids_cached,
    resolve_helpdesk_scope,
)
from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission

from .models import (
    Asset,
    AssetCategory,
    AssetCategoryField,
    AssetDocument,
    AssetEvent,
    AssetField,
    AssetFieldValue,
    AssetImport,
    AssetStatus,
    Department,
    Location,
    Vendor,
)
from .permissions import ASSETS, CONFIG, IMPORT, AssetDocumentPermission, AssetLookupPermission
from .serializers import (
    AssetCategoryFieldSerializer,
    AssetCategorySerializer,
    AssetDetailSerializer,
    AssetDocumentSerializer,
    AssetEventSerializer,
    AssetFieldSerializer,
    AssetImportRowSerializer,
    AssetImportSerializer,
    AssetListSerializer,
    AssetStatusSerializer,
    AssetWriteSerializer,
    DepartmentSerializer,
    LocationSerializer,
    VendorSerializer,
)
from .services import asset_service, importer, summary, xlsx
from .services import documents as document_service
from .services.details import FieldResolver, field_definition
from .services.filters import apply_filters, apply_ordering
from .services.parsing import org_today
from .services.starter import load_starter

XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_LIVE_ASSETS = Q(assets__is_deleted=False)


def _xlsx_response(content: bytes, filename: str) -> HttpResponse:
    resp = HttpResponse(content, content_type=XLSX_CT)
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


def _scope(request):
    return resolve_helpdesk_scope(request.user, request.query_params.get("helpdesk"), request=request)


def _require_helpdesk(request, value) -> Helpdesk:
    """The one helpdesk a write / download targets. 400 if missing, 403 if not yours."""
    if not value:
        raise ValidationError({"helpdesk": ["Choose a helpdesk."]})
    hd_id = _resolve_helpdesk_id(value)
    hd = Helpdesk.objects.filter(pk=hd_id, is_deleted=False).first() if hd_id else None
    if hd is None:
        raise NotFound("That helpdesk doesn't exist.")
    accessible = accessible_helpdesk_ids_cached(request)
    if accessible is not None and hd.id not in accessible:
        raise PermissionDenied("You don't have access to this helpdesk.")
    if hd.status != "active":
        raise PermissionDenied("This helpdesk isn't active.")
    return hd


def _validation_response(exc: asset_service.AssetValidationError):
    return Response({"detail": "Please fix the highlighted fields.", "errors": exc.errors},
                    status=http_status.HTTP_400_BAD_REQUEST)


def _tag_conflict():
    return Response(
        {"detail": "That asset tag is already used by another asset.",
         "errors": {"asset_tag": ["That asset tag is already used by another asset."]}},
        status=http_status.HTTP_400_BAD_REQUEST)


def _stamp() -> str:
    return timezone.localtime().strftime("%Y%m%d-%H%M")


# ── Assets ────────────────────────────────────────────────────────────────────

class AssetViewSet(ItsmModelViewSet):
    module_code = ASSETS
    queryset = Asset.objects.filter(is_deleted=False)
    # Filtering, search and ordering are done by services.filters (DRF's default
    # OrderingFilter would otherwise re-order by raw FK ids).
    filter_backends: list = []

    def get_queryset(self):
        qs = Asset.objects.filter(is_deleted=False).select_related(
            "helpdesk", "category", "sub_category", "status", "vendor", "location", "department",
            "assigned_user")
        scope = _scope(self.request)
        if scope is not None:
            qs = qs.filter(helpdesk_id__in=scope)
        if self.action in ("list", "summary", "report", "export"):
            qs = apply_filters(qs, self.request.query_params, today=org_today())
        if self.action == "list":
            qs = apply_ordering(qs, self.request.query_params.get("ordering"))
        if self.action == "retrieve":
            qs = qs.select_related("created_by", "updated_by", "source_import").prefetch_related(
                Prefetch("field_values", queryset=AssetFieldValue.objects.select_related("field")))
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return AssetListSerializer
        if self.action == "retrieve":
            return AssetDetailSerializer
        return AssetWriteSerializer

    def _detail(self, asset, code=http_status.HTTP_200_OK):
        asset = Asset.objects.select_related(
            "helpdesk", "category", "sub_category", "status", "vendor", "location", "department",
            "assigned_user", "created_by", "updated_by", "source_import",
        ).prefetch_related(
            Prefetch("field_values", queryset=AssetFieldValue.objects.select_related("field"))
        ).get(pk=asset.pk)
        return Response(AssetDetailSerializer(asset).data, status=code)

    def create(self, request, *args, **kwargs):
        ser = AssetWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        helpdesk = _require_helpdesk(request, data.pop("helpdesk", None) or request.query_params.get("helpdesk"))
        details = data.pop("details", None)
        try:
            asset = asset_service.create_asset(helpdesk=helpdesk, data=data, details=details,
                                               actor=request.user)
        except asset_service.AssetValidationError as exc:
            return _validation_response(exc)
        except IntegrityError:
            return _tag_conflict()
        return self._detail(asset, http_status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        asset = self.get_object()
        ser = AssetWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        data.pop("helpdesk", None)  # an asset never moves between helpdesks
        details = data.pop("details", None)
        try:
            asset = asset_service.update_asset(asset, data=data, details=details, actor=request.user)
        except asset_service.AssetValidationError as exc:
            return _validation_response(exc)
        except IntegrityError:
            return _tag_conflict()
        return self._detail(asset)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        asset = self.get_object()
        asset_service.delete_asset(asset, actor=request.user)
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        asset = self.get_object()
        events = AssetEvent.objects.filter(asset=asset).select_related("actor").order_by("-created_at")
        return Response(AssetEventSerializer(events[:200], many=True).data)

    @action(detail=True, methods=["get"])
    def tickets(self, request, pk=None):
        """Tickets raised against this asset (live links), open ones first, newest
        first. Clamped like the queue (rule 15): the caller's helpdesks AND their
        per-user project whitelist, so a ticket they can't open is never listed."""
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached, scope_ticket_queryset
        from apps.itsm_projects.services import (
            accessible_project_ids_cached,
            scope_ticket_queryset_by_project,
        )
        from apps.itsm_tickets.models import Ticket, TicketAsset

        asset = self.get_object()
        links = TicketAsset.objects.filter(asset=asset, ticket__is_deleted=False)
        qs = Ticket.objects.filter(is_deleted=False, pk__in=links.values("ticket_id"))
        qs = scope_ticket_queryset(qs, accessible_helpdesk_ids_cached(request))
        qs = scope_ticket_queryset_by_project(qs, accessible_project_ids_cached(request))
        tickets = list(qs.select_related("project", "project__helpdesk", "status",
                                         "status__category", "requestor", "assignee")[:500])
        linked_at = dict(links.values_list("ticket_id", "created_at"))
        primary_of = set(Ticket.objects.filter(primary_asset=asset).values_list("pk", flat=True))

        def who(u):
            return ((u.full_name or "").strip() or u.username) if u else None

        rows = [{
            "id": str(t.pk), "ticket_number": t.ticket_number, "summary": t.summary,
            "helpdesk_key": t.project.helpdesk.key if t.project_id else None,
            "project_key": t.project.key if t.project_id else None,
            "status_name": t.status.name if t.status_id else None,
            "status_color": t.status.color if t.status_id else None,
            "status_category": t.status.category.key if t.status_id and t.status.category_id else None,
            "priority": t.priority, "requestor": who(t.requestor), "assignee": who(t.assignee),
            "created_at": t.created_at.isoformat(),
            "linked_at": linked_at[t.pk].isoformat() if t.pk in linked_at else None,
            "is_primary": t.pk in primary_of,
        } for t in tickets]
        rows.sort(key=lambda r: r["created_at"], reverse=True)   # newest first …
        rows.sort(key=lambda r: r["status_category"] == "done")  # … open ones on top (stable)
        return Response({"count": len(rows),
                         "open_count": sum(1 for r in rows if r["status_category"] != "done"),
                         "results": rows})

    # ── Documents (invoice, warranty card, manual, other) ────────────────────────
    # Read = Assets read; add / remove = Assets update (AssetDocumentPermission).
    # get_object() keeps rule 15: another helpdesk's asset is a 404.

    _DOC_RANK = {value: i for i, value in enumerate(AssetDocument.DocType.values)}
    _DOC_ID = r"documents/(?P<doc_id>[0-9a-fA-F-]{36})"

    def _document(self, asset, doc_id) -> AssetDocument:
        doc = AssetDocument.objects.filter(pk=doc_id, asset=asset, is_deleted=False).first()
        if doc is None:
            raise NotFound("That document doesn't exist.")
        return doc

    @action(detail=True, methods=["get", "post"], permission_classes=[AssetDocumentPermission])
    def documents(self, request, pk=None):
        """GET: the asset's documents, Invoice → Warranty card → Manual → Other, newest
        first within a type. POST (multipart ``file``, ``doc_type``, ``note``): add one."""
        asset = self.get_object()
        if request.method == "POST":
            try:
                doc = document_service.add_document(
                    asset, file=request.FILES.get("file"), doc_type=request.data.get("doc_type") or "",
                    note=request.data.get("note") or "", actor=request.user)
            except asset_service.AssetValidationError as exc:
                return _validation_response(exc)
            return Response(AssetDocumentSerializer(doc).data, status=http_status.HTTP_201_CREATED)
        docs = sorted(AssetDocument.objects.filter(asset=asset, is_deleted=False)
                      .select_related("uploaded_by").order_by("-created_at"),
                      key=lambda d: self._DOC_RANK.get(d.doc_type, len(self._DOC_RANK)))
        return Response(AssetDocumentSerializer(docs, many=True).data)

    @action(detail=True, methods=["delete"], url_path=_DOC_ID,
            permission_classes=[AssetDocumentPermission])
    def remove_document(self, request, pk=None, doc_id=None):
        asset = self.get_object()
        document_service.remove_document(self._document(asset, doc_id), actor=request.user)
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path=_DOC_ID + "/download",
            permission_classes=[AssetDocumentPermission])
    def download_document(self, request, pk=None, doc_id=None):
        """The file itself, always as an attachment, with the type stored at upload
        (decided from the extension) and ``nosniff``."""
        doc = self._document(self.get_object(), doc_id)
        try:
            handle = doc.file.open("rb")
        except OSError as exc:
            raise NotFound("The file is missing from storage.") from exc
        resp = FileResponse(handle, as_attachment=True, filename=doc.original_name or "document",
                            content_type=doc.content_type or "application/octet-stream")
        resp["X-Content-Type-Options"] = "nosniff"
        return resp

    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(summary.dashboard(self.get_queryset(), today=org_today()))

    @action(detail=False, methods=["get"])
    def report(self, request):
        return Response(summary.report(self.get_queryset(), request.query_params.get("group_by") or "category"))

    @action(detail=False, methods=["get"])
    def export(self, request):
        helpdesk = _require_helpdesk(request, request.query_params.get("helpdesk"))
        qs = self.get_queryset().filter(helpdesk=helpdesk).prefetch_related(
            Prefetch("field_values", queryset=AssetFieldValue.objects.select_related("field")))
        qs = apply_ordering(qs, request.query_params.get("ordering") or "asset_tag")
        group_by = request.query_params.get("group_by") or "category"
        content = xlsx.build_export(
            helpdesk, qs[:20000], summary=summary.report(qs, group_by),
            scope_label=f"Generated {timezone.localtime():%Y-%m-%d %H:%M} · "
                        f"{qs.count():,} assets (up to 20,000 exported)",
        )
        return _xlsx_response(content, f"assets-{helpdesk.key}-{_stamp()}.xlsx")

    @action(detail=False, methods=["get"], url_path="form-fields")
    def form_fields(self, request):
        """The detail fields for a category + sub-category, for the create/edit form."""
        category = AssetCategory.objects.filter(pk=_uuid(request.query_params.get("category"))).first()
        if category is None:
            return Response([])
        scope = _scope(request)
        if scope is not None and category.helpdesk_id not in scope:
            raise NotFound("That category doesn't exist.")
        sub_id = _uuid(request.query_params.get("sub_category"))
        eff = FieldResolver(category.helpdesk_id).for_category(category.id, sub_id)
        return Response([field_definition(e) for e in eff])


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


# ── Import ────────────────────────────────────────────────────────────────────

class AssetImportViewSet(ItsmModelViewSet):
    module_code = IMPORT
    serializer_class = AssetImportSerializer
    queryset = AssetImport.objects.all()
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = AssetImport.objects.select_related("created_by").order_by("-created_at")
        scope = _scope(self.request)
        if scope is not None:
            qs = qs.filter(helpdesk_id__in=scope)
        return qs

    def _run(self, request, *, dry_run):
        helpdesk = _require_helpdesk(request, request.data.get("helpdesk"))
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": ["Choose an Excel (.xlsx) file."]})
        if upload.size > importer.MAX_BYTES:
            raise ValidationError({"file": ["The file is larger than 10 MB. Split it into smaller files."]})
        create_missing = str(request.data.get("create_missing", "")).lower() in ("1", "true", "yes", "on")
        if create_missing and not check_permission(request.user, CONFIG, "create"):
            raise PermissionDenied(
                "Creating missing vendors, locations and departments needs the Asset "
                "Configuration Create permission.")
        try:
            result = importer.run_import(
                helpdesk, upload.read(), file_name=upload.name or "import.xlsx", actor=request.user,
                dry_run=dry_run, create_missing=create_missing)
        except importer.ImportFileError as exc:
            return Response({"detail": str(exc), "errors": {"file": [str(exc)]}},
                            status=http_status.HTTP_400_BAD_REQUEST)
        return Response(result, status=http_status.HTTP_200_OK if dry_run else http_status.HTTP_201_CREATED)

    def create(self, request, *args, **kwargs):
        return self._run(request, dry_run=False)

    @action(detail=False, methods=["post"])
    def validate(self, request):
        """Check a file without saving anything (a dry run)."""
        return self._run(request, dry_run=True)

    @action(detail=False, methods=["get"])
    def template(self, request):
        helpdesk = _require_helpdesk(request, request.query_params.get("helpdesk"))
        return _xlsx_response(xlsx.build_template(helpdesk), f"asset-import-template-{helpdesk.key}.xlsx")

    @action(detail=True, methods=["get"])
    def rows(self, request, pk=None):
        run = self.get_object()
        page = self.paginate_queryset(run.rows.all().order_by("row_number"))
        data = AssetImportRowSerializer(page, many=True).data
        return self.get_paginated_response(data)

    @action(detail=True, methods=["get"], url_path="failed-rows")
    def failed_rows(self, request, pk=None):
        run = self.get_object()
        stem = (run.file_name.rsplit(".", 1)[0] or "import")[:60]
        return _xlsx_response(xlsx.build_failed_rows(run), f"{stem}-failed-rows.xlsx")


# ── Configuration (statuses, masters, categories, fields) ────────────────────

class _LookupViewSet(ItsmModelViewSet):
    """Small lists: unpaginated (the client reads page 1 only), read with Assets OR
    Asset Configuration read, written with Asset Configuration."""

    module_code = CONFIG
    permission_classes = [AssetLookupPermission]
    pagination_class = None


class Refused(APIException):
    """A 400 whose body is ``{"detail": "<sentence>"}`` (a plain string)."""

    status_code = http_status.HTTP_400_BAD_REQUEST
    default_code = "refused"


def _in_use_error(count: int, noun: str):
    plural = "asset uses" if count == 1 else "assets use"
    raise Refused(f"{count} {plural} this {noun}, so it can't be deleted. Deactivate it instead, "
                  "or move those assets first.")


class AssetStatusViewSet(_LookupViewSet):
    serializer_class = AssetStatusSerializer
    queryset = AssetStatus.objects.all()

    def get_queryset(self):
        return AssetStatus.objects.annotate(
            asset_count=Count("assets", filter=_LIVE_ASSETS)).order_by("sort_order", "name")

    def perform_destroy(self, instance):
        if instance.is_default:
            raise Refused("This is the default status. Make another status the default first.")
        count = instance.assets.filter(is_deleted=False).count()
        if count:
            _in_use_error(count, "status")
        super().perform_destroy(instance)


class _MasterViewSet(_LookupViewSet):
    model = None
    noun = "item"
    search_fields = ["name", "code"]

    def get_queryset(self):
        qs = self.model.objects.annotate(asset_count=Count("assets", filter=_LIVE_ASSETS))
        active = self.request.query_params.get("active")
        if active in ("1", "true"):
            qs = qs.filter(is_active=True)
        return qs.order_by("name")

    def perform_destroy(self, instance):
        count = instance.assets.filter(is_deleted=False).count()
        if count:
            _in_use_error(count, self.noun)
        super().perform_destroy(instance)


class VendorViewSet(_MasterViewSet):
    model, noun = Vendor, "vendor"
    serializer_class = VendorSerializer
    queryset = Vendor.objects.all()
    search_fields = ["name", "contact_person", "email"]


class LocationViewSet(_MasterViewSet):
    model, noun = Location, "location"
    serializer_class = LocationSerializer
    queryset = Location.objects.all()


class DepartmentViewSet(_MasterViewSet):
    model, noun = Department, "department"
    serializer_class = DepartmentSerializer
    queryset = Department.objects.all()


class _HelpdeskScopedLookup(_LookupViewSet):
    def scoped(self, qs):
        scope = _scope(self.request)
        return qs if scope is None else qs.filter(helpdesk_id__in=scope)

    def _check_helpdesk(self, helpdesk):
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and helpdesk.id not in accessible:
            raise PermissionDenied("You don't have access to this helpdesk.")

    def perform_create(self, serializer):
        self._check_helpdesk(serializer.validated_data["helpdesk"])
        serializer.save()


class AssetCategoryViewSet(_HelpdeskScopedLookup):
    serializer_class = AssetCategorySerializer
    queryset = AssetCategory.objects.all()

    def get_queryset(self):
        qs = self.scoped(AssetCategory.objects.all()).annotate(
            asset_count=Count("assets", filter=_LIVE_ASSETS, distinct=True)
            + Count("sub_assets", filter=Q(sub_assets__is_deleted=False), distinct=True),
        ).prefetch_related(Prefetch(
            "field_links",
            queryset=AssetCategoryField.objects.select_related("field").filter(field__is_deleted=False),
            to_attr="_prefetched_links",
        ))
        if self.request.query_params.get("active") in ("1", "true"):
            qs = qs.filter(is_active=True)
        return qs.order_by("sort_order", "name")

    @transaction.atomic
    def perform_destroy(self, instance):
        ids = [instance.id] + list(instance.children.values_list("id", flat=True))
        count = Asset.objects.filter(Q(category_id__in=ids) | Q(sub_category_id__in=ids)).count()
        if count:
            _in_use_error(count, "category" if instance.parent_id is None else "sub-category")
        for child in instance.children.all():
            AssetCategoryField.objects.filter(category=child).delete()
            child.soft_delete(user=self.request.user)
        AssetCategoryField.objects.filter(category=instance).delete()
        instance.soft_delete(user=self.request.user)

    @action(detail=False, methods=["post"], url_path="load-starter")
    def load_starter(self, request):
        helpdesk = _require_helpdesk(request, request.data.get("helpdesk"))
        return Response(load_starter(helpdesk), status=http_status.HTTP_201_CREATED)


class AssetFieldViewSet(_HelpdeskScopedLookup):
    serializer_class = AssetFieldSerializer
    queryset = AssetField.objects.all()

    def get_queryset(self):
        return self.scoped(AssetField.objects.all()).annotate(
            value_count=Count("values", distinct=True)).order_by("name")

    @transaction.atomic
    def perform_destroy(self, instance):
        # Values stay in the database (hidden) — history keeps what they were.
        AssetCategoryField.objects.filter(field=instance).delete()
        instance.soft_delete(user=self.request.user)


class AssetCategoryFieldViewSet(_LookupViewSet):
    serializer_class = AssetCategoryFieldSerializer
    queryset = AssetCategoryField.objects.all()

    def get_queryset(self):
        qs = AssetCategoryField.objects.select_related("field", "category").filter(
            category__is_deleted=False, field__is_deleted=False)
        scope = _scope(self.request)
        if scope is not None:
            qs = qs.filter(category__helpdesk_id__in=scope)
        category = _uuid(self.request.query_params.get("category"))
        if category:
            qs = qs.filter(category_id=category)
        return qs.order_by("sort_order", "created_at")

    def _check(self, category):
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is not None and category.helpdesk_id not in accessible:
            raise PermissionDenied("You don't have access to this helpdesk.")

    def perform_create(self, serializer):
        self._check(serializer.validated_data["category"])
        serializer.save()


class AssetUserViewSet(viewsets.ReadOnlyModelViewSet):
    """User picker for the Allotment section: ``{id, username, full_name, email}``.
    Readable with Assets or Asset Configuration read (``/users/`` needs ticket access)."""

    serializer_class = UserDirectorySerializer
    permission_classes = [AssetLookupPermission]
    search_fields = ["username", "email", "full_name"]
    filterset_fields: list[str] = []

    def get_queryset(self):
        return (User.objects.filter(is_active=True).exclude(username__in=system_usernames())
                .order_by("full_name", "username", "id"))
