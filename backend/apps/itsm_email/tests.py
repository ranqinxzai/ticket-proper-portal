"""Tests for the email channel: crypto, parser, detectors, threading,
idempotency, identity, attachments, e2e, and outbound threading."""

from __future__ import annotations

import email.utils
from email.message import EmailMessage

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from apps.itsm_projects.models import Project
from apps.itsm_rbac.registry import seed_rbac
from apps.itsm_rbac.services import check_permission
from apps.itsm_tickets.models import Comment, CommentAttachment, Ticket, TicketAttachment

from .models import EmailChannel, EmailThreadMessage, InboundEmail
from .services import detectors, identity, parser, system_user, threading

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
        from apps.itsm_email.services import inbound
        self.ticket = inbound._create_ticket(
            self.ch, parser.parse(_raw(subject="Seed ticket", message_id="<seed@x>")),
            sender=None, bot=system_user.get_email_bot(),
        )

    def test_subject_token_resolves_reply(self):
        num = self.ticket.ticket_number
        p = parser.parse(_raw(subject=f"Re: [{num}] follow up", message_id="<r1@x>"))
        kind, ticket = threading.resolve_thread(self.ch, p)
        self.assertEqual(kind, "reply")
        self.assertEqual(ticket.pk, self.ticket.pk)

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

    def test_outbound_headers_recorded(self):
        result = threading.build_outbound_headers(self.ticket, "cust@corp.com", outbox_id="42")
        self.assertIn("Message-ID", result["headers"])
        self.assertTrue(result["reply_to"][0].endswith(f"+{self.ticket.ticket_number}@" +
                                                        self.ch.effective_domain))
        self.assertTrue(EmailThreadMessage.objects.filter(
            ticket=self.ticket, direction="outbound").exists())


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
