"""Persist parsed MIME attachments onto a Ticket or Comment.

Bytes come from ``part.get_payload(decode=True)``, so we wrap them in a
``ContentFile`` (unlike an HTTP upload). Inline images already referenced in the
HTML body are skipped to avoid duplicating embedded logos/signatures.
"""

from __future__ import annotations

from django.conf import settings
from django.core.files.base import ContentFile


def attach_parts(*, target, parts, uploaded_by, html_body: str = ""):
    """Create Ticket/CommentAttachment rows for each non‑inline part.

    ``target`` is a Ticket or Comment instance. Returns the count created.
    """
    from apps.itsm_tickets.models import Comment, CommentAttachment, Ticket, TicketAttachment

    if isinstance(target, Ticket):
        Model, fk = TicketAttachment, "ticket"
    elif isinstance(target, Comment):
        Model, fk = CommentAttachment, "comment"
    else:  # pragma: no cover - defensive
        return 0

    max_bytes = getattr(settings, "EMAIL_MAX_MESSAGE_BYTES", 25 * 1024 * 1024)
    created = 0
    for p in parts or []:
        if not p.data:
            continue
        if len(p.data) > max_bytes:
            continue
        # Skip inline images that are referenced in the body via cid:.
        if p.is_inline and p.content_id:
            cid = p.content_id.strip("<>")
            if cid and (f"cid:{cid}" in (html_body or "")):
                continue
        cf = ContentFile(p.data, name=p.filename or "attachment.bin")
        Model.objects.create(**{
            fk: target,
            "file": cf,
            "original_name": p.filename or "attachment.bin",
            "size_bytes": len(p.data),
            "content_type": p.content_type or "application/octet-stream",
            "uploaded_by": uploaded_by if getattr(uploaded_by, "pk", None) else None,
        })
        created += 1
    return created
