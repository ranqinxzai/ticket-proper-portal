from __future__ import annotations

import json
import uuid

from django.db import models
from django.db.models.functions import Coalesce, NullIf
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.response import Response

from apps.itsm_rbac.permissions import ItsmModelViewSet
from apps.itsm_rbac.services import check_permission
from apps.itsm_workflows.models import Transition
from apps.itsm_workflows.serializers import TransitionSerializer
from apps.itsm_workflows.services import engine

from .mixins import TicketNumberLookupMixin

from .models import (
    CannedNote,
    CannedNoteCategory,
    Comment,
    CommentAttachment,
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
    CommentAttachmentSerializer,
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
from .services import filter_fields as filter_registry
from .services import ticket_service


class AliasOrderingFilter(OrderingFilter):
    """OrderingFilter that maps friendly UI column names to safe DB ordering keys.

    Lets the frontend keep sending ``ordering=priority`` (severity order, not the
    alphabetical CharField), ``ordering=status``, ``ordering=assignee``, etc.;
    the alias is translated (sign preserved) before the normal allow-list check.
    """

    def get_ordering(self, request, queryset, view):
        params = request.query_params.get(self.ordering_param)
        if not params:
            return super().get_ordering(request, queryset, view)
        translated = []
        for term in (t.strip() for t in params.split(",")):
            if not term:
                continue
            sign, key = ("-", term[1:]) if term.startswith("-") else ("", term)
            translated.append(sign + filter_registry.ORDERING_ALIASES.get(key, key))
        valid = list(self.remove_invalid_fields(queryset, translated, view, request))
        return valid or self.get_default_ordering(view)


class TicketViewSet(TicketNumberLookupMixin, ItsmModelViewSet):
    queryset = Ticket.objects.filter(is_deleted=False).select_related(
        "project", "ticket_type", "status", "status__category", "assignee",
        "assigned_group", "requestor", "workflow", "created_by", "updated_by",
    ).prefetch_related("sla_trackers__metric")
    module_code = "itsm.tickets"
    filter_backends = [DjangoFilterBackend, SearchFilter, AliasOrderingFilter]
    search_fields = ["ticket_number", "summary", "description_text"]
    filterset_fields = {
        "project": ["exact"], "ticket_type": ["exact"], "status": ["exact"],
        "status__category": ["exact"], "priority": ["exact"],
        "assignee": ["exact", "isnull"], "assigned_group": ["exact"],
        "created_at": ["gte", "lte"],
    }
    # Allow-list of *translated* ordering keys (see AliasOrderingFilter +
    # filter_fields.ORDERING_ALIASES). The annotations below back the synthetic keys.
    ordering_fields = filter_registry.ORDERING_FIELDS
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
        from apps.itsm_projects.services import (
            accessible_project_ids_cached,
            scope_ticket_queryset_by_project,
        )
        from .services import query_builder
        qs = super().get_queryset()
        scope = self._helpdesk_scope()
        qs = scope_ticket_queryset(qs, scope)
        # Finer per-user project clamp (strict whitelist) — hides tickets in projects
        # the user isn't assigned to, even within an accessible helpdesk.
        pscope = accessible_project_ids_cached(self.request)
        qs = scope_ticket_queryset_by_project(qs, pscope)

        # Synthetic ordering keys (severity-correct priority, assignee display name).
        qs = qs.annotate(
            priority_rank=models.Case(
                *[models.When(priority=p, then=r)
                  for p, r in filter_registry.PRIORITY_RANK.items()],
                default=99, output_field=models.IntegerField(),
            ),
            assignee_name=Coalesce(
                NullIf("assignee__full_name", models.Value("")), "assignee__username",
            ),
        )

        saved_filter_id = self.request.query_params.get("saved_filter")
        if saved_filter_id and _is_uuid(saved_filter_id):
            from apps.itsm_dashboards.models import SavedFilter
            user = self.request.user
            # Only filters the requester owns or that are shared may be applied —
            # a bare pk lookup would let anyone run another user's private filter.
            sf_qs = SavedFilter.objects.filter(pk=saved_filter_id, is_deleted=False)
            sf_qs = (sf_qs.filter(models.Q(owner=user) | models.Q(is_shared=True))
                     if user.is_authenticated else sf_qs.filter(is_shared=True))
            sf = sf_qs.first()
            if sf:
                qs = qs.filter(query_builder.build_q(
                    sf.query_spec, user=self.request.user, accessible_helpdesk_ids=scope,
                    accessible_project_ids=pscope,
                )).distinct()

        # Ad-hoc operator-based filter: ?q=<url-encoded JSON {match, conditions}>.
        # Malformed / unknown fields are ignored (never 400 from get_queryset);
        # the same helpdesk clamp is applied so ad-hoc filters cannot leak.
        spec = self._parse_q()
        if spec:
            qs = qs.filter(query_builder.build_q(
                spec, user=self.request.user, accessible_helpdesk_ids=scope,
                accessible_project_ids=pscope,
            )).distinct()
        return qs

    def _parse_q(self):
        raw = self.request.query_params.get("q")
        if not raw:
            return None
        try:
            spec = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if not isinstance(spec, dict) or not isinstance(spec.get("conditions"), list):
            return None
        return spec

    @action(detail=False, methods=["get"], url_path="filter-fields")
    def filter_fields(self, request):
        """Filterable field registry + built-in system views for the queue UI."""
        project = request.query_params.get("project")
        if project and not _is_uuid(project):
            project = None  # bad project param → built-ins + global fields only
        return Response(filter_registry.filter_fields_payload(project))
    filter_fields.module_code = "itsm.tickets"

    @action(detail=False, methods=["get"], url_path="pulse")
    def pulse(self, request):
        """Cheap change-token for the current filter scope — polled by the live queue
        (every ~15s) to decide whether to silently refresh. Reuses the SAME scope and
        filters as ``list`` (helpdesk + per-project clamp, saved/ad-hoc ``q``, search),
        so it is tenant-isolated for free and never leaks another scope's tickets.
        Returns ``{version, count}``; ``version`` changes whenever a matching ticket is
        created, soft-deleted, or updated (``updated_at`` is ``auto_now``), and ``count``
        catches inserts/removals even within the same second."""
        qs = self.filter_queryset(self.get_queryset())
        agg = qs.aggregate(
            latest=models.Max("updated_at"),
            count=models.Count("id", distinct=True),
        )
        latest = agg["latest"]
        version = f"{int(latest.timestamp()) if latest else 0}:{agg['count']}"
        return Response({"version": version, "count": agg["count"]})
    pulse.module_code = "itsm.tickets"

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
        from apps.itsm_projects.services import accessible_project_ids_cached
        from .services import query_builder
        scope = accessible_helpdesk_ids_cached(request)
        pscope = accessible_project_ids_cached(request)
        ids = request.data.get("ids")
        if ids:
            qs = Ticket.objects.filter(pk__in=ids, is_deleted=False)
            if scope is not None:
                qs = qs.filter(project__helpdesk_id__in=scope)
            if pscope is not None:
                qs = qs.filter(project_id__in=pscope)
            tickets = list(qs)
        elif request.data.get("saved_filter_id"):
            sf = get_object_or_404(SavedFilter, pk=request.data["saved_filter_id"])
            tickets = list(query_builder.filtered_tickets(
                sf.query_spec, user=request.user, accessible_helpdesk_ids=scope,
                accessible_project_ids=pscope))
        else:
            return Response({"detail": "Provide ids or saved_filter_id."}, status=400)

        op = request.data.get("op")
        value = request.data.get("value")
        user = request.user if request.user.is_authenticated else None
        n = 0
        for t in tickets:
            if op == "assign":
                grp = (value or {}).get("group")
                asg = (value or {}).get("assignee")
                try:
                    # Skip tickets that would violate the project whitelist or the
                    # strict-membership rule rather than aborting the whole batch.
                    if grp:
                        ticket_service.ensure_group_allowed(t.project, grp)
                    ticket_service.ensure_assignee_in_group(grp or t.assigned_group_id, asg)
                except ValueError:
                    continue
                ticket_service.assign(ticket=t, assignee_id=asg, group_id=grp, user=user)
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
        # An explicitly-chosen group must be on the project's whitelist (if any).
        try:
            ticket_service.ensure_group_allowed(project, d.get("assigned_group"))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        # Strict assignment: a chosen assignee must belong to the chosen group
        # (or the project default group when none is given).
        if d.get("assignee"):
            group_id = d.get("assigned_group") or project.default_group_id
            try:
                ticket_service.ensure_assignee_in_group(group_id, d["assignee"])
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
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

    def update(self, request, *args, **kwargs):
        """Inline field edits from the detail view (PATCH/PUT).

        Routes every editable standard field through ``ticket_service.update_ticket``
        — the single write site that logs each change, re-emits ``Assigned`` and
        sanitises the description. Status changes still go through the workflow
        ``transition`` action; ``ticket_type``/``workflow`` are structural and stay
        read-only. Helpdesk scope + RBAC ``update`` are enforced upstream
        (get_object()/HasModulePermission)."""
        ticket = self.get_object()
        data = request.data
        changes = {}

        if "priority" in data:
            if data.get("priority") not in PRIORITY_CHOICES:
                return Response({"priority": ["Invalid priority."]},
                                status=http_status.HTTP_400_BAD_REQUEST)
            changes["priority"] = data["priority"]
        if "summary" in data:
            if not str(data.get("summary") or "").strip():
                return Response({"summary": ["Summary cannot be empty."]},
                                status=http_status.HTTP_400_BAD_REQUEST)
            changes["summary"] = data["summary"]
        for key in ("description_html", "impact", "urgency"):
            if key in data:
                changes[key] = data[key]
        try:
            if "requestor" in data:
                changes["requestor_id"] = _resolve_user_change(data["requestor"])
            if "assignee" in data:
                changes["assignee_id"] = _resolve_user_change(data["assignee"])
            if "assigned_group" in data:
                changes["group_id"] = _resolve_group_change(data["assigned_group"])
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            updated = ticket_service.update_ticket(
                ticket=ticket,
                user=request.user if request.user.is_authenticated else None,
                **changes,
            )
        except ValueError as exc:
            # e.g. strict-assignment violation (assignee not in the group).
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(TicketDetailSerializer(updated).data)

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
        # Strict: assignee must be a member of the resulting group; a newly-chosen
        # group must be on the project's whitelist (if any).
        group_id = request.data.get("group") or ticket.assigned_group_id
        try:
            if request.data.get("group"):
                ticket_service.ensure_group_allowed(ticket.project, request.data.get("group"))
            ticket_service.ensure_assignee_in_group(group_id, request.data.get("assignee"))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
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
            # Internal (private) notes are gated by the same module that gates reading them
            # (see the GET branch below). A user without it can only post public comments —
            # a forged ``visibility=private`` is rejected rather than silently downgraded.
            visibility = request.data.get("visibility", "public")
            if visibility == "private" and not check_permission(
                request.user, "itsm.tickets.comments_private", "read"
            ):
                return Response(
                    {"detail": "You do not have permission to add internal notes."},
                    status=http_status.HTTP_403_FORBIDDEN,
                )
            # Only users who are members of this ticket's helpdesk may be @mentioned —
            # otherwise an agent could pull in (or notify) someone with no access to it.
            from apps.itsm_helpdesks.services import helpdesk_member_ids
            allowed = {str(u) for u in helpdesk_member_ids(ticket.project.helpdesk_id)}
            mention_user_ids = [u for u in (request.data.get("mention_user_ids") or [])
                                if str(u) in allowed]
            comment = ticket_service.add_comment(
                ticket=ticket, author=request.user,
                body_html=request.data.get("body_html", ""),
                visibility=visibility,
                mention_user_ids=mention_user_ids,
                # Pre-uploaded inline images / file attachments to attach to this reply.
                attachment_ids=request.data.get("attachment_ids") or [],
            )
            return Response(CommentSerializer(comment, context={"request": request}).data,
                            status=http_status.HTTP_201_CREATED)
        qs = (ticket.comments.filter(is_deleted=False)
              .select_related("author").prefetch_related("attachments"))
        if not check_permission(request.user, "itsm.tickets.comments_private", "read"):
            qs = qs.filter(visibility="public")
        return Response(CommentSerializer(qs, many=True, context={"request": request}).data)

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


PRIORITY_CHOICES = {"critical", "high", "medium", "low"}

# Values that mean "clear this FK" on an inline edit (empty input / explicit null).
_CLEAR_VALUES = (None, "", 0, "0")


def _is_uuid(value) -> bool:
    """Guard query-param ids before they hit a UUID-PK lookup (else ValidationError)."""
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


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


def _resolve_user_change(raw):
    """Map an inline requestor/assignee edit to a User pk (or None to clear).
    A non-empty value that resolves to no user is a client error (400)."""
    if raw in _CLEAR_VALUES:
        return None
    u = _user(raw)
    if u is None:
        raise ValueError("User not found.")
    return u.pk


def _resolve_group_change(raw):
    """Map an inline group edit to a Group pk (or None to clear)."""
    if raw in _CLEAR_VALUES:
        return None
    g = _group(raw)
    if g is None:
        raise ValueError("Group not found.")
    return g.pk


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


class CommentAttachmentViewSet(ItsmModelViewSet):
    """Upload an inline image / file for a ticket comment.

    The composer uploads *before* the reply exists (it needs a URL to embed an
    inline image or show a file chip), so the upload is ticket-scoped with
    ``comment`` null; ``ticket_service.add_comment`` stamps ``comment`` when the
    reply is posted (via ``attachment_ids``). ``kind`` distinguishes an inline
    image (embedded by URL in the body) from a downloadable file (listed below)."""
    queryset = CommentAttachment.objects.filter(is_deleted=False)
    serializer_class = CommentAttachmentSerializer
    module_code = "itsm.tickets.comments"
    filterset_fields = ["ticket", "comment", "kind"]

    MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file

    def get_queryset(self):
        # Clamp reads to the caller's accessible helpdesks (mirror ticket scoping).
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        qs = super().get_queryset()
        scope = accessible_helpdesk_ids_cached(self.request)
        if scope is not None:
            qs = qs.filter(ticket__project__helpdesk_id__in=scope)
        return qs

    def create(self, request, *args, **kwargs):
        from rest_framework.exceptions import PermissionDenied, ValidationError
        from apps.itsm_helpdesks.services import is_project_accessible
        # `ticket` is the UUID pk (the FK). A human ticket_number ('ITINC-606')
        # would otherwise reach the UUID column inside get_object_or_404 and raise
        # an *unhandled* ValidationError → 500; reject it cleanly as a 400 instead.
        ticket_id = request.data.get("ticket")
        try:
            uuid.UUID(str(ticket_id))
        except (ValueError, TypeError):
            raise ValidationError({"ticket": ["A valid ticket id is required."]})
        ticket = get_object_or_404(Ticket, pk=ticket_id, is_deleted=False)
        if not is_project_accessible(request.user, ticket.project_id, request=request):
            raise PermissionDenied("You do not have access to this ticket.")
        f = request.FILES.get("file")
        if f is None:
            raise ValidationError({"file": ["A file is required."]})
        if f.size and f.size > self.MAX_BYTES:
            raise ValidationError(
                {"file": [f"File exceeds the {self.MAX_BYTES // (1024 * 1024)} MB limit."]})
        if request.data.get("kind") == "image" and not (
            getattr(f, "content_type", "") or ""
        ).startswith("image/"):
            raise ValidationError({"file": ["Inline attachments must be images."]})
        return super().create(request, *args, **kwargs)

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
    queryset = CannedNote.objects.filter(is_deleted=False).select_related(
        "category", "helpdesk", "project", "owner")
    serializer_class = CannedNoteSerializer
    module_code = "itsm.canned_notes"
    search_fields = ["title", "body_text", "shortcut"]
    filterset_fields = ["category", "scope", "helpdesk", "project", "is_shared"]

    def get_queryset(self):
        # Shared (workspace|project) notes are visible to MEMBERS of the note's
        # helpdesk; org-wide shared notes (null helpdesk) stay visible to every
        # agent; PERSONAL notes are visible only to their owner. Superuser ⇒ all.
        # Mirrors the product's row-level helpdesk scoping — a forged ?helpdesk=
        # can't widen it, since the clamp drops foreign-helpdesk notes regardless.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached

        qs = super().get_queryset()
        u = self.request.user
        accessible = accessible_helpdesk_ids_cached(self.request)
        if accessible is None:  # superuser — unrestricted
            return qs.filter(models.Q(is_shared=True) | models.Q(owner=u)).distinct()
        shared = models.Q(is_shared=True) & (
            models.Q(helpdesk_id__in=accessible) | models.Q(helpdesk__isnull=True))
        owner = models.Q(owner=u) if (u and u.is_authenticated) else models.Q(pk__in=[])
        return qs.filter(shared | owner).distinct()

    def perform_create(self, serializer):
        from apps.itsm_core.services.html import html_to_text, sanitize_html
        body = serializer.validated_data.get("body_html", "")
        serializer.save(body_html=sanitize_html(body), body_text=html_to_text(body),
                        owner=self.request.user if self.request.user.is_authenticated else None)

    def perform_update(self, serializer):
        # Re-sanitize + re-mirror body_text whenever the body changes (mirrors create).
        from apps.itsm_core.services.html import html_to_text, sanitize_html
        body = serializer.validated_data.get("body_html")
        if body is not None:
            serializer.save(body_html=sanitize_html(body), body_text=html_to_text(body))
        else:
            serializer.save()

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
