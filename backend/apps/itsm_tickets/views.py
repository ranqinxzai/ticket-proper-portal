from __future__ import annotations

from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.serializers import TransitionSerializer
from apps.itsm_workflows.services import engine

from .models import (
    CannedNote,
    CannedNoteCategory,
    Comment,
    TemplateCategory,
    Ticket,
    TicketAttachment,
    TicketLink,
    TicketTemplate,
    Watcher,
)
from .serializers import (
    AuditEventSerializer,
    CannedNoteCategorySerializer,
    CannedNoteSerializer,
    CommentSerializer,
    TemplateCategorySerializer,
    TicketAttachmentSerializer,
    TicketCreateSerializer,
    TicketDetailSerializer,
    TicketLinkSerializer,
    TicketListSerializer,
    TicketTemplateSerializer,
    WatcherSerializer,
)
from .services import ticket_service


class TicketViewSet(ItsmModelViewSet):
    queryset = Ticket.objects.filter(is_deleted=False).select_related(
        "project", "ticket_type", "status", "status__category", "assignee",
        "assigned_group", "requestor", "workflow", "created_by",
    )
    module_code = "itsm.tickets"
    search_fields = ["ticket_number", "summary", "description_text"]
    filterset_fields = {
        "project": ["exact"], "ticket_type": ["exact"], "status": ["exact"],
        "status__category": ["exact"], "priority": ["exact"],
        "assignee": ["exact", "isnull"], "assigned_group": ["exact"],
        "created_at": ["gte", "lte"],
    }
    ordering_fields = ["created_at", "updated_at", "priority", "due_date", "ticket_number"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "create":
            return TicketCreateSerializer
        if self.action in ("list",):
            return TicketListSerializer
        return TicketDetailSerializer

    def _helpdesk_scope(self):
        """Resolved helpdesk-id scope for this request (None ⇒ unrestricted)."""
        from apps.itsm_helpdesks.services import resolve_helpdesk_scope
        return resolve_helpdesk_scope(
            self.request.user, self.request.query_params.get("helpdesk"), request=self.request
        )

    def get_queryset(self):
        from apps.itsm_helpdesks.services import scope_ticket_queryset
        from .services import query_builder
        qs = super().get_queryset()
        scope = self._helpdesk_scope()
        qs = scope_ticket_queryset(qs, scope)
        saved_filter_id = self.request.query_params.get("saved_filter")
        if saved_filter_id:
            from apps.itsm_dashboards.models import SavedFilter
            sf = SavedFilter.objects.filter(pk=saved_filter_id).first()
            if sf:
                qs = qs.filter(query_builder.build_q(
                    sf.query_spec, user=self.request.user, accessible_helpdesk_ids=scope,
                )).distinct()
        return qs

    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request):
        return self._bulk(request)
    bulk.module_code = "itsm.tickets.bulk"

    def _bulk(self, request):
        """Bulk op over explicit `ids` or a `saved_filter_id`. Body:
        {ids|saved_filter_id, op: assign|priority|watch|unwatch|delete, value}.

        Both branches bypass get_queryset, so the helpdesk scope is clamped here
        explicitly — a member of one helpdesk must not mutate another's tickets by
        guessing UUIDs."""
        from apps.itsm_dashboards.models import SavedFilter
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        from .services import query_builder
        scope = accessible_helpdesk_ids_cached(request)
        ids = request.data.get("ids")
        if ids:
            qs = Ticket.objects.filter(pk__in=ids, is_deleted=False)
            if scope is not None:
                qs = qs.filter(project__helpdesk_id__in=scope)
            tickets = list(qs)
        elif request.data.get("saved_filter_id"):
            sf = get_object_or_404(SavedFilter, pk=request.data["saved_filter_id"])
            tickets = list(query_builder.filtered_tickets(
                sf.query_spec, user=request.user, accessible_helpdesk_ids=scope))
        else:
            return Response({"detail": "Provide ids or saved_filter_id."}, status=400)

        op = request.data.get("op")
        value = request.data.get("value")
        user = request.user if request.user.is_authenticated else None
        n = 0
        for t in tickets:
            if op == "assign":
                ticket_service.assign(ticket=t, assignee_id=(value or {}).get("assignee"),
                                      group_id=(value or {}).get("group"), user=user)
            elif op == "priority":
                Ticket.objects.filter(pk=t.pk).update(priority=value)
            elif op == "watch":
                Watcher.objects.get_or_create(ticket=t, user=request.user)
            elif op == "unwatch":
                Watcher.objects.filter(ticket=t, user=request.user).delete()
            elif op == "delete":
                t.soft_delete(user=user)
            else:
                return Response({"detail": f"Unknown op '{op}'."}, status=400)
            n += 1
        return Response({"updated": n})

    def create(self, request, *args, **kwargs):
        ser = TicketCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        from apps.itsm_projects.models import Project, TicketType

        project = get_object_or_404(Project, pk=d["project"])
        ticket_type = get_object_or_404(TicketType, pk=d["ticket_type"])
        from apps.itsm_helpdesks.services import is_project_accessible
        if not is_project_accessible(request.user, project.pk, request=request):
            return Response({"detail": "You do not have access to this helpdesk."},
                            status=http_status.HTTP_403_FORBIDDEN)
        try:
            ticket = ticket_service.create_ticket(
                project=project, ticket_type=ticket_type, summary=d["summary"],
                description_html=d.get("description_html", ""), priority=d.get("priority", "medium"),
                impact=d.get("impact", ""), urgency=d.get("urgency", ""),
                source=d.get("source", "agent"),
                assigned_group=_group(d.get("assigned_group")),
                assignee=_user(d.get("assignee")),
                requestor=_user(d.get("requestor")),
                user=request.user if request.user.is_authenticated else None,
                custom_fields=d.get("custom_fields") or {},
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(TicketDetailSerializer(ticket).data, status=http_status.HTTP_201_CREATED)

    # ── workflow ────────────────────────────────────────────────────────────
    @action(detail=True, methods=["get"], url_path="available-transitions")
    def available_transitions(self, request, pk=None):
        ticket = self.get_object()
        items = engine.available_transitions(ticket, request.user)
        return Response(TransitionSerializer(items, many=True).data)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        ticket = self.get_object()
        transition = get_object_or_404(
            Transition, pk=request.data.get("transition_id"), workflow_id=ticket.workflow_id
        )
        comment_body = request.data.get("comment")
        try:
            result = engine.transition(
                ticket, transition, request.user,
                fields=request.data.get("fields") or {}, comment=comment_body,
            )
        except engine.TransitionError as exc:
            body = {"detail": exc.message}
            if exc.errors:
                body["errors"] = exc.errors
            return Response(body, status=exc.status_code)
        if comment_body:
            ticket_service.add_comment(
                ticket=result["ticket"], author=request.user, body_html=comment_body,
                visibility=request.data.get("comment_visibility", "public"),
            )
        return Response(TicketDetailSerializer(result["ticket"]).data)

    @action(detail=True, methods=["post"], url_path="set-fields")
    def set_fields(self, request, pk=None):
        """Upsert custom field values: body {custom_fields: {key: value}}."""
        ticket = self.get_object()
        from apps.itsm_core.services import fields as field_service
        field_service.set_values(
            ticket, request.data.get("custom_fields") or {},
            request.user if request.user.is_authenticated else None,
        )
        return Response(TicketDetailSerializer(ticket).data)

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        ticket = self.get_object()
        updated = ticket_service.assign(
            ticket=ticket, assignee_id=request.data.get("assignee"),
            group_id=request.data.get("group"),
            user=request.user if request.user.is_authenticated else None,
        )
        return Response(TicketDetailSerializer(updated).data)

    # ── watchers ──────────────────────────────────────────────────────────
    @action(detail=True, methods=["post", "delete"])
    def watch(self, request, pk=None):
        ticket = self.get_object()
        if request.method == "DELETE":
            Watcher.objects.filter(ticket=ticket, user=request.user).delete()
            return Response(status=http_status.HTTP_204_NO_CONTENT)
        Watcher.objects.get_or_create(ticket=ticket, user=request.user)
        return Response(status=http_status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def watchers(self, request, pk=None):
        ticket = self.get_object()
        return Response(WatcherSerializer(ticket.watchers.select_related("user"), many=True).data)

    # ── comments ────────────────────────────────────────────────────────────
    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        ticket = self.get_object()
        if request.method == "POST":
            # Only users who are members of this ticket's helpdesk may be @mentioned —
            # otherwise an agent could pull in (or notify) someone with no access to it.
            from apps.itsm_helpdesks.services import helpdesk_member_ids
            allowed = {str(u) for u in helpdesk_member_ids(ticket.project.helpdesk_id)}
            mention_user_ids = [u for u in (request.data.get("mention_user_ids") or [])
                                if str(u) in allowed]
            comment = ticket_service.add_comment(
                ticket=ticket, author=request.user,
                body_html=request.data.get("body_html", ""),
                visibility=request.data.get("visibility", "public"),
                mention_user_ids=mention_user_ids,
            )
            return Response(CommentSerializer(comment).data, status=http_status.HTTP_201_CREATED)
        qs = ticket.comments.filter(is_deleted=False).select_related("author")
        if not check_permission(request.user, "itsm.tickets.comments_private", "read"):
            qs = qs.filter(visibility="public")
        return Response(CommentSerializer(qs, many=True).data)

    # ── SLA ────────────────────────────────────────────────────────────────
    @action(detail=True, methods=["get"])
    def sla(self, request, pk=None):
        ticket = self.get_object()
        try:
            from apps.itsm_sla.models import SLATracker
            from apps.itsm_sla.services import sla_engine
        except (ImportError, ModuleNotFoundError):
            return Response([])
        trackers = SLATracker.objects.filter(ticket=ticket).select_related("metric")
        return Response([sla_engine.countdown_payload(t) for t in trackers])

    # ── activity feed ─────────────────────────────────────────────────────
    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        ticket = self.get_object()
        qs = ticket.activity.select_related("actor")[:200]
        return Response(AuditEventSerializer(qs, many=True).data)

    # ── templates ───────────────────────────────────────────────────────────
    @action(detail=False, methods=["post"], url_path="apply-template")
    def apply_template(self, request):
        """Return a prefill payload from a TicketTemplate for the create form."""
        tpl = get_object_or_404(TicketTemplate, pk=request.data.get("template_id"))
        from apps.itsm_helpdesks.services import is_project_accessible
        if tpl.project_id and not is_project_accessible(request.user, tpl.project_id, request=request):
            return Response({"detail": "Template belongs to a helpdesk you cannot access."},
                            status=http_status.HTTP_403_FORBIDDEN)
        return Response({
            "project": str(tpl.project_id) if tpl.project_id else None,
            "ticket_type": str(tpl.ticket_type_id) if tpl.ticket_type_id else None,
            "summary": tpl.summary_template,
            "description_html": tpl.description_html,
            "priority": tpl.default_priority,
            "assigned_group": str(tpl.default_group_id) if tpl.default_group_id else None,
            "assignee": str(tpl.default_assignee_id) if tpl.default_assignee_id else None,
            "custom_fields": tpl.field_defaults or {},
        })
    apply_template.module_code = "itsm.tickets.templates"

    # ── links ─────────────────────────────────────────────────────────────
    @action(detail=True, methods=["get", "post"])
    def links(self, request, pk=None):
        ticket = self.get_object()
        if request.method == "POST":
            # Don't allow linking to a ticket in a helpdesk the agent can't access
            # (it would leak the target's number/summary via the link serializer).
            from apps.itsm_helpdesks.services import is_project_accessible
            target = get_object_or_404(Ticket, pk=request.data["target_ticket"])
            if not is_project_accessible(request.user, target.project_id, request=request):
                return Response({"detail": "Target ticket is in a helpdesk you cannot access."},
                                status=http_status.HTTP_403_FORBIDDEN)
            link = TicketLink.objects.create(
                source_ticket=ticket, target_ticket=target,
                link_type=request.data["link_type"],
            )
            return Response(TicketLinkSerializer(link).data, status=http_status.HTTP_201_CREATED)
        return Response(TicketLinkSerializer(ticket.links_out.select_related("target_ticket"), many=True).data)


def _user(uid):
    if not uid:
        return None
    from django.contrib.auth import get_user_model
    return get_user_model().objects.filter(pk=uid).first()


def _group(gid):
    if not gid:
        return None
    from apps.itsm_groups.models import Group
    return Group.objects.filter(pk=gid).first()


class CommentViewSet(ItsmModelViewSet):
    queryset = Comment.objects.filter(is_deleted=False).select_related("author", "ticket")
    serializer_class = CommentSerializer
    module_code = "itsm.tickets.comments"
    filterset_fields = ["ticket", "visibility"]


class WatcherViewSet(ItsmModelViewSet):
    queryset = Watcher.objects.filter(is_deleted=False).select_related("user", "ticket")
    serializer_class = WatcherSerializer
    module_code = "itsm.tickets.watchers"
    filterset_fields = ["ticket", "user"]


class TicketLinkViewSet(ItsmModelViewSet):
    queryset = TicketLink.objects.filter(is_deleted=False).select_related("source_ticket", "target_ticket")
    serializer_class = TicketLinkSerializer
    module_code = "itsm.tickets.links"
    filterset_fields = ["source_ticket", "target_ticket"]


class TicketAttachmentViewSet(ItsmModelViewSet):
    queryset = TicketAttachment.objects.filter(is_deleted=False)
    serializer_class = TicketAttachmentSerializer
    module_code = "itsm.tickets"
    filterset_fields = ["ticket"]

    def perform_create(self, serializer):
        f = self.request.FILES.get("file")
        serializer.save(
            uploaded_by=self.request.user if self.request.user.is_authenticated else None,
            original_name=getattr(f, "name", ""), size_bytes=getattr(f, "size", 0),
            content_type=getattr(f, "content_type", ""),
        )


class CannedNoteCategoryViewSet(ItsmModelViewSet):
    queryset = CannedNoteCategory.objects.filter(is_deleted=False)
    serializer_class = CannedNoteCategorySerializer
    module_code = "itsm.canned_notes"


class CannedNoteViewSet(ItsmModelViewSet):
    queryset = CannedNote.objects.filter(is_deleted=False).select_related("category")
    serializer_class = CannedNoteSerializer
    module_code = "itsm.canned_notes"
    search_fields = ["title", "body_text", "shortcut"]
    filterset_fields = ["category", "is_shared"]

    def perform_create(self, serializer):
        from apps.itsm_core.services.html import html_to_text, sanitize_html
        body = serializer.validated_data.get("body_html", "")
        serializer.save(body_html=sanitize_html(body), body_text=html_to_text(body),
                        owner=self.request.user if self.request.user.is_authenticated else None)

    @action(detail=True, methods=["post"])
    def use(self, request, pk=None):
        """Increment usage count when a note is inserted into a comment."""
        CannedNote.objects.filter(pk=pk).update(usage_count=models.F("usage_count") + 1)
        return Response({"ok": True})


class TemplateCategoryViewSet(ItsmModelViewSet):
    queryset = TemplateCategory.objects.filter(is_deleted=False)
    serializer_class = TemplateCategorySerializer
    module_code = "itsm.tickets.templates"


class TicketTemplateViewSet(ItsmModelViewSet):
    queryset = TicketTemplate.objects.filter(is_deleted=False).select_related("category", "project")
    serializer_class = TicketTemplateSerializer
    module_code = "itsm.tickets.templates"
    search_fields = ["name", "description"]
    filterset_fields = ["project", "category", "is_active"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)
