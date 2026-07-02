"""End-user Service Portal API for tickets.

Requestors have no helpdesk membership, so the agent queue is empty for them.
The portal scope is a separate clamp: a requestor sees only their OWN tickets and
only PUBLIC comments — never internal notes, assignee internals, or audit.
"""

from __future__ import annotations

from django.db.models import Count, Max
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.itsm_rbac.permissions import HasModulePermission
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.services import engine

from .mixins import TicketNumberLookupMixin
from .models import Comment, Ticket, TicketAttachment, Watcher
from .services import ticket_service

_PORTAL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file

# maps_to standard columns the portal detail reads straight off the ticket
# (mirrors PortalRequestIntakeViewSet._ALLOWED_MAPS_TO). Any other maps_to
# (assignee / assigned_group / requestor / source) is internal and never sent.
_PORTAL_STD_COLUMNS = {"summary", "description_html", "priority", "impact", "urgency"}


class PortalTicketSerializer(serializers.ModelSerializer):
    status_name = serializers.CharField(source="status.name", read_only=True)
    status_category = serializers.CharField(source="status.category.key", read_only=True)
    status_color = serializers.CharField(source="status.color", read_only=True)
    helpdesk_name = serializers.CharField(source="project.helpdesk.name", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True, default=None)

    class Meta:
        model = Ticket
        fields = ["id", "ticket_number", "summary", "description_html", "status_name",
                  "status_category", "status_color", "priority", "helpdesk_name",
                  "ticket_type_name", "created_at", "updated_at", "resolved_at"]


class PortalCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True, default=None)

    class Meta:
        model = Comment
        fields = ["id", "author_name", "body_html", "created_at"]


class PortalAttachmentSerializer(serializers.ModelSerializer):
    """Read shape for a ticket attachment shown on the portal. ``file`` renders an
    absolute URL only when the serializer context carries the request (cross-origin dev)."""

    class Meta:
        model = TicketAttachment
        fields = ["id", "file", "original_name", "size_bytes", "content_type", "created_at"]


class PortalWatcherSerializer(serializers.ModelSerializer):
    """Watcher shown on the portal — NAME ONLY. A requestor must never see another
    user's email (directory-privacy); add-by-email never echoes the directory either."""

    name = serializers.SerializerMethodField()

    class Meta:
        model = Watcher
        fields = ["id", "name"]

    def get_name(self, obj):
        u = obj.user
        return (u.full_name or u.username) if u else "—"


class PortalTransitionSerializer(serializers.ModelSerializer):
    """A portal-invokable transition (e.g. Reopen). Internal config — post_functions,
    conditions, note_visibility — is intentionally NOT exposed to the requestor."""

    to_status_name = serializers.CharField(source="to_status.name", read_only=True)
    to_status_category = serializers.CharField(source="to_status.category.key", read_only=True)

    class Meta:
        model = Transition
        fields = ["id", "name", "to_status_name", "to_status_category",
                  "note_prompt", "note_required", "note_heading"]


class PortalTicketViewSet(TicketNumberLookupMixin, viewsets.ReadOnlyModelViewSet):
    """A requestor's own tickets. Read + add a public reply."""

    serializer_class = PortalTicketSerializer
    permission_classes = [HasModulePermission]
    module_code = "itsm.portal.tickets"
    search_fields = ["ticket_number", "summary"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return (
            Ticket.objects.filter(requestor=self.request.user, is_deleted=False)
            .select_related("project", "project__helpdesk", "status", "status__category",
                            "ticket_type")
            .order_by("-created_at")
        )

    def retrieve(self, request, *args, **kwargs):
        """The ticket plus its portal-visible field layout (read-only) and the
        resolved value per field — so the requestor sees, in the project's own
        layout, every field an admin flagged ``portal_visible``. Internal fields
        never reach here: only portal_visible items are iterated, and any
        assignment/source maps_to is skipped as defence in depth."""
        from apps.itsm_core.serializers import FieldDefinitionSerializer, FieldLayoutSerializer
        from apps.itsm_core.services import fields as field_service

        ticket = self.get_object()  # 404s for tickets not owned by the requestor
        base = PortalTicketSerializer(ticket).data

        layout = field_service.get_layout(ticket.project, ticket.ticket_type)
        if layout:
            layout_data = FieldLayoutSerializer(layout).data
            layout_data["items"] = [
                it for it in layout_data["items"] if it.get("portal_visible", True)
            ]
        else:
            layout_data = {"id": None, "items": []}

        field_defs = field_service.get_field_definitions(ticket.project)
        field_values = self._portal_field_values(ticket, layout_data["items"], field_defs)

        # Only ship the definitions for portal-visible items (the frontend needs
        # them for option labels + field types). Shipping every project field
        # would leak internal field names/types/options the requestor can't see.
        visible_ids = {str(it.get("field")) for it in layout_data["items"]}
        portal_defs = [f for f in field_defs if str(f.id) in visible_ids]
        fields_data = FieldDefinitionSerializer(portal_defs, many=True).data

        atts = ticket.attachments.filter(is_deleted=False).order_by("created_at")
        attachments_data = PortalAttachmentSerializer(
            atts, many=True, context={"request": request}).data
        watchers_data = PortalWatcherSerializer(
            ticket.watchers.filter(is_deleted=False).select_related("user"), many=True).data

        return Response({**base, "layout": layout_data,
                         "fields": fields_data, "field_values": field_values,
                         "attachments": attachments_data, "watchers": watchers_data})

    def _portal_field_values(self, ticket, items, field_defs):
        """Display-ready value per portal-visible field key. Standard columns are
        read off the ticket; custom values come from the field engine; a
        user_picker is resolved to a name (never a bare id). Only keys for
        portal_visible items are emitted."""
        from apps.itsm_core.services import fields as field_service

        defs_by_key = {f.key: f for f in field_defs}
        custom = field_service.get_values(ticket)  # {key: serialized}; user_picker = id str
        out = {}
        for it in items:
            key = it.get("field_key")
            if not key:
                continue
            field = defs_by_key.get(key)
            maps_to = (getattr(field, "config", None) or {}).get("maps_to") if field else None
            if maps_to in _PORTAL_STD_COLUMNS:
                out[key] = getattr(ticket, maps_to, None)
            elif maps_to:
                continue  # assignment / source / requestor — internal, never sent
            elif field is not None and field.field_type == "user_picker":
                out[key] = self._portal_user_name(custom.get(key))
            else:
                out[key] = custom.get(key)
        return out

    @staticmethod
    def _portal_user_name(user_id):
        if not user_id:
            return None
        from django.contrib.auth import get_user_model
        u = (get_user_model().objects
             .filter(pk=user_id).only("full_name", "username").first())
        if u is None:
            return None
        return u.full_name or u.username

    @action(detail=False, methods=["get"], url_path="pulse")
    def pulse(self, request):
        """Change-token for the requestor's OWN tickets — polled by the portal
        "My requests" list to refresh silently. ``get_queryset`` already clamps to
        ``requestor=request.user``, so this only ever reflects the caller's tickets.
        Returns ``{version, count}`` (see ``TicketViewSet.pulse``)."""
        qs = self.filter_queryset(self.get_queryset())
        agg = qs.aggregate(latest=Max("updated_at"), count=Count("id", distinct=True))
        latest = agg["latest"]
        version = f"{int(latest.timestamp()) if latest else 0}:{agg['count']}"
        return Response({"version": version, "count": agg["count"]})
    pulse.module_code = "itsm.portal.tickets"

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        ticket = self.get_object()  # 404s for tickets not owned by the requestor
        if request.method == "POST":
            comment = ticket_service.add_comment(
                ticket=ticket, author=request.user,
                body_html=request.data.get("body_html", ""), visibility="public",
            )
            return Response(PortalCommentSerializer(comment).data, status=http_status.HTTP_201_CREATED)
        qs = ticket.comments.filter(is_deleted=False, visibility="public").select_related("author")
        return Response(PortalCommentSerializer(qs, many=True).data)

    # ── reopen / portal-allowed transitions ──────────────────────────────────
    @action(detail=True, methods=["get"], url_path="available-transitions")
    def available_transitions(self, request, pk=None):
        """The transitions a requestor may run from here — only those an admin flagged
        ``portal_allowed`` (e.g. Reopen). Conditions still apply on top."""
        ticket = self.get_object()  # 404s for tickets not owned by the requestor
        items = engine.available_transitions(ticket, request.user, portal_only=True)
        return Response(PortalTransitionSerializer(items, many=True).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """Run a portal-allowed transition (e.g. Reopen). Goes through the same engine
        choke-point as the agent path; an optional note lands as a PUBLIC comment."""
        ticket = self.get_object()  # ownership clamp
        tr = Transition.objects.filter(
            pk=request.data.get("transition_id"),
            workflow_id=ticket.workflow_id, portal_allowed=True,
        ).first()
        if tr is None:
            # 404 (not 403): don't confirm a non-portal transition exists.
            return Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        comment_body = request.data.get("comment")
        try:
            result = engine.transition(
                ticket, tr, request.user,
                fields=request.data.get("fields") or {}, comment=comment_body,
            )
        except engine.TransitionError as exc:
            body = {"detail": exc.message}
            if exc.errors:
                body["errors"] = exc.errors
            return Response(body, status=exc.status_code)
        if comment_body:
            # Force public — a requestor must never post an internal note.
            ticket_service.add_comment(
                ticket=result["ticket"], author=request.user,
                body_html=comment_body, visibility="public",
            )
        return Response(PortalTicketSerializer(result["ticket"]).data)

    # ── watchers (add/remove by email; never leaks the user directory) ────────
    @action(detail=True, methods=["get", "post"], url_path="watchers")
    def watchers(self, request, pk=None):
        ticket = self.get_object()  # ownership clamp
        if request.method == "POST":
            email = (request.data.get("email") or "").strip()
            if not email:
                return Response({"email": ["Email is required."]}, status=400)
            from django.contrib.auth import get_user_model

            # Exact (case-insensitive) match only — never enumerate the directory.
            user = (get_user_model().objects
                    .filter(email__iexact=email).order_by("id").first())
            if user is None:
                return Response({"detail": "No user with that email exists."},
                                status=http_status.HTTP_404_NOT_FOUND)
            watcher, _ = Watcher.objects.get_or_create(ticket=ticket, user=user)
            return Response(PortalWatcherSerializer(watcher).data,
                            status=http_status.HTTP_201_CREATED)
        qs = ticket.watchers.filter(is_deleted=False).select_related("user")
        return Response(PortalWatcherSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="watchers/remove")
    def remove_watcher(self, request, pk=None):
        """Remove a watcher. POST (not DELETE) because requestors hold create — not
        delete — on ``itsm.portal.tickets``; a DELETE would 403."""
        ticket = self.get_object()  # ownership clamp
        Watcher.objects.filter(ticket=ticket, pk=request.data.get("watcher_id")).delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


def _portal_default_ticket_type(project):
    """The project's default ticket type (else its first) — mirrors the catalog
    chokepoint (`itsm_catalog.services._default_ticket_type`) so the portal and the
    catalog pick the same type for the same project."""
    from apps.itsm_projects.models import TicketType
    return (
        TicketType.objects.filter(project=project, is_default=True, is_deleted=False).first()
        or TicketType.objects.filter(project=project, is_deleted=False).first()
    )


class PortalRequestIntakeViewSet(viewsets.ViewSet):
    """End-user "Create Request": workspaces → projects → the project's configured
    layout → create a ticket. Lives under ``itsm.portal.tickets`` (requestors hold
    read + create there), so GET actions check as *read* and the ``create`` POST as
    *create*. Requestors have no helpdesk membership, so this is a deliberate portal
    clamp (NOT the agent membership scope): every project/helpdesk is gated on
    active+active, never on membership. Assignment is always server-decided
    (routing / project default), never client-supplied. No approval is started at
    create — approvals fire on workflow transitions, exactly like an agent-created
    ticket."""

    permission_classes = [HasModulePermission]
    module_code = "itsm.portal.tickets"

    # ── scoping helpers ──────────────────────────────────────────────────────
    @staticmethod
    def _active_helpdesks():
        from apps.itsm_helpdesks.models import Helpdesk
        return Helpdesk.objects.filter(status="active", is_deleted=False)

    @staticmethod
    def _portal_projects(helpdesk_id=None):
        """Active projects in active helpdesks that have at least one ticket type
        (so a tile never dead-ends). Optionally narrowed to one helpdesk."""
        from apps.itsm_projects.models import Project
        qs = Project.objects.filter(
            status="active", is_deleted=False,
            helpdesk__status="active", helpdesk__is_deleted=False,
            ticket_types__is_deleted=False,
        ).distinct()
        return qs.filter(helpdesk_id=helpdesk_id) if helpdesk_id else qs

    def _portal_project(self, project_id):
        """A single create-eligible project (active, in an active helpdesk), or None.
        This is the authz boundary for `layout` + `create`."""
        if not project_id:
            return None
        return (self._portal_projects()
                .filter(pk=project_id).select_related("helpdesk").first())

    # ── actions ──────────────────────────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def workspaces(self, request):
        """All active helpdesks that have ≥1 create-eligible project."""
        hds = (self._active_helpdesks()
               .filter(projects__in=self._portal_projects())
               .distinct().order_by("order", "name"))
        return Response([
            {"id": str(h.id), "key": h.key, "name": h.name,
             "description": h.description, "icon": h.icon, "color": h.color}
            for h in hds
        ])

    @action(detail=False, methods=["get"])
    def projects(self, request):
        """Create-eligible projects in ``?helpdesk=<id|key>``."""
        from apps.itsm_helpdesks.services import _resolve_helpdesk_id
        from apps.itsm_projects.serializers import ProjectSerializer

        hd_id = _resolve_helpdesk_id(request.query_params.get("helpdesk"))
        if hd_id is None or not self._active_helpdesks().filter(pk=hd_id).exists():
            return Response({"detail": "Unknown workspace."}, status=404)
        qs = (self._portal_projects(hd_id)
              .select_related("helpdesk").prefetch_related("ticket_types").order_by("name"))
        return Response(ProjectSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"])
    def layout(self, request):
        """Resolve a create-eligible project's layout + field definitions in one
        portal-permitted call (the agent `/field-layouts/resolve/` + `/fields/`
        endpoints are closed to requestors)."""
        from apps.itsm_core.serializers import FieldDefinitionSerializer, FieldLayoutSerializer
        from apps.itsm_core.services import fields as field_service
        from apps.itsm_projects.models import TicketType

        project = self._portal_project(request.query_params.get("project"))
        if project is None:
            return Response({"detail": "Unknown project."}, status=404)
        tt_id = request.query_params.get("ticket_type")
        ticket_type = (TicketType.objects.filter(pk=tt_id, project=project).first()
                       if tt_id else None)
        layout = field_service.get_layout(project, ticket_type)
        if layout:
            layout_data = FieldLayoutSerializer(layout).data
            # Portal clamp: only items flagged portal_visible reach the requestor.
            # (Assignment / source / picker fields are backfilled to portal_visible=False;
            # an admin can opt any field in/out via the Layout designer's Portal toggle.)
            layout_data["items"] = [
                it for it in layout_data["items"] if it.get("portal_visible", True)
            ]
        else:
            layout_data = {"id": None, "items": []}
        fields = field_service.get_field_definitions(project)
        return Response({"layout": layout_data,
                         "fields": FieldDefinitionSerializer(fields, many=True).data})

    # maps_to standard columns the portal accepts (everything else is custom-field
    # data); assignment/source/requestor are forced server-side and never honoured
    # from the client even if a field maps to them. Impact/Urgency and the rest of the
    # ITIL Impact-Assessment / Resolution fields are agent-only (not portal-settable),
    # so they are deliberately excluded — a forged submission can never set them.
    _ALLOWED_MAPS_TO = {"summary", "description_html", "priority"}

    def create(self, request):
        """Raise a portal ticket against a create-eligible project.

        The client sends one ``fields`` dict keyed by **field key** (for every
        layout field). The server resolves each key's ``config.maps_to`` from the
        project's field definitions → standard column vs custom field, so the maps_to
        routing lives in one place and the portal can't spoof assignment. Forces
        ``requestor`` + ``source=portal``; validates mandatory layout fields."""
        from apps.itsm_core.services import fields as field_service

        project = self._portal_project(request.data.get("project"))
        if project is None:
            return Response({"detail": "This project is not accepting requests."}, status=400)
        # Defence in depth: a supplied workspace must match the project's helpdesk.
        hd_param = request.data.get("helpdesk")
        if hd_param:
            from apps.itsm_helpdesks.services import _resolve_helpdesk_id
            if _resolve_helpdesk_id(hd_param) != project.helpdesk_id:
                return Response({"detail": "Project does not belong to that workspace."}, status=400)

        ticket_type = _portal_default_ticket_type(project)
        if ticket_type is None:
            return Response({"detail": "This project is not accepting requests."}, status=400)

        raw = request.data.get("fields") or {}
        if not isinstance(raw, dict):
            return Response({"fields": ["Expected an object keyed by field key."]}, status=400)

        # Required-field validation FIRST, keyed by field key (the security backstop
        # against a tampered client; unconfigured option fields are skipped inside).
        # portal_only → a mandatory field hidden from the portal (portal_visible=False)
        # is never rendered, so it must not block requestor submission.
        errors = field_service.validate_required(project, ticket_type, raw, portal_only=True)
        if errors:
            return Response(errors, status=400)

        # Route field-key values: maps_to standard column vs custom field.
        defs = {f.key: f for f in field_service.get_field_definitions(project)}
        std, custom = {}, {}
        for key, val in raw.items():
            maps_to = (defs[key].config or {}).get("maps_to") if key in defs else None
            if maps_to in self._ALLOWED_MAPS_TO:
                std[maps_to] = val
            elif maps_to:
                continue  # assignee / assigned_group / requestor / source → forced
            elif val not in (None, "", []):
                custom[key] = val

        summary = str(std.get("summary") or "").strip()
        if not summary:
            return Response({"summary": ["This field is required."]}, status=400)

        ticket = ticket_service.create_ticket(
            project=project, ticket_type=ticket_type, summary=summary,
            description_html=std.get("description_html") or "",
            priority=std.get("priority") or "medium",
            impact=std.get("impact") or "", urgency=std.get("urgency") or "",
            requestor=request.user, source="portal", user=request.user,
            custom_fields=custom or None,
        )
        return Response({"id": str(ticket.id), "ticket_number": ticket.ticket_number},
                        status=http_status.HTTP_201_CREATED)
    create.module_code = "itsm.portal.tickets"

    @action(detail=True, methods=["post"], url_path="attachments")
    def attachments(self, request, pk=None):
        """Attach a file to one of the caller's OWN portal tickets (``pk`` is the
        ticket number). Ownership-scoped so a requestor can't attach to others'
        tickets; kept under ``itsm.portal.tickets`` (the agent attachment endpoint
        is ``itsm.tickets``, closed to requestors)."""
        ticket = Ticket.objects.filter(
            ticket_number=pk, requestor=request.user, is_deleted=False).first()
        if ticket is None:
            return Response({"detail": "Not found."}, status=http_status.HTTP_404_NOT_FOUND)
        f = request.FILES.get("file")
        if f is None:
            return Response({"detail": "file is required."}, status=400)
        if f.size > _PORTAL_ATTACHMENT_MAX_BYTES:
            return Response({"detail": "File too large (max 10 MB)."}, status=400)
        att = TicketAttachment.objects.create(
            ticket=ticket, file=f, uploaded_by=request.user,
            original_name=getattr(f, "name", ""), size_bytes=getattr(f, "size", 0),
            content_type=getattr(f, "content_type", ""),
        )
        return Response({"id": str(att.id)}, status=http_status.HTTP_201_CREATED)
    attachments.module_code = "itsm.portal.tickets"
