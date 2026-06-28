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

from .models import EmailChannel, EmailThreadMessage, InboundEmail
from .services import detectors, identity, mailbox, parser, priority, system_user, threading, transport

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
    for data, filename, maintype, subtype in (attachments or []):
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
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
            create_users=True, default_priority="medium",
        )

    def test_x_priority_maps_to_critical(self):
        p = parser.parse(_raw(headers={"X-Priority": "1 (Highest)"}, message_id="<pri1@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "critical")

    def test_importance_high_maps_to_high(self):
        p = parser.parse(_raw(headers={"Importance": "High"}, message_id="<pri2@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "high")

    def test_no_signal_falls_back_to_default(self):
        self.ch.default_priority = "low"
        self.ch.save(update_fields=["default_priority"])
        p = parser.parse(_raw(message_id="<pri3@x>"))
        self.assertEqual(priority.resolve_priority(p, self.ch), "low")

    def test_pipeline_applies_mapped_priority(self):
        from apps.itsm_email.services import inbound
        row = inbound.process_inbound(self.ch, parser.parse(
            _raw(subject="urgent thing", headers={"X-Priority": "1"}, message_id="<prip@x>")))
        self.assertEqual(row.ticket.priority, "critical")


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
        cid, _org = oauth.parse_state(q["state"][0])
        self.assertEqual(cid, str(ch.id))

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


class BaselineCursorTests(TestCase):
    """First connect must NOT back-fill an existing inbox — it sets a 'start from
    now' UID high-water mark so only mail arriving after connection is ingested."""

    def setUp(self):
        _seed_min()
        system_user.reset_cache()
        self.inc = _project("IT", "incident")
        self.ch = EmailChannel.objects.create(
            name="B", project=self.inc, address="support@itsm.local", protocol="imap",
        )

    def test_first_poll_sets_baseline_and_skips_backfill(self):
        from apps.itsm_email.services import poller
        with patch("apps.itsm_email.services.mailbox.current_max_uid", return_value=22641) as cmu, \
             patch("apps.itsm_email.services.mailbox.fetch_new") as fetch:
            res = poller.poll_channel(self.ch)
        cmu.assert_called_once()
        fetch.assert_not_called()                 # no back-fill on the baseline poll
        self.ch.refresh_from_db()
        self.assertEqual(self.ch.last_seen_uid, 22641)
        self.assertEqual(res["processed"], 0)
        self.assertEqual(res["baseline_uid"], 22641)

    def test_subsequent_poll_fetches_new_only(self):
        from apps.itsm_email.services import poller
        self.ch.last_seen_uid = 100
        self.ch.save(update_fields=["last_seen_uid"])
        with patch("apps.itsm_email.services.mailbox.current_max_uid") as cmu, \
             patch("apps.itsm_email.services.mailbox.fetch_new", return_value=iter([])) as fetch:
            poller.poll_channel(self.ch)
        cmu.assert_not_called()                   # baseline already established
        fetch.assert_called_once()                # normal incremental fetch

    def test_pop3_is_exempt_from_baseline(self):
        from apps.itsm_email.services import poller
        self.ch.protocol = "pop3"
        self.ch.save(update_fields=["protocol"])
        with patch("apps.itsm_email.services.mailbox.current_max_uid") as cmu, \
             patch("apps.itsm_email.services.mailbox.fetch_new", return_value=iter([])) as fetch:
            poller.poll_channel(self.ch)
        cmu.assert_not_called()                   # POP3 already fetches recent-only
        fetch.assert_called_once()
