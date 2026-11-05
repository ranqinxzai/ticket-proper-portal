"""The single write path for asset documents (invoice, warranty card, manual, other).

Upload and removal each write an ``AssetEvent`` in the same transaction (rule 5).
Files are private: the content type is decided here from the extension (never from
the client), only a short allowlist of document and image types is accepted, and the
file is served only by the authenticated download action, never by a /media/ URL.
"""

from __future__ import annotations

import os

from django.db import transaction

from ..models import AssetDocument, AssetEvent
from .asset_service import AssetValidationError, log_event

MAX_BYTES = 20 * 1024 * 1024  # 20 MB per file (the nginx body limit is 25 MB)
NOTE_MAX = 255

# Extension → the Content-Type we store and serve. No HTML, SVG, scripts or archives:
# a PDF or image may be opened in a browser tab, so nothing that can run script.
ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
}


def _label(doc: AssetDocument) -> str:
    return f"{doc.get_doc_type_display()} · {doc.original_name}"


def validate_upload(file, doc_type, note) -> dict:
    """``{field: [msg]}`` for a bad upload; empty when it can be saved."""
    errors: dict = {}
    if file is None:
        errors["file"] = ["Choose a file to upload."]
    else:
        ext = os.path.splitext(file.name or "")[1].lower()
        if ext not in ALLOWED_TYPES:
            errors["file"] = ["Upload a PDF, image (PNG, JPG, GIF, WebP), Word, Excel or text file."]
        elif not file.size:
            errors["file"] = ["The file is empty."]
        elif file.size > MAX_BYTES:
            errors["file"] = [f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB."]
    if doc_type not in AssetDocument.DocType.values:
        errors["doc_type"] = ["Pick a document type."]
    if len(note or "") > NOTE_MAX:
        errors["note"] = [f"Keep the note under {NOTE_MAX} characters."]
    return errors


def add_document(asset, *, file, doc_type, note="", actor=None) -> AssetDocument:
    errors = validate_upload(file, doc_type, note)
    if errors:
        raise AssetValidationError(errors)
    ext = os.path.splitext(file.name)[1].lower()
    with transaction.atomic():
        doc = AssetDocument(
            asset=asset, doc_type=doc_type, note=(note or "").strip(),
            original_name=os.path.basename(file.name)[:255], size_bytes=file.size,
            content_type=ALLOWED_TYPES[ext],
            uploaded_by=actor if (actor and getattr(actor, "pk", None)) else None,
        )
        doc.file.save(file.name, file, save=False)
        doc.save()
        log_event(asset, actor, AssetEvent.Action.DOCUMENT_ADDED, note=_label(doc))
    return doc


def remove_document(doc: AssetDocument, *, actor=None) -> None:
    with transaction.atomic():
        doc.soft_delete(user=actor if (actor and getattr(actor, "pk", None)) else None)
        log_event(doc.asset, actor, AssetEvent.Action.DOCUMENT_REMOVED, note=_label(doc))
