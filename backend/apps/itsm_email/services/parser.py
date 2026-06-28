"""MIME → ``ParsedEmail`` using the Python stdlib (no third‑party dependency).

``parse(raw_bytes)`` returns a plain dataclass that never touches the DB. HTML
is *not* sanitized here — the downstream ``ticket_service.create_ticket`` /
``add_comment`` already run ``sanitize_html`` / ``html_to_text``.
"""

from __future__ import annotations

import email
import email.policy
import email.utils
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from html import escape

_MSGID_RE = re.compile(r"<[^>]+>")


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes
    content_id: str = ""
    is_inline: bool = False


@dataclass
class ParsedEmail:
    message_id: str
    in_reply_to: str = ""
    references: list[str] = field(default_factory=list)
    from_addr: str = ""
    from_name: str = ""
    to_addrs: list[str] = field(default_factory=list)
    cc_addrs: list[str] = field(default_factory=list)
    subject: str = ""
    date: datetime | None = None
    body_html: str = ""
    body_text: str = ""
    attachments: list[ParsedAttachment] = field(default_factory=list)
    headers: dict = field(default_factory=dict)
    size_bytes: int = 0
    synthesized_id: bool = False


def _addr_list(values) -> list[str]:
    out = []
    for _name, addr in email.utils.getaddresses(values or []):
        addr = (addr or "").strip().lower()
        if addr:
            out.append(addr)
    return out


def _decode_part(part) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, TypeError):
        return payload.decode("utf-8", errors="replace")


def parse(raw: bytes) -> ParsedEmail:
    msg = email.message_from_bytes(raw, policy=email.policy.default)

    message_id = (msg["Message-ID"] or "").strip()
    synthesized = False
    if not message_id:
        # Synthesize a deterministic id so idempotency still holds.
        basis = f"{msg['From']}|{msg['Subject']}|{msg['Date']}".encode("utf-8", "replace")
        message_id = f"<synth-{hashlib.sha1(basis).hexdigest()}@itsm.local>"
        synthesized = True

    from_name, from_addr = email.utils.parseaddr(msg["From"] or "")
    date = None
    if msg["Date"]:
        try:
            date = email.utils.parsedate_to_datetime(msg["Date"])
        except (TypeError, ValueError):
            date = None

    references = _MSGID_RE.findall(msg["References"] or "")
    in_reply_to = (msg["In-Reply-To"] or "").strip()
    if in_reply_to:
        m = _MSGID_RE.search(in_reply_to)
        in_reply_to = m.group(0) if m else in_reply_to

    body_html, body_text = "", ""
    attachments: list[ParsedAttachment] = []

    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            disp = (part.get_content_disposition() or "").lower()
            filename = part.get_filename()
            ctype = part.get_content_type()
            cid = (part["Content-ID"] or "").strip()
            is_attachment = disp == "attachment" or bool(filename) or (disp == "inline" and bool(cid))
            if is_attachment:
                data = part.get_payload(decode=True) or b""
                attachments.append(ParsedAttachment(
                    filename=_safe_name(filename), content_type=ctype, data=data,
                    content_id=cid, is_inline=(disp == "inline"),
                ))
            elif ctype == "text/plain" and not body_text:
                body_text = _decode_part(part)
            elif ctype == "text/html" and not body_html:
                body_html = _decode_part(part)
    else:
        ctype = msg.get_content_type()
        if ctype == "text/html":
            body_html = _decode_part(msg)
        else:
            body_text = _decode_part(msg)

    # Normalize: ensure we always have an HTML body for the downstream sanitizer.
    if not body_html and body_text:
        body_html = "".join(f"<p>{escape(line)}</p>" for line in body_text.splitlines() if line.strip()) \
            or f"<p>{escape(body_text)}</p>"
    if not body_text and body_html:
        # leave body_text empty; downstream html_to_text derives it.
        pass

    keep = ("Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond",
            "X-Auto-Response-Suppress", "Return-Path", "List-Id", "List-Unsubscribe",
            "X-Spam-Flag", "Subject", "From", "To",
            # priority signals — mapped to ticket priority by services.priority
            "X-Priority", "Importance", "X-MSMail-Priority", "Priority")
    headers = {k: msg[k] for k in keep if msg[k] is not None}

    return ParsedEmail(
        message_id=message_id, in_reply_to=in_reply_to, references=references,
        from_addr=(from_addr or "").strip().lower(), from_name=from_name or "",
        to_addrs=_addr_list(msg.get_all("To", [])), cc_addrs=_addr_list(msg.get_all("Cc", [])),
        subject=(msg["Subject"] or "").strip(), date=date,
        body_html=body_html, body_text=body_text, attachments=attachments,
        headers=headers, size_bytes=len(raw), synthesized_id=synthesized,
    )


def _safe_name(filename: str | None) -> str:
    if not filename:
        return "attachment.bin"
    # strip any path separators; replace odd chars with underscore
    name = filename.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._\- ]", "_", name).strip() or "attachment.bin"
    return name[:255]
