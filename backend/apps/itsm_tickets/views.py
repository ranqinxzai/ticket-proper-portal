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
        """Filterable field registry + built-in system views for the queue UI.

        With ``?project=<uuid>`` → that project's fields (single-project queue).
        Without a project → the **combined** queue: builtin fields + the UNION of
        custom fields across the caller's accessible projects in the resolved
        helpdesk scope (deduped by key — see ``filter_fields_payload_multi``)."""
        project = request.query_params.get("project")
        if project and _is_uuid(project):
            return Response(filter_registry.filter_fields_payload(project))
        from apps.itsm_projects.models import Project
        from apps.itsm_projects.services import accessible_project_ids_cached
        scope = self._helpdesk_scope()            # helpdesk-id list, or None (unrestricted)
        pscope = accessible_project_ids_cached(request)  # project-id list, or None
        projq = Project.objects.filter(is_deleted=False)
        if scope is not None:
            projq = projq.filter(helpdesk_id__in=scope)
        if pscope is not None:
            projq = projq.filter(id__in=pscope)
        return Response(filter_registry.filter_fields_payload_multi(list(projq)))
    filter_fields.module_code = "itsm.tickets"

    # Cap the custom-field columns a single combined-queue page may request, so a
    # crafted ?cf= can't balloon the per-page value fetch.
    CF_COLUMN_LIMIT = 12

    def _requested_cf_keys(self):
        """Parse ``?cf=cf:a,cf:b`` (or ``a,b``) → a capped, de-duped list of bare
        custom-field keys for the combined queue's custom columns."""
        raw = self.request.query_params.get("cf")
        if not raw:
            return []
        keys: list[str] = []
        for tok in raw.split(","):
            tok = tok.strip()
            if tok.startswith("cf:"):
                tok = tok[3:]
            if tok and tok not in keys:
                keys.append(tok)
        return keys[: self.CF_COLUMN_LIMIT]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["custom_values"] = getattr(self, "_custom_values", None)
        ctx["custom_value_keys"] = getattr(self, "_custom_value_keys", None)
        return ctx

    def list(self, request, *args, **kwargs):
        """List override that attaches display-ready ``custom_values`` for the custom
        columns the combined queue asked for (``?cf=``). Values are batch-resolved for
        the current page only (no N+1); without ``?cf=`` this is the plain DRF list."""
        self._custom_value_keys = self._requested_cf_keys()
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else list(queryset)
        if self._custom_value_keys:
            from apps.itsm_core.services import fields as field_service
            self._custom_values = field_service.custom_column_values(
                [t.id for t in rows], self._custom_value_keys,
            )
        serializer = self.get_serializer(rows, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

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
                business_impact=d.get("business_impact", ""),
                users_affected=d.get("users_affected"),
                service_downtime=d.get("service_downtime"),
                major_incident=d.get("major_incident", False),
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
        for key in ("description_html", "impact", "urgency",
                    "business_impact", "root_cause", "resolution_notes"):
            if key in data:
                changes[key] = data[key]
        if "resolution_code" in data:
            rc = data.get("resolution_code") or ""
            if rc and rc not in RESOLUTION_CODE_CHOICES:
                return Response({"resolution_code": ["Invalid resolution code."]},
                                status=http_status.HTTP_400_BAD_REQUEST)
            changes["resolution_code"] = rc
        if "users_affected" in data:
            ua = data.get("users_affected")
            if ua in (None, ""):
                changes["users_affected"] = None
            else:
                try:
                    n = int(ua)
                except (ValueError, TypeError):
                    return Response({"users_affected": ["Must be a whole number."]},
                                    status=http_status.HTTP_400_BAD_REQUEST)
                if n < 0:
                    return Response({"users_affected": ["Must be zero or more."]},
                                    status=http_status.HTTP_400_BAD_REQUEST)
                changes["users_affected"] = n
        for key in ("service_downtime", "workaround_provided"):
            if key in data:
                changes[key] = _bool_or_none(data.get(key))
        if "major_incident" in data:
            changes["major_incident"] = _as_bool(data.get("major_incident"))
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
        data = TransitionSerializer(items, many=True).data
        # Attach the resolved transition-screen fields (e.g. the Incident Resolve
        # screen) so the client's slide-over can render controls per field type.
        screens = _resolve_screen_fields(ticket.project, items)
        for row, tr in zip(data, items):
            row["screen_fields"] = screens.get(tr.id, [])
        return Response(data)

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
        """List (GET) or add (POST) links for this ticket.

        GET returns a merged inbound+outbound list normalized to *this* ticket's
        perspective; POST adds ``this → target`` from ``{target_ticket, link_type}``.
        Removal is ``POST links/unlink`` — agents have create/update but not delete
        on ``itsm.tickets.links`` (see itsm_rbac.registry.AGENT_RW_MODULES), so an
        HTTP DELETE would 403 the very agents meant to manage links.
        """
        ticket = self.get_object()
        if request.method == "GET":
            return Response(_link_items_for(ticket))

        # POST — add a link this ticket → target.
        target_id = request.data.get("target_ticket")
        link_type = request.data.get("link_type")
        if not _is_uuid(target_id) or link_type not in TicketLink.LinkType.values:
            return Response({"detail": "target_ticket (id) and a valid link_type are required."},
                            status=http_status.HTTP_400_BAD_REQUEST)
        target = get_object_or_404(Ticket, pk=target_id)
        if target.id == ticket.id:
            return Response({"detail": "A ticket cannot be linked to itself."},
                            status=http_status.HTTP_400_BAD_REQUEST)
        # Don't allow linking to a ticket in a helpdesk the agent can't access
        # (it would leak the target's number/summary via the link payload).
        from apps.itsm_helpdesks.services import is_project_accessible
        if not is_project_accessible(request.user, target.project_id, request=request):
            return Response({"detail": "Target ticket is in a helpdesk you cannot access."},
                            status=http_status.HTTP_403_FORBIDDEN)
        link = ticket_service.link_tickets(
            source=ticket, target=target, link_type=link_type, user=request.user,
        )
        labels = dict(TicketLink.LinkType.choices)
        return Response(_link_item(link, "out", link.link_type, target, labels),
                        status=http_status.HTTP_201_CREATED)
    links.module_code = "itsm.tickets.links"

    @action(detail=True, methods=["post"], url_path="links/unlink")
    def unlink(self, request, pk=None):
        """Remove a link touching this ticket, by ``{link_id}``.

        POST (not DELETE) so agents — who lack the delete bit on this module — can
        still remove links. Only links whose source OR target is THIS (already
        helpdesk-scoped) ticket are removable, so an agent can never unlink a pair
        outside their accessible scope (rule 15).
        """
        ticket = self.get_object()
        link_id = request.data.get("link_id")
        if not _is_uuid(link_id):
            return Response({"detail": "A valid link_id is required."},
                            status=http_status.HTTP_400_BAD_REQUEST)
        link = TicketLink.objects.filter(pk=link_id).filter(
            models.Q(source_ticket=ticket) | models.Q(target_ticket=ticket)
        ).first()
        if link is None:
            return Response(status=http_status.HTTP_404_NOT_FOUND)
        ticket_service.unlink_tickets(ticket=ticket, link=link, user=request.user)
        return Response(status=http_status.HTTP_204_NO_CONTENT)
    unlink.module_code = "itsm.tickets.links"


PRIORITY_CHOICES = {"critical", "high", "medium", "low"}
RESOLUTION_CODE_CHOICES = {"fixed", "workaround", "duplicate", "user_error"}

# Values that mean "clear this FK" on an inline edit (empty input / explicit null).
_CLEAR_VALUES = (None, "", 0, "0")


def _as_bool(v):
    """Coerce a JSON bool / form string to a Python bool (checkboxes)."""
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def _bool_or_none(v):
    """Nullable checkbox: '' / None ⇒ not assessed (None), else a bool."""
    if v in (None, ""):
        return None
    return _as_bool(v)


def _resolve_screen_fields(project, transitions):
    """Map ``transition.id -> [screen field metadata]`` for transitions carrying a
    ``TransitionScreen`` (e.g. Incident Resolve). Each row resolves the screen's
    ``field_key`` to its ``FieldDefinition`` (name / type / options) so the client's
    resolve slide-over can render the right control. Project-scoped defs win over the
    global system def for the same key."""
    from apps.itsm_core.models import FieldDefinition

    screen_map = {tr.id: list(tr.screen.fields.all()) for tr in transitions if tr.screen_id}
    if not screen_map:
        return {}
    keys = {sf.field_key for sfs in screen_map.values() for sf in sfs}
    defs = {}
    for fd in (FieldDefinition.objects.filter(key__in=keys, is_deleted=False)
               .filter(models.Q(project=project) | models.Q(project__isnull=True))
               .prefetch_related("options")):
        if fd.key not in defs or fd.project_id is not None:
            defs[fd.key] = fd
    out = {}
    for tid, sfs in screen_map.items():
        rows = []
        for sf in sfs:
            fd = defs.get(sf.field_key)
            rows.append({
                "field_key": sf.field_key,
                "is_mandatory": sf.is_mandatory,
                "sort_order": sf.sort_order,
                "name": fd.name if fd else sf.field_key,
                "field_type": fd.field_type if fd else "text",
                "options": [{"value": o.value, "label": o.label}
                            for o in (fd.options.all() if fd else []) if o.is_active],
            })
        out[tid] = rows
    return out


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


def _link_item(link, direction, link_type, other, labels):
    """One normalized link row from the *viewed* ticket's perspective.

    `other` is the ticket at the far end (target for outbound, source for inbound);
    `link_type` is already flipped to the inverse for inbound rows by the caller.
    """
    status = getattr(other, "status", None)
    category = getattr(status, "category", None)
    project = getattr(other, "project", None)
    helpdesk = getattr(project, "helpdesk", None)
    return {
        "id": str(link.id),
        "direction": direction,
        "link_type": link_type,
        "link_type_display": labels.get(link_type, link_type),
        "other_id": str(other.id),
        "other_number": other.ticket_number,
        "other_summary": other.summary,
        "other_status_name": getattr(status, "name", None),
        "other_status_category": getattr(category, "key", None),
        "other_status_color": getattr(status, "color", None),
        # Project + helpdesk keys so the client can build the far ticket's detail
        # route (it may live in a different project/helpdesk — e.g. incident↔request).
        "other_project_key": getattr(project, "key", None),
        "other_helpdesk_key": getattr(helpdesk, "key", None),
    }


def _link_items_for(ticket):
    """Merged inbound + outbound links for `ticket`, each from its perspective.

    Outbound rows (`links_out`) keep the stored link_type and point at the target;
    inbound rows (`links_in`) flip to the inverse link_type and point at the source,
    so both ends of "A blocks B" read correctly ("blocks" on A, "is blocked by" on B).
    """
    from .models import INVERSE_LINK_TYPE
    labels = dict(TicketLink.LinkType.choices)
    items = []
    for link in ticket.links_out.filter(is_deleted=False).select_related(
        "target_ticket", "target_ticket__status", "target_ticket__status__category",
        "target_ticket__project", "target_ticket__project__helpdesk",
    ):
        items.append(_link_item(link, "out", link.link_type, link.target_ticket, labels))
    for link in ticket.links_in.filter(is_deleted=False).select_related(
        "source_ticket", "source_ticket__status", "source_ticket__status__category",
        "source_ticket__project", "source_ticket__project__helpdesk",
    ):
        lt = INVERSE_LINK_TYPE.get(link.link_type, link.link_type)
        items.append(_link_item(link, "in", lt, link.source_ticket, labels))
    return items


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
    queryset = (TicketLink.objects.filter(is_deleted=False)
                .select_related("source_ticket", "target_ticket").order_by("-created_at"))
    serializer_class = TicketLinkSerializer
    module_code = "itsm.tickets.links"
    filterset_fields = ["source_ticket", "target_ticket"]

    def get_queryset(self):
        # Row-level clamp (rule 15): only links whose source OR target is in a
        # helpdesk the requester can access. The agent UI mutates links through the
        # ticket-scoped `TicketViewSet.links` action; this keeps the raw list/detail
        # (and any direct DELETE) from leaking or touching foreign-helpdesk links.
        from apps.itsm_helpdesks.services import accessible_helpdesk_ids_cached
        qs = super().get_queryset()
        ids = accessible_helpdesk_ids_cached(self.request)
        if ids is None:
            return qs
        return qs.filter(
            models.Q(source_ticket__project__helpdesk_id__in=ids)
            | models.Q(target_ticket__project__helpdesk_id__in=ids)
        )


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
