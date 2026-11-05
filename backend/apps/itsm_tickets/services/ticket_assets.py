"""Ticket ↔ asset links — the single write path (coding rules 4 & 5).

A ticket links to any number of assets of its own helpdesk, kept in order:
position 0 is the **primary** asset, mirrored on ``Ticket.primary_asset`` for the
report, sorting and filters. Every change writes:

* ``TicketAsset`` rows (soft-deleted on unlink, so history keeps them),
* an ``AssetEvent`` on each asset (``ticket_linked`` / ``ticket_unlinked``, same
  transaction), and
* a ticket ``AuditEvent`` (``asset_linked`` / ``asset_unlinked``, on commit).

Interactive edits stamp ``updated_at`` / ``updated_by`` and honour the stale-write
guard (rule 20), like ``set_custom_fields``.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.itsm_core.services import log_event

MAX_ASSETS_PER_TICKET = 20


class AssetLinkError(ValueError):
    """A user-facing reason the requested assets can't be linked (→ HTTP 400)."""


def parse_ids(raw) -> list[str]:
    """A list (or comma string) of ids → unique, ordered UUID strings."""
    if raw in (None, "", []):
        return []
    items = raw if isinstance(raw, (list, tuple)) else str(raw).split(",")
    out: list[str] = []
    for item in items:
        if isinstance(item, dict):
            item = item.get("id")
        try:
            value = str(uuid.UUID(str(item).strip()))
        except (ValueError, TypeError, AttributeError):
            raise AssetLinkError("That asset doesn't exist.")
        if value not in out:
            out.append(value)
    return out


def resolve_assets(helpdesk_id, raw_ids, *, owner=None) -> list:
    """Validate ids against the helpdesk (and, for the portal, the owner).

    Returns ``Asset`` rows in the requested order. Raises ``AssetLinkError`` when an
    id is unknown, deleted, in another helpdesk or (``owner``) not allotted to them.
    """
    from apps.itsm_assets.models import Asset

    ids = parse_ids(raw_ids)
    if not ids:
        return []
    if len(ids) > MAX_ASSETS_PER_TICKET:
        raise AssetLinkError(f"A ticket can link at most {MAX_ASSETS_PER_TICKET} assets.")
    qs = Asset.objects.filter(pk__in=ids, helpdesk_id=helpdesk_id).select_related("status")
    if owner is not None:
        qs = qs.filter(assigned_user=owner)
    found = {str(a.pk): a for a in qs}
    if len(found) != len(ids):
        if owner is not None:
            raise AssetLinkError("You can only pick assets that are allotted to you.")
        raise AssetLinkError("That asset isn't available in this ticket's helpdesk.")
    return [found[i] for i in ids]


def _asset_ref(asset) -> dict:
    return {"id": str(asset.pk), "asset_tag": asset.asset_tag, "name": asset.name}


def _asset_event(asset, user, action, ticket):
    from apps.itsm_assets.services.asset_service import log_event as log_asset_event

    log_asset_event(asset, user, action,
                    note=f"{ticket.ticket_number} · {ticket.summary}"[:255])


def _audit_after(ticket, user, action, assets):
    refs = [_asset_ref(a) for a in assets]
    if not refs:
        return

    def _after():
        log_event(ticket, user, action, payload={"assets": refs})

    transaction.on_commit(_after)


def _live_links(ticket):
    from apps.itsm_tickets.models import TicketAsset

    return list(TicketAsset.objects.filter(ticket=ticket).select_related("asset")
                .order_by("position", "created_at"))


def _renumber(ticket, links):
    """Positions 0..n-1 in the given order; primary = the first link."""
    for i, link in enumerate(links):
        if link.position != i:
            link.position = i
            link.save(update_fields=["position", "updated_at"])
    primary_id = links[0].asset_id if links else None
    if ticket.primary_asset_id != primary_id:
        ticket.primary_asset_id = primary_id
        return True
    return False


def _actor(user):
    return user if (user and getattr(user, "pk", None)) else None


def link_initial(ticket, assets, user, *, audit=True):
    """Create-time links (the ticket was just saved with ``primary_asset`` set).

    Call inside ``create_ticket``'s transaction. ``create_ticket`` passes
    ``audit=False`` and logs ``asset_linked`` itself, after ``ticket_created``.
    """
    from apps.itsm_tickets.models import TicketAsset

    for i, asset in enumerate(assets):
        TicketAsset.objects.create(ticket=ticket, asset=asset, position=i, added_by=_actor(user))
        _asset_event(asset, user, "ticket_linked", ticket)
    if audit:
        _audit_after(ticket, user, "asset_linked", assets)


def _lock(ticket, expected_updated_at):
    from apps.itsm_tickets.models import Ticket

    from .ticket_service import ensure_fresh

    locked = Ticket.objects.select_for_update().select_related("project").get(pk=ticket.pk)
    ensure_fresh(locked, expected_updated_at)
    return locked


def _stamp(locked, user, extra_fields=()):
    locked.updated_by = _actor(user)
    locked.save(update_fields=["updated_by", "updated_at", *extra_fields])


@transaction.atomic
def link_assets(*, ticket, asset_ids, user=None, expected_updated_at=None):
    """Add assets to a ticket (already-linked ones are skipped). Returns the locked ticket."""
    from apps.itsm_tickets.models import TicketAsset

    locked = _lock(ticket, expected_updated_at)
    assets = resolve_assets(locked.project.helpdesk_id, asset_ids)
    links = _live_links(locked)
    linked = {link.asset_id for link in links}
    added = [a for a in assets if a.pk not in linked]
    if len(links) + len(added) > MAX_ASSETS_PER_TICKET:
        raise AssetLinkError(f"A ticket can link at most {MAX_ASSETS_PER_TICKET} assets.")
    if not added:
        return locked
    for asset in added:
        links.append(TicketAsset.objects.create(
            ticket=locked, asset=asset, position=len(links), added_by=_actor(user)))
        _asset_event(asset, user, "ticket_linked", locked)
    primary_changed = _renumber(locked, links)
    _stamp(locked, user, ["primary_asset"] if primary_changed else [])
    _audit_after(locked, user, "asset_linked", added)
    return locked


@transaction.atomic
def unlink_asset(*, ticket, asset_id, user=None, expected_updated_at=None):
    """Remove one asset from a ticket; the next one becomes primary if needed."""
    locked = _lock(ticket, expected_updated_at)
    links = _live_links(locked)
    target = next((link for link in links if str(link.asset_id) == str(asset_id)), None)
    if target is None:
        raise AssetLinkError("That asset isn't linked to this ticket.")
    target.soft_delete(user=_actor(user))
    links = [link for link in links if link.pk != target.pk]
    _asset_event(target.asset, user, "ticket_unlinked", locked)
    primary_changed = _renumber(locked, links)
    _stamp(locked, user, ["primary_asset"] if primary_changed else [])
    _audit_after(locked, user, "asset_unlinked", [target.asset])
    return locked


@transaction.atomic
def make_primary(*, ticket, asset_id, user=None, expected_updated_at=None):
    """Move a linked asset to the front (it becomes the primary asset)."""
    locked = _lock(ticket, expected_updated_at)
    links = _live_links(locked)
    target = next((link for link in links if str(link.asset_id) == str(asset_id)), None)
    if target is None:
        raise AssetLinkError("That asset isn't linked to this ticket.")
    if links and links[0].pk == target.pk:
        return locked
    links = [target] + [link for link in links if link.pk != target.pk]
    _renumber(locked, links)
    _stamp(locked, user, ["primary_asset"])

    def _after():
        log_event(locked, user, "asset_linked",
                  payload={"assets": [_asset_ref(target.asset)], "primary": True})

    transaction.on_commit(_after)
    return locked


def asset_items(ticket) -> list[dict]:
    """The ticket's linked assets for the API (primary first)."""
    from apps.itsm_tickets.models import TicketAsset

    links = (TicketAsset.objects.filter(ticket=ticket)
             .select_related("asset__status", "asset__category", "asset__sub_category",
                             "asset__assigned_user", "asset__location")
             .order_by("position", "created_at"))
    out = []
    for link in links:
        a = link.asset
        user = a.assigned_user
        out.append({
            "link_id": str(link.pk),
            "id": str(a.pk),
            "asset_tag": a.asset_tag,
            "name": a.name,
            "category": a.category.name if a.category_id else None,
            "sub_category": a.sub_category.name if a.sub_category_id else None,
            "status": {"name": a.status.name, "color": a.status.color,
                       "state_type": a.status.state_type},
            "location": a.location.name if a.location_id else None,
            "assigned_user": ({"id": user.pk, "username": user.username,
                               "full_name": (user.full_name or "").strip() or user.username}
                              if user else None),
            "is_primary": link.position == 0,
            "is_deleted": a.is_deleted,
        })
    return out
