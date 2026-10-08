"""Tests for the email channel: crypto, parser, detectors, threading,
idempotency, identity, attachments, e2e, and outbound threading."""

from __future__ import annotations

import email.utils
from email.message import EmailMessage
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.mail import get_connection
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from apps.itsm_projects.models import Project
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission
from apps.itsm_tickets.models import Comment, CommentAttachment, Ticket, TicketAttachment

from .models import (
    EmailChannel, EmailRoutingRule, EmailThreadMessage, HelpdeskEmailTransport,
    InboundEmail, TransportMode,
)
from .services import (
    detectors, identity, inbound, mailbox, oauth, parser, priority, routing, scrub,
    system_user, threading, transport, verify,
)

User = get_user_model()


def _seed_min():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    from apps.itsm_workflows.seed import run as seed_workflows
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


def _project(helpdesk_key, project_type):
    return Project.objects.get(helpdesk__key=helpdesk_key, project_type=project_type)


def _allow(channel, *projects):
    """Whitelist projects on a mailbox (create EmailChannelProject links)."""
    from apps.itsm_email.models import EmailChannelProject
    for p in projects:
        EmailChannelProject.objects.get_or_create(channel=channel, project=p)


def _raw(subject="Hi", from_addr="alice@corp.com", to="support@itsm.local",
         body_text="Hello there", body_html=None, message_id="<m1@ext>",
         in_reply_to=None, references=None, headers=None, attachments=None, cc=None,
         date=None):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    if cc:
        msg["Cc"] = cc
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    for k, v in (headers or {}).items():
        msg[k] = v
    msg["Date"] = email.utils.format_datetime(date or timezone.now())
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    for part in (attachments or []):
        # 4-tuple = a normal attachment; a 5th element is a Content-ID, which makes
        # the part inline (an embedded signature logo / screenshot).
        data, filename, maintype, subtype = part[:4]
        cid = part[4] if len(part) > 4 else None
        kwargs = {"maintype": maintype, "subtype": subtype, "filename": filename}
        if cid:
            kwargs["cid"] = cid
            kwargs["disposition"] = "inline"
        msg.add_attachment(data, **kwargs)
    return msg.as_bytes()


class CryptoTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")

    def test_password_encrypted_at_rest(self):
        ch = EmailChannel.objects.create(name="C", project=self.inc, address="support@itsm.local",
                                         password_enc="super-secret-pw")
        # ORM read decrypts transparently
        self.assertEqual(EmailChannel.objects.get(pk=ch.pk).password_enc, "super-secret-pw")
        # Raw column is ciphertext, never the plaintext (only one row in this test)
        with connection.cursor() as cur:
            cur.execute("SELECT password_enc FROM itsm_email_emailchannel")
            raw = cur.fetchone()[0]
        self.assertTrue(raw.startswith("enc::"))
        self.assertNotIn("super-secret-pw", raw)


class ParserTests(TestCase):
    def test_multipart_html_plus_attachment(self):
        raw = _raw(subject="Printer down", body_text="plain body",
                   body_html="<p>html body</p>", message_id="<p1@ext>",
                   references="<a@x> <b@x>",
                   attachments=[(b"PDFDATA", "report.pdf", "application", "pdf")])
        p = parser.parse(raw)
        self.assertEqual(p.message_id, "<p1@ext>")
        self.assertEqual(p.subject, "Printer down")
        self.assertEqual(p.from_addr, "alice@corp.com")
        self.assertIn("html body", p.body_html)
        self.assertEqual(p.references, ["<a@x>", "<b@x>"])
        self.assertEqual(len(p.attachments), 1)
        self.assertEqual(p.attachments[0].filename, "report.pdf")
        self.assertEqual(p.attachments[0].data, b"PDFDATA")

    def test_missing_message_id_synthesized(self):
        msg = EmailMessage()
        msg["Subject"] = "No id"
        msg["From"] = "bob@corp.com"
        msg.set_content("body")
        p = parser.parse(msg.as_bytes())
        self.assertTrue(p.synthesized_id)
        self.assertTrue(p.message_id.startswith("<synth-"))


class DetectorTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(name="C", project=self.inc, address="support@itsm.local",
                                              loop_max_messages=2, loop_window_min=10)

    def test_auto_submitted_detected(self):
        p = parser.parse(_raw(headers={"Auto-Submitted": "auto-replied"}))
        self.assertTrue(detectors.is_auto_or_bulk(p, self.ch))

    def test_precedence_bulk_detected(self):
        p = parser.parse(_raw(headers={"Precedence": "bulk"}))
        self.assertTrue(detectors.is_auto_or_bulk(p, self.ch))

    def test_ooo_subject_detected(self):
        p = parser.parse(_raw(subject="Out of office: back Monday"))
        self.assertTrue(detectors.is_auto_or_bulk(p, self.ch))

    def test_normal_mail_not_flagged(self):
        p = parser.parse(_raw(subject="Help my laptop is broken"))
        self.assertFalse(detectors.is_auto_or_bulk(p, self.ch))

    def test_mail_loop(self):
        for i in range(2):
            InboundEmail.objects.create(channel=self.ch, message_id=f"<loop{i}@x>",
                                        from_addr="spammer@corp.com")
        p = parser.parse(_raw(from_addr="spammer@corp.com", message_id="<loop-new@x>"))
        self.assertTrue(detectors.is_mail_loop(p, self.ch))

    def test_strip_quotes(self):
        text = "My new reply\n\nOn Mon, Jan 1, 2020, Alice wrote:\n> old quoted text\n> more"
        out = detectors.strip_quotes(text)
        self.assertIn("My new reply", out)
        self.assertNotIn("old quoted text", out)

    def test_strip_quotes_never_empty(self):
        text = "> only quoted"
        out = detectors.strip_quotes(text)
        self.assertTrue(out.strip())

    def test_strip_quotes_wrapped_gmail_attribution(self):
        # Gmail mobile wraps "On <date> <name> <email>\nwrote:" across two lines —
        # the attribution + everything after it must go.
        text = ("Issue a new one please\n\n"
                "On Thu, 25 Jun, 2026, 10:36 pm Shweta Sharma, <shweta200694@gmail.com>\n"
                "wrote:\n\nThe original ticket body that should be cut.")
        out = detectors.strip_quotes(text)
        self.assertIn("Issue a new one please", out)
        self.assertNotIn("wrote:", out)
        self.assertNotIn("shweta200694@gmail.com", out)
        self.assertNotIn("should be cut", out)

    def test_strip_quotes_keeps_sentence_starting_with_on(self):
        # A real reply that merely begins with "On " (no "wrote:") must be kept.
        text = "On Monday I will reboot the server and confirm.\nThanks!"
        out = detectors.strip_quotes(text)
        self.assertIn("reboot the server", out)
        self.assertIn("Thanks!", out)


class IdentityTests(TestCase):
    def setUp(self):
        _seed_min()

    def test_existing_user_matched(self):
        u = User.objects.create_user(username="ex", email="ex@corp.com", password="x")
        got = identity.resolve_or_create_user("EX@corp.com", "Ex", create_users=False)
        self.assertEqual(got.pk, u.pk)

    def test_create_users_makes_external_no_role(self):
        got = identity.resolve_or_create_user("new@corp.com", "New Person", create_users=True)
        self.assertIsNotNone(got)
        self.assertEqual(got.email, "new@corp.com")
        self.assertFalse(got.has_usable_password())
        # No RoleAssignment ⇒ RBAC denies all agent access.
        self.assertFalse(check_permission(got, "itsm.tickets", "read"))
        self.assertFalse(check_permission(got, "itsm.tickets", "create"))

    def test_default_requestor_when_not_creating(self):
        default = User.objects.create_user(username="def", email="def@corp.com", password="x")
        got = identity.resolve_or_create_user("unknown@corp.com", "U", create_users=False,
                                              default_requestor=default)
        self.assertEqual(got.pk, default.pk)


class ThreadingTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(name="C", project=self.inc, address="support@itsm.local",
                                              create_users=True)
        # Seed ticket owned by alice@corp.com (the default _raw sender) so a token
        # reply from her is a legitimate participant reply.
        self.requestor = User.objects.create_user(username="alice", email="alice@corp.com", password="x")
        from apps.itsm_email.services import inbound
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Seed ticket", message_id="<seed@x>")),
            sender=self.requestor, bot=system_user.get_email_bot(),
        )

    def test_subject_token_resolves_reply(self):
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject=f"Re: [{num}] follow up", message_id="<r1@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_subject_token_bare_number_threads(self):
        # Users type the bare ticket number (no brackets) in the subject, e.g.
        # "ITINC-626 printer still down". It must thread, not start a new ticket.
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject=f"{num} still broken", message_id="<r1b@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_subject_token_substring_does_not_match(self):
        # A bare number must be word-bounded: "XINC-1" must NOT match key INC, and
        # the ticket number glued to a word ("note4ITINC-…") must not false-thread.
        p = parser.parse(_raw(subject=f"see x{self.ticket.ticket_number} nope",
                              message_id="<r1c@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "new")
        self.assertIsNone(ticket)

    def test_subject_token_from_stranger_now_threads(self):
        # Product decision 2026-06-28: the subject path is no longer ownership-gated.
        # A valid [KEY-N] in the subject threads on any match, even from a
        # non-participant (accepted tradeoff — see itsm-email BUG_LOG).
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject=f"Re: [{num}] from outside",
                              from_addr="stranger@evil.com", message_id="<r9@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_subject_token_from_watcher_threads(self):
        from apps.itsm_tickets.models import Watcher
        w = User.objects.create_user(username="ccw", email="cc@corp.com", password="x")
        Watcher.objects.get_or_create(ticket=self.ticket, user=w)
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject=f"Re: [{num}] me too", from_addr="cc@corp.com",
                              message_id="<r8@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_plus_address_token_from_stranger_is_new(self):
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject="no subject token", from_addr="stranger@evil.com",
                              to=f"support+{num}@itsm.local", message_id="<r7@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "new")
        self.assertIsNone(ticket)

    def test_header_map_resolves_reply(self):
        EmailThreadMessage.objects.create(channel=self.ch, message_id="<out1@x>",
                                          ticket=self.ticket, direction="outbound")
        p = parser.parse(_raw(subject="no token here", in_reply_to="<out1@x>", message_id="<r2@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_no_match_is_new(self):
        p = parser.parse(_raw(subject="brand new issue", message_id="<r3@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "new")
        self.assertIsNone(ticket)

    def test_subject_token_takes_precedence_over_header_map(self):
        # Subject is scanned first: when the subject names ticket B but the
        # In-Reply-To header maps to ticket A, the reply threads onto B.
        from apps.itsm_email.services import inbound
        other = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Second ticket", message_id="<seed2@x>")),
            sender=self.requestor, bot=system_user.get_email_bot(),
        )
        # Header map would resolve to self.ticket (A)…
        EmailThreadMessage.objects.create(channel=self.ch, message_id="<outA@x>",
                                          ticket=self.ticket, direction="outbound")
        # …but the subject names B, so B wins (subject-first).
        p = parser.parse(_raw(subject=f"Re: [{other.ticket_number}] hello",
                              in_reply_to="<outA@x>", message_id="<r10@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, other.pk)

    def test_subject_token_unknown_ticket_falls_through_to_header_map(self):
        # A syntactically valid but nonexistent subject token must NOT short-circuit
        # to a new ticket — control falls through to the (matching) header map.
        EmailThreadMessage.objects.create(channel=self.ch, message_id="<outB@x>",
                                          ticket=self.ticket, direction="outbound")
        p = parser.parse(_raw(subject=f"Re: [{self.inc.key}-99999] ghost",
                              in_reply_to="<outB@x>", message_id="<r11@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

    def test_subject_token_unknown_and_no_header_is_new(self):
        # Nonexistent subject token and no header → falls all the way through to new.
        p = parser.parse(_raw(subject=f"Re: [{self.inc.key}-99999] nobody",
                              message_id="<r12@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "new")
        self.assertIsNone(ticket)

    def test_outbound_headers_recorded(self):
        result = threading.build_outbound_headers(self.ticket, "cust@corp.com", outbox_id="42")
        self.assertIn("Message-ID", result["headers"])
        # Reply-To is the configured mailbox address itself (no plus-address token).
        self.assertEqual(result["reply_to"], [self.ch.address])
        self.assertTrue(EmailThreadMessage.objects.filter(
            ticket=self.ticket, direction="outbound").exists())

    def test_reply_to_is_configured_mailbox_address(self):
        # The feature: a reply to a notification goes to the mailbox the helpdesk
        # actually configured — not a synthetic support+token address.
        self.ch.address = "helpdesk@acme.com"
        self.ch.save(update_fields=["address"])
        result = threading.build_outbound_headers(self.ticket, "cust@corp.com", outbox_id="7")
        self.assertEqual(result["reply_to"], ["helpdesk@acme.com"])
        # Threading still rides the Message-ID header, not the Reply-To.
        self.assertIn("Message-ID", result["headers"])


class InboundPipelineTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(name="Support", project=self.inc,
                                              address="support@itsm.local", create_users=True)

    def _process(self, raw):
        from apps.itsm_email.services import inbound
        return inbound.process_inbound(self.ch, parser.parse(raw))

    def test_new_email_creates_ticket_with_attachment(self):
        raw = _raw(subject="Cannot print", from_addr="alice@corp.com", message_id="<n1@x>",
                   body_html="<p>printer is dead</p>",
                   attachments=[(b"LOGDATA", "error.log", "text", "plain")])
        row = self._process(raw)
        self.assertEqual(row.status, InboundEmail.Status.PROCESSED)
        self.assertEqual(row.action_taken, "created_ticket")
        ticket = row.ticket
        self.assertIsNotNone(ticket)
        self.assertEqual(ticket.source, "email")
        self.assertEqual(ticket.requestor.email, "alice@corp.com")
        self.assertEqual(TicketAttachment.objects.filter(ticket=ticket).count(), 1)

    def test_reply_adds_comment_with_attachment(self):
        new = self._process(_raw(subject="Cannot print", message_id="<n2@x>"))
        num = new.ticket.ticket_number
        reply = self._process(_raw(
            subject=f"Re: [{num}] Cannot print", from_addr="alice@corp.com", message_id="<n2r@x>",
            body_text="still broken\n\nOn day X, support wrote:\n> have you tried",
            attachments=[(b"IMG", "photo.png", "image", "png")],
        ))
        self.assertEqual(reply.action_taken, "added_comment")
        self.assertEqual(reply.ticket.pk, new.ticket.pk)
        comment = reply.comment
        self.assertEqual(comment.visibility, "public")
        self.assertIn("still broken", comment.body_text)
        self.assertNotIn("have you tried", comment.body_text)  # quote stripped
        self.assertEqual(CommentAttachment.objects.filter(comment=comment).count(), 1)

    def test_reply_processed_twice_adds_single_comment(self):
        # Re-processing the same reply (idempotency + the select_for_update race
        # backstop) must NOT create a second comment — the ITINC-613 duplicate.
        new = self._process(_raw(subject="Printer", message_id="<rp1@x>"))
        num = new.ticket.ticket_number
        reply_raw = _raw(subject=f"Re: [{num}] Printer", from_addr="alice@corp.com",
                         message_id="<rp1r@x>", body_text="still broken")
        r1 = self._process(reply_raw)
        r2 = self._process(reply_raw)
        self.assertEqual(r1.pk, r2.pk)
        self.assertEqual(r1.action_taken, "added_comment")
        self.assertEqual(Comment.objects.filter(ticket=new.ticket, is_deleted=False).count(), 1)

    def test_idempotent_same_message_id(self):
        raw = _raw(subject="Dup", message_id="<dup@x>")
        r1 = self._process(raw)
        r2 = self._process(raw)
        self.assertEqual(r1.pk, r2.pk)
        self.assertEqual(InboundEmail.objects.filter(message_id="<dup@x>").count(), 1)
        self.assertEqual(Ticket.objects.filter(source="email").count(), 1)

    def test_auto_reply_ignored(self):
        row = self._process(_raw(subject="Auto", message_id="<auto@x>",
                                 headers={"Auto-Submitted": "auto-replied"}))
        self.assertEqual(row.status, InboundEmail.Status.IGNORED)
        self.assertEqual(row.ignore_reason, "auto_reply")
        self.assertEqual(Ticket.objects.filter(source="email").count(), 0)

    def test_blocklist_ignored(self):
        from .models import EmailRule
        EmailRule.objects.create(channel=self.ch, rule_type="block", pattern="*@spam.com")
        row = self._process(_raw(from_addr="evil@spam.com", subject="X", message_id="<blk@x>"))
        self.assertEqual(row.status, InboundEmail.Status.IGNORED)
        self.assertEqual(row.ignore_reason, "blocklist")

    def test_cc_adds_existing_user_as_watcher(self):
        watcher = User.objects.create_user(username="w", email="cc@corp.com", password="x")
        row = self._process(_raw(subject="With CC", message_id="<cc1@x>", cc="cc@corp.com"))
        self.assertTrue(row.ticket.watchers.filter(user=watcher).exists())


class PriorityMapTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            create_users=True, default_priority="p3",
        )

    def test_x_priority_maps_to_p1(self):
        p = parser.parse(_raw(headers={"X-Priority": "1 (Highest)"}, message_id="<pri1@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "p1")

    def test_importance_high_maps_to_p2(self):
        p = parser.parse(_raw(headers={"Importance": "High"}, message_id="<pri2@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "p2")

    def test_no_signal_falls_back_to_default(self):
        self.ch.default_priority = "p4"
        self.ch.save(update_fields=["default_priority"])
        p = parser.parse(_raw(message_id="<pri3@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "p4")

    def test_pipeline_applies_mapped_priority(self):
        from apps.itsm_email.services import inbound
        row = inbound.process_inbound(self.ch, parser.parse(
            _raw(subject="urgent thing", headers={"X-Priority": "1"}, message_id="<prip@x>")))
        self.assertEqual(row.ticket.priority, "p1")


class AttachmentCapTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            create_users=True, max_attachment_bytes=10,
        )

    def test_oversized_attachment_skipped_with_note(self):
        from apps.itsm_email.services import inbound
        raw = _raw(subject="big file", message_id="<big@x>", body_html="<p>hi</p>",
                   attachments=[(b"X" * 100, "huge.bin", "application", "octet-stream"),
                                (b"ok", "small.txt", "text", "plain")])
        row = inbound.process_inbound(self.ch, parser.parse(raw))
        ticket = row.ticket
        # only the small attachment is kept
        self.assertEqual(TicketAttachment.objects.filter(ticket=ticket).count(), 1)
        kept = TicketAttachment.objects.get(ticket=ticket)
        self.assertEqual(kept.original_name, "small.txt")
        # a private agent note records the skipped file
        note = Comment.objects.filter(ticket=ticket, visibility="private").order_by("created_at").last()
        self.assertIsNotNone(note)
        self.assertIn("huge.bin", note.body_text or note.body_html)


class TransportTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")

    def _ticket(self, channel):
        from apps.itsm_email.services import inbound
        return inbound._create_ticket(
            channel, parser.parse(_raw(subject="t", message_id="<tt@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )

    def test_basic_smtp_config_builds_connection_and_from(self):
        ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_port=587, smtp_security="starttls",
            smtp_username="u", smtp_password_enc="p", smtp_from_name="IT Support",
        )
        cfg = transport.get_outbound_config(self._ticket(ch))
        self.assertIsNotNone(cfg)
        self.assertIn("support@itsm.local", cfg["from_email"])
        self.assertIn("IT Support", cfg["from_email"])
        self.assertEqual(cfg["connection"].host, "smtp.itsm.local")

    def test_outbound_disabled_returns_none(self):
        ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            outbound_enabled=False, smtp_host="smtp.itsm.local",
        )
        self.assertIsNone(transport.get_outbound_config(self._ticket(ch)))

    def test_no_smtp_host_returns_none(self):
        ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local", smtp_host="",
        )
        self.assertIsNone(transport.get_outbound_config(self._ticket(ch)))

    def test_oauth_unauthorized_returns_none(self):
        ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            auth_method="oauth_google", oauth_authorized=False, smtp_host="smtp.gmail.com",
        )
        # ensure_fresh raises OAuthError → graceful fallback (None), never an exception
        self.assertIsNone(transport.get_outbound_config(self._ticket(ch)))


class OutboxTransportTests(TestCase):
    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_from_name="IT Support",
        )
        from apps.itsm_email.services import inbound
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(message_id="<seed@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )
        self.req = User.objects.create_user(username="cust", email="cust@corp.com", password="x")

    def test_outbox_sends_from_mailbox_and_threads(self):
        from apps.itsm_notifications.models import NotificationOutbox
        from apps.itsm_notifications.services import outbox as outbox_service

        NotificationOutbox.objects.create(
            event_type="TicketCreated", ticket=self.ticket, recipient=self.req,
            rendered_subject="Request received", rendered_body="hi", dedupe_key="k1", status="queued",
        )
        locmem = get_connection("django.core.mail.backends.locmem.EmailBackend")
        # swap only the socket-level connection; from_email + threading come from the real channel
        with patch("apps.itsm_email.services.transport._connection_for", return_value=locmem):
            summary = outbox_service.flush()
        self.assertEqual(summary["sent"], 1)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.from_email, self.ch.from_header)
        # Reply-To is the configured mailbox address; threading rides the Message-ID header.
        self.assertEqual(msg.reply_to, [self.ch.address])
        self.assertIn("Message-ID", msg.extra_headers)


class HelpdeskNotificationFromTests(TestCase):
    """The helpdesk-level From (Settings → Email Notification), default/system mode.

    Precedence: outbound mailbox `from_header` (+ mailbox connection) → helpdesk CUSTOM
    transport → platform/system SMTP. In default mode (no mailbox, no custom transport)
    the recipient sees the helpdesk's From NAME over `PLATFORM_NOTIFY_FROM` with Reply-To
    set to the org's own `notification_from_email` — so delivery is SPF/DKIM-aligned to the
    platform while replies still reach the org. The mailbox always wins when configured.
    """

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.hd = self.inc.helpdesk
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_from_name="IT Support",
        )
        from apps.itsm_email.services import inbound
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(message_id="<seed-hd@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )
        self.req = User.objects.create_user(username="cust", email="cust@corp.com", password="x")

    def _disable_mailbox(self):
        EmailChannel.objects.filter(pk=self.ch.pk).update(is_active=False, outbound_enabled=False)

    def _flush_one(self, key, patch_conn=False):
        from apps.itsm_notifications.models import NotificationOutbox
        from apps.itsm_notifications.services import outbox as outbox_service

        NotificationOutbox.objects.create(
            event_type="TicketCreated", ticket=self.ticket, recipient=self.req,
            rendered_subject="Request received", rendered_body="hi", dedupe_key=key, status="queued",
        )
        if patch_conn:
            locmem = get_connection("django.core.mail.backends.locmem.EmailBackend")
            with patch("apps.itsm_email.services.transport._connection_for", return_value=locmem):
                outbox_service.flush()
        else:
            outbox_service.flush()
        return mail.outbox[-1]

    def test_mailbox_from_wins_over_helpdesk(self):
        self.hd.notification_from_name = "HD Desk"
        self.hd.notification_from_email = "desk@hd.example"
        self.hd.save(update_fields=["notification_from_name", "notification_from_email"])
        msg = self._flush_one("k-mailbox", patch_conn=True)
        # The configured outbound mailbox wins — the helpdesk override is ignored.
        self.assertEqual(msg.from_email, self.ch.from_header)
        self.assertIn("support@itsm.local", msg.from_email)

    def test_helpdesk_from_used_when_no_mailbox(self):
        from django.conf import settings as dj_settings
        from email.utils import formataddr

        self.hd.notification_from_name = "HD Desk"
        self.hd.notification_from_email = "desk@hd.example"
        self.hd.save(update_fields=["notification_from_name", "notification_from_email"])
        self._disable_mailbox()
        msg = self._flush_one("k-hd")
        # Default mode: the helpdesk NAME is shown over the platform address, and the
        # org's own address becomes the Reply-To (SPF-aligned send, replies reach them).
        self.assertEqual(msg.from_email, formataddr(("HD Desk", dj_settings.PLATFORM_NOTIFY_FROM)))
        self.assertEqual(msg.reply_to, ["desk@hd.example"])

    def test_global_default_when_neither(self):
        from django.conf import settings as dj_settings
        from email.utils import formataddr

        self._disable_mailbox()  # no mailbox, and the helpdesk From is blank by default
        msg = self._flush_one("k-default")
        # No org address set → the helpdesk name over the platform address, no Reply-To.
        self.assertEqual(msg.from_email, formataddr((self.hd.name, dj_settings.PLATFORM_NOTIFY_FROM)))
        self.assertEqual(msg.reply_to, [])

    def test_notification_from_header_property(self):
        self.hd.notification_from_email = ""
        self.assertEqual(self.hd.notification_from_header, "")
        # Email only → falls back to the helpdesk name as the display name.
        self.hd.notification_from_email = "desk@hd.example"
        self.hd.notification_from_name = ""
        self.assertEqual(self.hd.notification_from_header, f"{self.hd.name} <desk@hd.example>")
        self.hd.notification_from_name = "HD Desk"
        self.assertEqual(self.hd.notification_from_header, "HD Desk <desk@hd.example>")


class TestSmtpActionTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")

    def test_no_host_reports_error(self):
        ch = EmailChannel.objects.create(name="C", project=self.inc, address="support@itsm.local")
        res = mailbox.test_smtp(ch)
        self.assertFalse(res["ok"])
        self.assertIn("SMTP host", res["detail"])

    def test_disabled_reports_error(self):
        ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            outbound_enabled=False, smtp_host="smtp.itsm.local",
        )
        res = mailbox.test_smtp(ch)
        self.assertFalse(res["ok"])


class OAuthAppTests(TestCase):
    """Per-org OAuth app: client id/secret/tenant live on the channel (each org
    registers its own Azure/Google app), not in shared global settings."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")

    def _ch(self, **kw):
        defaults = dict(name="O", project=self.inc, address="support@itsm.local")
        defaults.update(kw)
        return EmailChannel.objects.create(**defaults)

    def test_per_channel_client_used_over_settings(self):
        from apps.itsm_email.services import oauth
        ch = self._ch(auth_method="oauth_google",
                      oauth_client_id="chan-client-id", oauth_client_secret_enc="chan-secret")
        with self.settings(GOOGLE_OAUTH_CLIENT_ID="global-id", GOOGLE_OAUTH_CLIENT_SECRET="global-secret"):
            cid, secret = oauth._client(oauth.PROVIDERS["oauth_google"], ch)
        self.assertEqual(cid, "chan-client-id")
        self.assertEqual(secret, "chan-secret")

    def test_falls_back_to_global_app_when_channel_blank(self):
        from apps.itsm_email.services import oauth
        ch = self._ch(auth_method="oauth_google")
        with self.settings(GOOGLE_OAUTH_CLIENT_ID="global-id", GOOGLE_OAUTH_CLIENT_SECRET="global-secret"):
            cid, _ = oauth._client(oauth.PROVIDERS["oauth_google"], ch)
        self.assertEqual(cid, "global-id")

    def test_no_creds_anywhere_raises(self):
        from apps.itsm_email.services import oauth
        ch = self._ch(auth_method="oauth_microsoft")
        with self.settings(MICROSOFT_OAUTH_CLIENT_ID="", MICROSOFT_OAUTH_CLIENT_SECRET=""):
            with self.assertRaises(oauth.OAuthError):
                oauth._client(oauth.PROVIDERS["oauth_microsoft"], ch)

    def test_authorize_url_uses_channel_client_and_state_roundtrips(self):
        from urllib.parse import urlparse, parse_qs
        from apps.itsm_email.services import oauth
        ch = self._ch(auth_method="oauth_google",
                      oauth_client_id="abc123", oauth_client_secret_enc="s")
        url = oauth.authorize_url(ch)
        q = parse_qs(urlparse(url).query)
        self.assertEqual(q["client_id"][0], "abc123")
        self.assertIn("oauth/callback/", q["redirect_uri"][0])
        cid, _org, kind = oauth.parse_state(q["state"][0])
        self.assertEqual(cid, str(ch.id))
        self.assertEqual(kind, "channel")  # default kind for a mailbox channel

    def test_parse_state_defaults_kind_for_legacy_state(self):
        """A state signed before the ``kind`` field existed still parses as a channel
        (keeps in-flight consent redirects valid across the deploy)."""
        from django.core import signing
        from apps.itsm_email.services import oauth
        legacy = signing.dumps({"cid": "abc", "org": "acme"}, salt=oauth._STATE_SALT)
        cid, org, kind = oauth.parse_state(legacy)
        self.assertEqual((cid, org, kind), ("abc", "acme", "channel"))

    def test_microsoft_tenant_in_endpoint(self):
        from apps.itsm_email.services import oauth
        ch = self._ch(auth_method="oauth_microsoft", oauth_client_id="m",
                      oauth_client_secret_enc="s", oauth_tenant_id="tenant-guid-123")
        url = oauth.authorize_url(ch)
        self.assertIn("login.microsoftonline.com/tenant-guid-123/", url)

    def test_client_secret_encrypted_and_write_only(self):
        from apps.itsm_email.serializers import EmailChannelSerializer
        ch = self._ch(auth_method="oauth_microsoft", oauth_client_id="m",
                      oauth_client_secret_enc="topsecret")
        data = EmailChannelSerializer(ch).data
        self.assertNotIn("oauth_client_secret", data)        # write-only
        self.assertTrue(data["has_oauth_client_secret"])
        self.assertEqual(data["oauth_client_id"], "m")        # id is readable
        with connection.cursor() as cur:
            cur.execute(
                "SELECT oauth_client_secret_enc FROM itsm_email_emailchannel WHERE id=%s", [str(ch.id)]
            )
            raw = cur.fetchone()[0]
        self.assertTrue(raw.startswith("enc::"))
        self.assertNotIn("topsecret", raw)


class _FakeImap:
    """Minimal imaplib stand-in: one folder of ``{uid: (arrived_at, raw)}``.

    Honours ``UID low:* SINCE d-Mon-yyyy`` like a real server (date-only), answers
    ``(UID INTERNALDATE)`` fetches, and records which UIDs were downloaded."""

    def __init__(self, messages, validity=1):
        self.messages, self.validity = messages, validity
        self.searches, self.downloaded = [], []

    def select(self, folder):
        return "OK", [str(len(self.messages)).encode()]

    def response(self, code):
        return code, [str(self.validity).encode() if code == "UIDVALIDITY" else None]

    def uid(self, cmd, *args):
        from datetime import datetime
        if cmd == "SEARCH":
            crit = args[1]
            self.searches.append(crit)
            low = int(crit.split()[1].split(":")[0])
            since = datetime.strptime(crit.split("SINCE ")[1], "%d-%b-%Y").date()
            hits = [u for u, (at, _r) in sorted(self.messages.items())
                    if u >= low and at.date() >= since]
            return "OK", [" ".join(map(str, hits)).encode()]
        if cmd == "FETCH" and args[1] == "(UID INTERNALDATE)":
            return "OK", [
                f'{u} (UID {u} INTERNALDATE "{self.messages[int(u)][0]:%d-%b-%Y %H:%M:%S +0000}")'
                .encode() for u in args[0].split(",")]
        if cmd == "FETCH":
            self.downloaded.append(int(args[0]))
            return "OK", [(b"1 (RFC822)", self.messages[int(args[0])][1])]
        return "OK", [b""]  # STORE (mark seen)

    def logout(self):
        pass


def _serve(fake):
    from contextlib import contextmanager

    @contextmanager
    def _cm(_channel):
        yield fake
    return patch("apps.itsm_email.services.mailbox._imap", _cm)


class ConnectFloorTests(TestCase):
    """Only mail that arrives AFTER a mailbox is connected becomes tickets. Older mail
    is filtered at the server — never downloaded, never written to InboundEmail —
    including after the channel is re-pointed at a different mailbox."""

    def setUp(self):
        from datetime import timedelta
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.now = timezone.now()
        self.ch = EmailChannel.objects.create(
            name="B", project=self.inc, address="support@itsm.local", protocol="imap",
            connected_at=self.now - timedelta(hours=1),
        )

    def _poll(self):
        from apps.itsm_email.services import poller
        res = poller.poll_channel(self.ch)
        self.ch.refresh_from_db()
        return res

    def test_mail_from_before_connect_is_never_downloaded_or_stored(self):
        from datetime import datetime, timedelta, timezone as dt_timezone
        floor = self.ch.connected_at
        fake = _FakeImap({
            1: (datetime(2025, 7, 17, 9, 0, tzinfo=dt_timezone.utc), b"old"),
            2: (floor - timedelta(minutes=10), b"just-before"),
            3: (floor + timedelta(minutes=5), _raw(message_id="<after@x>")),
        }, validity=777)
        with _serve(fake):
            res = self._poll()
        self.assertEqual(fake.downloaded, [3])        # only post-connect mail is fetched
        self.assertIn("SINCE", fake.searches[0])      # year-old mail filtered server-side
        self.assertEqual(res["processed"], 1)
        self.assertEqual(res["skipped"], 1)           # uid 2: same day, before the floor
        self.assertEqual(list(InboundEmail.objects.values_list("message_id", flat=True)),
                         ["<after@x>"])               # nothing older reaches the DB
        self.assertEqual(self.ch.last_seen_uid, 3)
        self.assertEqual(self.ch.uid_validity, 777)

    def test_same_mailbox_resumes_from_cursor(self):
        self.ch.last_seen_uid, self.ch.uid_validity = 100, 777
        self.ch.save(update_fields=["last_seen_uid", "uid_validity"])
        fake = _FakeImap({}, validity=777)
        with _serve(fake):
            self._poll()
        self.assertTrue(fake.searches[0].startswith("UID 101:*"))
        self.assertEqual(self.ch.last_seen_uid, 100)

    def test_mail_received_while_the_server_was_down_is_picked_up(self):
        """A deploy/restart must not lose mail: the cursor + floor are untouched by a
        restart, so mail that arrived during the downtime is ingested on the next poll."""
        from datetime import timedelta
        self.ch.connected_at = self.now - timedelta(days=3)
        self.ch.last_seen_uid, self.ch.uid_validity = 100, 777
        self.ch.last_polled_at = self.now - timedelta(hours=20)   # down overnight
        self.ch.save(update_fields=["connected_at", "last_seen_uid", "uid_validity", "last_polled_at"])
        fake = _FakeImap({
            101: (self.now - timedelta(hours=19), _raw(message_id="<night@x>")),
            102: (self.now - timedelta(minutes=5), _raw(message_id="<morning@x>")),
        }, validity=777)
        with _serve(fake):
            res = self._poll()
        self.assertEqual(fake.downloaded, [101, 102])
        self.assertEqual(res["processed"], 2)
        self.assertEqual(self.ch.connected_at, self.now - timedelta(days=3))  # floor unchanged
        self.assertEqual(self.ch.last_seen_uid, 102)

    def test_cursor_from_another_mailbox_is_discarded(self):
        """Today's incident: the address changed, the old cursor (2479) was kept, and the
        new mailbox was back-filled from July 2025. A UIDVALIDITY change must re-anchor."""
        from datetime import datetime, timedelta, timezone as dt_timezone
        self.ch.connected_at = self.now - timedelta(days=60)
        self.ch.last_seen_uid, self.ch.uid_validity = 2479, 111
        self.ch.last_polled_at = self.now - timedelta(minutes=1)
        self.ch.save(update_fields=["connected_at", "last_seen_uid", "uid_validity", "last_polled_at"])
        fake = _FakeImap({
            2480: (datetime(2025, 7, 17, 9, 0, tzinfo=dt_timezone.utc), b"year-old"),
            9000: (self.now, _raw(message_id="<today@x>")),
        }, validity=222)
        with _serve(fake):
            self._poll()
        self.assertTrue(fake.searches[0].startswith("UID 1:*"))   # old cursor not trusted
        self.assertEqual(fake.downloaded, [9000])
        self.assertFalse(InboundEmail.objects.exclude(message_id="<today@x>").exists())
        self.assertEqual((self.ch.uid_validity, self.ch.last_seen_uid), (222, 9000))
        self.assertGreater(self.ch.connected_at, self.now - timedelta(days=1))

    def test_repoint_during_a_poll_is_not_overwritten(self):
        from datetime import timedelta
        self.ch.last_seen_uid, self.ch.uid_validity = 50, 777
        self.ch.save(update_fields=["last_seen_uid", "uid_validity"])
        fresh = self.now + timedelta(seconds=1)

        def fetch(_channel):
            # an admin re-points the mailbox while this poll is still running
            EmailChannel.objects.filter(pk=self.ch.pk).update(
                connected_at=fresh, last_seen_uid=None, uid_validity=None)
            yield 60, None

        with patch("apps.itsm_email.services.mailbox.fetch_new", fetch):
            self._poll()
        self.assertIsNone(self.ch.last_seen_uid)      # the fresh start survives
        self.assertEqual(self.ch.connected_at, fresh)

    def test_pop3_skips_mail_sent_before_connect_without_downloading(self):
        from datetime import timedelta
        self.ch.protocol, self.ch.use_ssl = "pop3", False
        self.ch.save(update_fields=["protocol", "use_ssl"])
        dates = {1: self.ch.connected_at - timedelta(days=30), 2: self.ch.connected_at + timedelta(minutes=1)}

        class _Pop:
            retrieved = []
            def user(self, _u): pass
            def pass_(self, _p): pass
            def list(self): return "+OK", [b"1 10", b"2 10"]
            def top(self, i, _n): return "+OK", [f"Date: {email.utils.format_datetime(dates[i])}".encode()], 0
            def retr(self, i):
                _Pop.retrieved.append(i)
                return "+OK", _raw(message_id=f"<p{i}@x>").split(b"\n"), 0
            def quit(self): pass

        with patch("apps.itsm_email.services.mailbox.poplib.POP3", return_value=_Pop()):
            got = list(mailbox.fetch_new(self.ch))
        self.assertEqual(_Pop.retrieved, [2])
        self.assertEqual(len(got), 1)


class ReconnectResetsCursorTests(TestCase):
    """Re-pointing a mailbox (or switching it back on) restarts ingestion from now."""

    def setUp(self):
        from datetime import timedelta
        _seed_min()
        self.inc = _project("IT", "incident")
        self.old_floor = timezone.now() - timedelta(days=30)
        self.ch = EmailChannel.objects.create(
            name="B", project=self.inc, address="old@itsm.local", protocol="imap",
            connected_at=self.old_floor, last_seen_uid=2479, uid_validity=111,
        )

    def _patch(self, **data):
        from .serializers import EmailChannelSerializer
        ser = EmailChannelSerializer(self.ch, data=data, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)
        ser.save()
        self.ch.refresh_from_db()

    def test_changing_the_address_restarts_from_now(self):
        self._patch(address="helpdesk@itsm.local", username="helpdesk@itsm.local")
        self.assertIsNone(self.ch.last_seen_uid)
        self.assertIsNone(self.ch.uid_validity)
        self.assertGreater(self.ch.connected_at, self.old_floor)

    def test_reactivating_restarts_from_now(self):
        EmailChannel.objects.filter(pk=self.ch.pk).update(is_active=False)
        self.ch.refresh_from_db()
        self._patch(is_active=True)
        self.assertIsNone(self.ch.last_seen_uid)
        self.assertGreater(self.ch.connected_at, self.old_floor)

    def test_unrelated_edits_keep_the_cursor(self):
        self._patch(name="Renamed", address="OLD@itsm.local ", max_age_days=3)
        self.assertEqual(self.ch.last_seen_uid, 2479)
        self.assertEqual(self.ch.connected_at, self.old_floor)

    def test_connected_at_is_read_only(self):
        self._patch(connected_at="2020-01-01T00:00:00Z")
        self.assertEqual(self.ch.connected_at, self.old_floor)


# ── Multi-project keyword routing ─────────────────────────────────────────────

class RoutingResolveTests(TestCase):
    """routing.resolve_target / served_projects — keyword → project, else fallback."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")          # channel fallback
        self.req = _project("IT", "service_request")   # a routing target
        self.ch = EmailChannel.objects.create(
            name="Support", project=self.inc, address="support@itsm.local", create_users=True,
        )
        _allow(self.ch, self.inc, self.req)   # whitelist both

    def _rule(self, keywords, target=None, **kw):
        return EmailRoutingRule.objects.create(
            channel=self.ch, keywords=keywords, target_project=target or self.req, **kw,
        )

    def _resolve(self, **raw_kw):
        return routing.resolve_target(self.ch, parser.parse(_raw(**raw_kw)))

    def test_subject_keyword_routes_to_target(self):
        rule = self._rule(["vpn access"])
        project, matched = self._resolve(subject="Please grant vpn access", body_text="hi")
        self.assertEqual(project.pk, self.req.pk)
        self.assertEqual(matched.pk, rule.pk)

    def test_body_keyword_routes(self):
        self._rule(["password"], match_in="body")
        project, matched = self._resolve(subject="hello", body_text="I forgot my password")
        self.assertEqual(project.pk, self.req.pk)
        self.assertIsNotNone(matched)

    def test_html_only_body_matches(self):
        # HTML-only mail leaves parsed.body_text empty; routing must derive from the HTML.
        self._rule(["password"], match_in="body")
        project, matched = self._resolve(
            subject="hi", body_text="", body_html="<p>please reset my <b>password</b> today</p>",
        )
        self.assertEqual(project.pk, self.req.pk)
        self.assertIsNotNone(matched)

    def test_no_match_uses_fallback(self):
        self._rule(["vpn"])
        project, matched = self._resolve(subject="printer is broken", body_text="help")
        self.assertEqual(project.pk, self.inc.pk)
        self.assertIsNone(matched)

    def test_first_matching_rule_wins(self):
        self._rule(["urgent"], target=self.req, order=0)
        self._rule(["urgent"], target=self.inc, order=1)
        project, matched = self._resolve(subject="urgent thing")
        self.assertEqual(project.pk, self.req.pk)   # order 0 wins over order 1
        self.assertEqual(matched.order, 0)

    def test_match_all_requires_all_keywords(self):
        self._rule(["server", "down"], match_type="all")
        hit, _ = self._resolve(subject="the server is down")
        self.assertEqual(hit.pk, self.req.pk)
        miss, matched = self._resolve(subject="the server is slow")
        self.assertEqual(miss.pk, self.inc.pk)      # only one keyword → no all-match
        self.assertIsNone(matched)

    def test_word_boundary_not_substring(self):
        self._rule(["req"])
        # 'req' must NOT match inside 'frequent'
        miss, matched = self._resolve(subject="frequent crashes", body_text="")
        self.assertEqual(miss.pk, self.inc.pk)
        self.assertIsNone(matched)
        # but DOES match the standalone word
        hit, _ = self._resolve(subject="a req for laptop", body_text="")
        self.assertEqual(hit.pk, self.req.pk)

    def test_inactive_rule_skipped(self):
        self._rule(["vpn"], is_active=False)
        project, matched = self._resolve(subject="vpn please")
        self.assertEqual(project.pk, self.inc.pk)
        self.assertIsNone(matched)

    def test_empty_keywords_never_matches(self):
        self._rule([])
        project, matched = self._resolve(subject="anything at all")
        self.assertEqual(project.pk, self.inc.pk)
        self.assertIsNone(matched)

    def test_empty_subject_with_subject_rule_falls_back(self):
        self._rule(["vpn"], match_in="subject")
        project, _ = self._resolve(subject="", body_text="vpn is only in the body")
        self.assertEqual(project.pk, self.inc.pk)

    def test_served_projects_is_the_whitelist_excluding_deleted(self):
        # served = the allowed set (EmailChannelProject links), NOT derived from rules
        self.assertEqual({p.pk for p in routing.served_projects(self.ch)},
                         {self.inc.pk, self.req.pk})
        # soft-deleting an allowed target drops it (PROTECT doesn't cover soft-delete)
        self.req.is_deleted = True
        self.req.save(update_fields=["is_deleted"])
        self.assertEqual([p.pk for p in routing.served_projects(self.ch)], [self.inc.pk])

    def test_rule_target_not_in_whitelist_is_skipped(self):
        # A rule whose target is NOT allowed can never fire — mail falls to the default.
        ch = EmailChannel.objects.create(name="C2", project=self.inc, address="c2@itsm.local")
        _allow(ch, self.inc)   # only inc allowed; req is NOT
        EmailRoutingRule.objects.create(channel=ch, keywords=["vpn"], target_project=self.req)
        project, matched = routing.resolve_target(ch, parser.parse(_raw(subject="need vpn")))
        self.assertEqual(project.pk, self.inc.pk)
        self.assertIsNone(matched)

    def test_no_links_falls_back_to_default_project(self):
        # A legacy channel with no whitelist links ⇒ allowed = {its default project}.
        ch = EmailChannel.objects.create(name="C3", project=self.inc, address="c3@itsm.local")
        self.assertEqual([p.pk for p in routing.served_projects(ch)], [self.inc.pk])


class RoutingThreadingTests(TestCase):
    """A reply that names a routed-project ticket threads onto it across served projects."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local", create_users=True,
        )
        _allow(self.ch, self.inc, self.req)   # whitelist both
        self.requestor = User.objects.create_user(username="alice", email="alice@corp.com", password="x")
        EmailRoutingRule.objects.create(channel=self.ch, keywords=["access"], target_project=self.req)
        # a ticket in the ROUTED project (not the fallback)
        self.req_ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Seed req", message_id="<seedreq@x>")),
            sender=self.requestor, bot=system_user.get_email_bot(), project=self.req,
        )
        # and one in the fallback project
        self.inc_ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Seed inc", message_id="<seedinc@x>")),
            sender=self.requestor, bot=system_user.get_email_bot(),
        )

    def test_reply_to_routed_project_ticket_threads(self):
        num = self.req_ticket.ticket_number   # e.g. ITREQ1 (routed project's key)
        p = parser.parse(_raw(subject=f"Re: [{num}] any update?", message_id="<rr1@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.req_ticket.pk)

    def test_reply_to_fallback_project_ticket_still_threads(self):
        num = self.inc_ticket.ticket_number
        p = parser.parse(_raw(subject=f"Re: {num} still broken", message_id="<rr2@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.inc_ticket.pk)

    def test_unknown_number_is_new(self):
        p = parser.parse(_raw(subject="Re: [ITREQ99999] ghost", message_id="<rr3@x>"))
        kind, _ = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "new")


class RoutingTransportTests(TestCase):
    """A ticket routed to a non-fallback project still resolves the serving mailbox."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_username="u", smtp_password_enc="p",
        )
        _allow(self.ch, self.inc, self.req)   # whitelist both
        EmailRoutingRule.objects.create(channel=self.ch, keywords=["access"], target_project=self.req)

    def test_routed_ticket_resolves_serving_channel(self):
        # ticket in the routed project; no EmailThreadMessage yet → resolves via the rule target
        ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="req", message_id="<rt1@x>")),
            sender=None, bot=system_user.get_email_bot(), project=self.req,
        )
        cfg = transport.get_outbound_config(ticket)
        self.assertIsNotNone(cfg)
        self.assertIn("support@itsm.local", cfg["from_email"])


class RoutingRuleSerializerTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.ch = EmailChannel.objects.create(name="C", project=self.inc, address="s@itsm.local")
        _allow(self.ch, self.inc, self.req)   # whitelist both

    def _ser(self, **data):
        from .serializers import EmailRoutingRuleSerializer
        return EmailRoutingRuleSerializer(data={"channel": str(self.ch.id), **data})

    def test_same_helpdesk_target_accepted(self):
        s = self._ser(keywords=["vpn"], target_project=str(self.req.id))
        self.assertTrue(s.is_valid(), s.errors)

    def test_cross_helpdesk_target_rejected(self):
        hr_req = _project("HR", "service_request")
        s = self._ser(keywords=["vpn"], target_project=str(hr_req.id))
        self.assertFalse(s.is_valid())
        self.assertIn("target_project", s.errors)

    def test_empty_keywords_rejected(self):
        s = self._ser(keywords=[], target_project=str(self.req.id))
        self.assertFalse(s.is_valid())
        self.assertIn("keywords", s.errors)

    def test_keywords_trimmed_and_deduped(self):
        s = self._ser(keywords=[" VPN ", "vpn", "  ", "laptop"], target_project=str(self.req.id))
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["keywords"], ["VPN", "laptop"])

    def test_channel_serializer_exposes_allowed_projects(self):
        from .serializers import EmailChannelSerializer
        EmailRoutingRule.objects.create(channel=self.ch, keywords=["x"], target_project=self.req)
        data = EmailChannelSerializer(self.ch).data
        self.assertEqual(set(data["allowed_projects"]), {str(self.inc.id), str(self.req.id)})
        self.assertEqual(len(data["routing_rules"]), 1)

    def test_rule_target_outside_whitelist_rejected(self):
        # A third helpdesk project not in the mailbox's allowed set can't be a rule target.
        # (Here: valid helpdesk, but not whitelisted — use a fresh channel allowing only inc.)
        ch = EmailChannel.objects.create(name="Z", project=self.inc, address="z@itsm.local")
        _allow(ch, self.inc)
        from .serializers import EmailRoutingRuleSerializer
        s = EmailRoutingRuleSerializer(data={
            "channel": str(ch.id), "keywords": ["vpn"], "target_project": str(self.req.id)})
        self.assertFalse(s.is_valid())
        self.assertIn("target_project", s.errors)


class EmailChannelAllowedProjectsTests(TestCase):
    """The `allowed_projects` whitelist on EmailChannelSerializer: validation + join sync."""

    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.hr = _project("HR", "incident")   # a DIFFERENT helpdesk

    def _ser(self, instance=None, **data):
        from .serializers import EmailChannelSerializer
        return EmailChannelSerializer(instance=instance, data=data, partial=instance is not None)

    def _base(self, **over):
        d = dict(name="M", address="s@itsm.local", project=str(self.inc.id),
                 allowed_projects=[str(self.inc.id), str(self.req.id)])
        d.update(over)
        return d

    def test_create_syncs_whitelist_and_reads_back(self):
        from .serializers import EmailChannelSerializer
        s = self._ser(**self._base())
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        self.assertEqual({p.pk for p in routing.allowed_projects(ch)}, {self.inc.pk, self.req.pk})
        self.assertEqual(set(EmailChannelSerializer(ch).data["allowed_projects"]),
                         {str(self.inc.id), str(self.req.id)})

    def test_empty_allowed_rejected(self):
        s = self._ser(**self._base(allowed_projects=[]))
        self.assertFalse(s.is_valid())
        self.assertIn("allowed_projects", s.errors)

    def test_default_project_must_be_allowed(self):
        s = self._ser(**self._base(project=str(self.req.id), allowed_projects=[str(self.inc.id)]))
        self.assertFalse(s.is_valid())
        self.assertIn("project", s.errors)

    def test_cross_helpdesk_allowed_rejected(self):
        s = self._ser(**self._base(allowed_projects=[str(self.inc.id), str(self.hr.id)]))
        self.assertFalse(s.is_valid())
        self.assertIn("allowed_projects", s.errors)

    def test_update_removing_allowed_soft_deletes_link(self):
        s = self._ser(**self._base())
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        s2 = self._ser(instance=ch, allowed_projects=[str(self.inc.id)])
        self.assertTrue(s2.is_valid(), s2.errors)
        ch = s2.save()
        self.assertEqual([p.pk for p in routing.allowed_projects(ch)], [self.inc.pk])

    def test_shrink_below_active_rule_rejected(self):
        s = self._ser(**self._base())
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        EmailRoutingRule.objects.create(channel=ch, keywords=["x"], target_project=self.req)
        s2 = self._ser(instance=ch, allowed_projects=[str(self.inc.id)])
        self.assertFalse(s2.is_valid())
        self.assertIn("allowed_projects", s2.errors)

    def test_re_adding_previously_removed_project_revives_link(self):
        s = self._ser(**self._base())
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        drop = self._ser(instance=ch, allowed_projects=[str(self.inc.id)])  # drop req (soft-delete)
        self.assertTrue(drop.is_valid(), drop.errors)
        ch = drop.save()
        s3 = self._ser(instance=ch, allowed_projects=[str(self.inc.id), str(self.req.id)])
        self.assertTrue(s3.is_valid(), s3.errors)
        ch = s3.save()  # must not violate the (channel, project) unique constraint
        self.assertEqual({p.pk for p in routing.allowed_projects(ch)}, {self.inc.pk, self.req.pk})


class RoutingPipelineTests(TestCase):
    """End-to-end: a keyworded email creates a ticket in the target project + logs the rule."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.req = _project("IT", "service_request")
        self.ch = EmailChannel.objects.create(
            name="Support", project=self.inc, address="support@itsm.local", create_users=True,
        )
        _allow(self.ch, self.inc, self.req)   # whitelist both
        self.rule = EmailRoutingRule.objects.create(
            channel=self.ch, name="Requests", keywords=["access"], target_project=self.req,
        )

    def test_keyworded_email_routes_and_records_rule(self):
        raw = _raw(subject="Need laptop access", from_addr="bob@corp.com", message_id="<pr1@x>",
                   body_html="<p>please</p>")
        row = inbound.process_inbound(self.ch, parser.parse(raw))
        self.assertEqual(row.status, InboundEmail.Status.PROCESSED)
        self.assertEqual(row.action_taken, "created_ticket")
        self.assertEqual(row.ticket.project_id, self.req.pk)
        self.assertEqual(row.matched_rule_id, self.rule.pk)

    def test_unmatched_email_uses_fallback_and_no_rule(self):
        raw = _raw(subject="Printer jammed", from_addr="bob@corp.com", message_id="<pr2@x>",
                   body_html="<p>help</p>")
        row = inbound.process_inbound(self.ch, parser.parse(raw))
        self.assertEqual(row.ticket.project_id, self.inc.pk)
        self.assertIsNone(row.matched_rule_id)


class HelpdeskCustomTransportTests(TestCase):
    """Tier-2: a helpdesk CUSTOM transport sends notifications FROM its own address
    over its own connection when the project has no usable mailbox."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.hd = self.inc.helpdesk
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_from_name="IT Support",
        )
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(message_id="<ct-seed@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )
        self.req = User.objects.create_user(username="cust2", email="cust2@corp.com", password="x")

    def _transport(self, **kw):
        defaults = dict(
            helpdesk=self.hd, mode=TransportMode.CUSTOM, address="notify@acme.example",
            smtp_from_name="Acme IT", smtp_host="smtp.acme.example",
            smtp_username="u", smtp_password_enc="p",
        )
        defaults.update(kw)
        return HelpdeskEmailTransport.objects.create(**defaults)

    def _disable_mailbox(self):
        EmailChannel.objects.filter(pk=self.ch.pk).update(is_active=False, outbound_enabled=False)

    def _flush(self, key):
        from apps.itsm_notifications.models import NotificationOutbox
        from apps.itsm_notifications.services import outbox as outbox_service

        NotificationOutbox.objects.create(
            event_type="TicketCreated", ticket=self.ticket, recipient=self.req,
            rendered_subject="Hi", rendered_body="b", dedupe_key=key, status="queued",
        )
        locmem = get_connection("django.core.mail.backends.locmem.EmailBackend")
        with patch("apps.itsm_email.services.transport._connection_for", return_value=locmem):
            outbox_service.flush()
        return mail.outbox[-1]

    def test_custom_transport_used_when_no_mailbox(self):
        self._transport()
        self._disable_mailbox()
        msg = self._flush("k-custom")
        self.assertEqual(msg.from_email, "Acme IT <notify@acme.example>")
        self.assertEqual(msg.reply_to, ["notify@acme.example"])

    def test_mailbox_wins_over_custom_transport(self):
        self._transport()
        msg = self._flush("k-mailbox-wins")
        self.assertEqual(msg.from_email, self.ch.from_header)

    def test_system_mode_transport_falls_to_platform(self):
        from django.conf import settings as dj_settings
        from email.utils import formataddr

        self._transport(mode=TransportMode.SYSTEM)  # a SYSTEM-mode row is not a custom sender
        self._disable_mailbox()
        msg = self._flush("k-sysmode")
        self.assertEqual(msg.from_email, formataddr((self.hd.name, dj_settings.PLATFORM_NOTIFY_FROM)))

    def test_unverified_custom_transport_skipped(self):
        from django.conf import settings as dj_settings
        from email.utils import formataddr

        self._transport(send_verified=False)  # confirmed permanent failure ⇒ step aside
        self._disable_mailbox()
        msg = self._flush("k-unverif")
        self.assertEqual(msg.from_email, formataddr((self.hd.name, dj_settings.PLATFORM_NOTIFY_FROM)))


class MailboxFailOpenGateTests(TestCase):
    """The mailbox tier is fail-open: NULL/True keep sending from the mailbox; only an
    explicit False (confirmed permanent failure) reroutes to the fallback."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_from_name="IT Support",
        )
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(message_id="<fo-seed@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )

    def test_null_is_used(self):
        self.assertIsNone(self.ch.outbound_send_verified)
        self.assertIsNotNone(transport.get_outbound_config(self.ticket))

    def test_true_is_used(self):
        EmailChannel.objects.filter(pk=self.ch.pk).update(outbound_send_verified=True)
        self.assertIsNotNone(transport.get_outbound_config(self.ticket))

    def test_false_steps_aside(self):
        EmailChannel.objects.filter(pk=self.ch.pk).update(outbound_send_verified=False)
        self.assertIsNone(transport.get_outbound_config(self.ticket))


class SendCapabilitySelfHealTests(TestCase):
    """On a send failure the outbox flips the sender's capability off ONLY for confirmed
    permanent failures; transient/per-recipient failures leave it alone."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="C", project=self.inc, address="support@itsm.local",
            smtp_host="smtp.itsm.local", smtp_from_name="IT Support",
        )
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(message_id="<sh-seed@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )
        self.req = User.objects.create_user(username="cust3", email="cust3@corp.com", password="x")

    def _flush_with_send_error(self, exc):
        from django.core.mail import EmailMultiAlternatives
        from apps.itsm_notifications.models import NotificationOutbox
        from apps.itsm_notifications.services import outbox as outbox_service

        NotificationOutbox.objects.create(
            event_type="TicketCreated", ticket=self.ticket, recipient=self.req,
            rendered_subject="Hi", rendered_body="b", dedupe_key="k-heal", status="queued",
        )
        locmem = get_connection("django.core.mail.backends.locmem.EmailBackend")
        with patch("apps.itsm_email.services.transport._connection_for", return_value=locmem), \
             patch.object(EmailMultiAlternatives, "send", side_effect=exc):
            outbox_service.flush()
        self.ch.refresh_from_db()

    def test_permanent_error_flips_off(self):
        import smtplib
        self._flush_with_send_error(smtplib.SMTPAuthenticationError(535, b"auth failed"))
        self.assertIs(self.ch.outbound_send_verified, False)
        self.assertIn("535", self.ch.outbound_verify_error)

    def test_transient_error_leaves_unchanged(self):
        import socket
        self._flush_with_send_error(socket.timeout("timed out"))
        self.assertIsNone(self.ch.outbound_send_verified)

    def test_recipient_refused_does_not_flip(self):
        import smtplib
        self._flush_with_send_error(smtplib.SMTPRecipientsRefused({"x@y": (550, b"no")}))
        self.assertIsNone(self.ch.outbound_send_verified)


class VerifyClassifierTests(TestCase):
    def test_permanent(self):
        import smtplib
        self.assertTrue(verify.is_permanent(smtplib.SMTPAuthenticationError(535, b"x")))
        self.assertTrue(verify.is_permanent(oauth.OAuthError("bad grant")))
        self.assertTrue(verify.is_permanent(smtplib.SMTPSenderRefused(553, b"not owned", "s@x")))
        self.assertTrue(verify.is_permanent(smtplib.SMTPException("XOAUTH2 authentication failed: 535")))
        self.assertTrue(verify.is_permanent(smtplib.SMTPNotSupportedError("no AUTH")))

    def test_transient(self):
        import smtplib
        import socket
        self.assertFalse(verify.is_permanent(socket.timeout()))
        self.assertFalse(verify.is_permanent(smtplib.SMTPServerDisconnected()))
        self.assertFalse(verify.is_permanent(smtplib.SMTPConnectError(421, b"busy")))
        self.assertFalse(verify.is_permanent(smtplib.SMTPRecipientsRefused({})))
        self.assertFalse(verify.is_permanent(Exception("weird")))


class HelpdeskEmailTransportModelTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = _project("IT", "incident")
        self.hd = self.inc.helpdesk

    def test_properties(self):
        t = HelpdeskEmailTransport.objects.create(
            helpdesk=self.hd, mode=TransportMode.CUSTOM, address="notify@acme.example",
            smtp_from_name="Acme IT",
        )
        self.assertEqual(t.from_header, "Acme IT <notify@acme.example>")
        self.assertFalse(t.is_oauth)
        self.assertEqual(t.effective_smtp_username, "notify@acme.example")
        t.auth_method = "oauth_microsoft"
        self.assertTrue(t.is_oauth)

    def test_reverify_persists_failure(self):
        t = HelpdeskEmailTransport.objects.create(helpdesk=self.hd, mode=TransportMode.CUSTOM)
        res = verify.reverify("transport", t)
        t.refresh_from_db()
        self.assertFalse(res["ok"])          # no SMTP host / not OAuth ⇒ cannot send
        self.assertIs(t.send_verified, False)

    def test_authorize_url_send_only_scope_and_kind(self):
        from urllib.parse import urlparse, parse_qs

        t = HelpdeskEmailTransport.objects.create(
            helpdesk=self.hd, mode=TransportMode.CUSTOM, auth_method="oauth_microsoft",
            address="notify@acme.example", oauth_client_id="cid",
            oauth_client_secret_enc="sec", oauth_scope_override=oauth.MICROSOFT_SEND_ONLY_SCOPE,
        )
        url = oauth.authorize_url(t, kind="helpdesk_transport")
        q = parse_qs(urlparse(url).query)
        self.assertEqual(q["scope"][0], oauth.MICROSOFT_SEND_ONLY_SCOPE)
        self.assertNotIn("IMAP.AccessAsUser.All", q["scope"][0])
        cid, _org, kind = oauth.parse_state(q["state"][0])
        self.assertEqual((cid, kind), (str(t.id), "helpdesk_transport"))


# The signature that shipped verbatim into INC20's description: an Outlook
# `<div id="Signature">` holding a cid: logo and bold contact lines. Nothing in
# it matches the plain-text `strip_quotes` heuristics.
_OUTLOOK_SIG_HTML = (
    "<div>"
    "<p>Hello Team,</p>"
    "<p>I am facing consistent BSOD error since yesterday, request you to kindly do the needful.</p>"
    '<div id="Signature">'
    '<table><tr><td><img src="cid:logo01@grid" alt="Gridcrest Technologies"></td>'
    "<td><p><b>Vijay Rawat</b></p><p><b>Senior System Administrator</b></p>"
    "<p><b>GridCrest Technologies Private Limited</b></p>"
    "<p><b>Phone:</b> +91-91473 78448</p>"
    '<p><b>Email:</b> <a href="mailto:vijay.rawat@gridcrest.io">vijay.rawat@gridcrest.io</a></p>'
    "</td></tr></table></div></div>"
)


class ScrubSignatureTests(TestCase):
    """Unit tests for the HTML-aware cut — no DB, no channel."""

    def test_outlook_signature_div_is_cut(self):
        out = scrub.strip_signature(_OUTLOOK_SIG_HTML)
        self.assertIn("BSOD error", out)
        self.assertNotIn("Vijay Rawat", out)
        self.assertNotIn("Senior System Administrator", out)
        self.assertNotIn("vijay.rawat@gridcrest.io", out)

    def test_owa_x_prefixed_class_is_cut(self):
        # OWA re-writes the client's classes with an `x_` prefix.
        out = scrub.strip_signature('<p>Issue here.</p><div class="x_Signature"><p>Vijay</p></div>')
        self.assertEqual(out, "<p>Issue here.</p>")

    def test_gmail_signature_and_quote_are_cut(self):
        out = scrub.strip_signature(
            '<div dir="ltr">Printer jammed.</div>'
            '<div class="gmail_signature">--<br>Alice</div>'
        )
        self.assertEqual(out, '<div dir="ltr">Printer jammed.</div>')

    def test_cited_blockquote_is_cut(self):
        out = scrub.strip_signature('<p>Any update?</p><blockquote type="cite"><p>old</p></blockquote>')
        self.assertEqual(out, "<p>Any update?</p>")

    def test_reply_attribution_is_cut(self):
        out = scrub.strip_signature(
            "<p>See below.</p><p>On Thu, 25 Jun 2026 at 10:36, Alice &lt;a@x&gt; wrote:</p><p>old</p>"
        )
        self.assertIn("See below", out)
        self.assertNotIn("wrote:", out)
        self.assertNotIn("old", out)

    def test_custom_marker_cuts_and_spans_inline_tags(self):
        # The phrase is split across two <span>s — text must accumulate to match.
        out = scrub.strip_signature(
            "<p>VPN is down.</p><p><span>Thanks </span><span>&amp; Regards</span></p><p>Vijay</p>",
            ["Thanks & Regards"],
        )
        self.assertEqual(out, "<p>VPN is down.</p>")

    def test_unknown_marker_leaves_body_alone(self):
        html = "<p>Hello</p><p>My laptop is slow.</p>"
        self.assertEqual(scrub.strip_signature(html), html)

    def test_sentence_starting_with_on_is_kept(self):
        html = "<p>On Monday the server rebooted itself.</p><p>Please check.</p>"
        self.assertEqual(scrub.strip_signature(html), html)

    def test_never_returns_empty(self):
        # Body that is *only* a signature: keep it rather than file a blank ticket.
        html = '<div id="Signature"><p>Vijay</p></div>'
        self.assertEqual(scrub.strip_signature(html), html)

    def test_cut_quotes_false_keeps_history(self):
        html = '<p>hi</p><blockquote type="cite">old</blockquote>'
        self.assertEqual(scrub.strip_signature(html, cut_quotes=False), html)

    def test_malformed_html_never_raises(self):
        out = scrub.strip_signature('<p>unclosed <div id="Signature"><p>Vijay')
        self.assertIn("unclosed", out)
        self.assertNotIn("Vijay", out)


class SignatureStrippingPipelineTests(TestCase):
    """The channel toggle, end-to-end through process_inbound."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="Support", project=self.inc, address="support@itsm.local", create_users=True,
        )

    def _process(self, raw):
        return inbound.process_inbound(self.ch, parser.parse(raw))

    def test_off_by_default_description_keeps_signature(self):
        self.assertFalse(self.ch.strip_signatures)
        row = self._process(_raw(subject="BSOD Error", message_id="<sig-off@x>",
                                 body_html=_OUTLOOK_SIG_HTML))
        self.assertIn("Vijay Rawat", row.ticket.description_text)

    def test_enabled_strips_signature_from_description(self):
        self.ch.strip_signatures = True
        self.ch.save(update_fields=["strip_signatures"])
        row = self._process(_raw(subject="BSOD Error", message_id="<sig-on@x>",
                                 body_html=_OUTLOOK_SIG_HTML))
        self.assertEqual(row.action_taken, "created_ticket")
        self.assertIn("BSOD error", row.ticket.description_text)
        self.assertNotIn("Vijay Rawat", row.ticket.description_html)
        self.assertNotIn("gridcrest.io", row.ticket.description_html)

    def test_enabled_strips_signature_from_reply_comment(self):
        self.ch.strip_signatures = True
        self.ch.save(update_fields=["strip_signatures"])
        new = self._process(_raw(subject="BSOD Error", message_id="<sig-t@x>",
                                 body_html="<p>original</p>"))
        num = new.ticket.ticket_number
        reply = self._process(_raw(
            subject=f"Re: [{num}] BSOD Error", message_id="<sig-r@x>",
            body_html='<p>Still crashing.</p><div id="Signature"><p>Vijay Rawat</p></div>',
        ))
        self.assertEqual(reply.action_taken, "added_comment")
        self.assertIn("Still crashing", reply.comment.body_text)
        self.assertNotIn("Vijay Rawat", reply.comment.body_text)

    def test_channel_markers_are_applied(self):
        self.ch.strip_signatures = True
        self.ch.signature_markers = ["Thanks & Regards"]
        self.ch.save(update_fields=["strip_signatures", "signature_markers"])
        row = self._process(_raw(
            subject="VPN down", message_id="<sig-mk@x>",
            body_html="<p>VPN is down.</p><p>Thanks &amp; Regards</p><p>Vijay Rawat</p>",
        ))
        self.assertIn("VPN is down", row.ticket.description_text)
        self.assertNotIn("Vijay Rawat", row.ticket.description_text)

    def test_original_body_still_on_inbound_row(self):
        self.ch.strip_signatures = True
        self.ch.save(update_fields=["strip_signatures"])
        row = self._process(_raw(subject="BSOD Error", message_id="<sig-audit@x>",
                                 body_text="Hello Team,\n\nBSOD.\n\nVijay Rawat",
                                 body_html=_OUTLOOK_SIG_HTML))
        self.assertIn("Vijay Rawat", row.body_text)

    def test_inline_logo_is_not_promoted_to_an_attachment(self):
        # The cid: image lives in the *stripped* part of the body, but it must
        # still count as inline — otherwise every signature logo becomes a file
        # on the ticket.
        self.ch.strip_signatures = True
        self.ch.save(update_fields=["strip_signatures"])
        row = self._process(_raw(
            subject="BSOD Error", message_id="<sig-inline@x>", body_html=_OUTLOOK_SIG_HTML,
            attachments=[(b"PNGDATA", "logo.png", "image", "png", "<logo01@grid>")],
        ))
        self.assertNotIn("Vijay Rawat", row.ticket.description_html)
        self.assertEqual(TicketAttachment.objects.filter(ticket=row.ticket).count(), 0)


class SignatureMarkerValidationTests(TestCase):
    def test_short_marker_rejected(self):
        from .serializers import EmailChannelSerializer

        ser = EmailChannelSerializer()
        with self.assertRaises(Exception):
            ser.validate_signature_markers(["--"])

    def test_markers_trimmed_and_deduped(self):
        from .serializers import EmailChannelSerializer

        got = EmailChannelSerializer().validate_signature_markers(
            ["  Thanks & Regards ", "thanks & regards", "", "Best Regards"]
        )
        self.assertEqual(got, ["Thanks & Regards", "Best Regards"])
