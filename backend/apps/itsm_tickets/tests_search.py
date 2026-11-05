"""G6 — ticket search: Postgres full-text + pg_trgm, ranking, scoping, comments.

These run the real ORM queries against Postgres (the throwaway test DB). In test mode
every app is flattened into the `public` schema, so pg_trgm and the tables share one
schema here; the multi-schema behaviour (extension in `public`, indexes per tenant,
search_path `<tenant>, public`) is verified separately by the WS8 two-schema script
(`scratchpad/ws8/scripts/check_multischema.py`).
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.itsm_rbac.models import RoleAssignment, RoleModulePermission, SystemRole

from .models import Comment, Ticket, TicketNumberAlias
from .services import search, ticket_service
from .tests import _project, _seed_min

User = get_user_model()


class TicketSearchTests(TestCase):
    def setUp(self):
        cache.clear()  # check_permission caches per (role, module, action)
        _seed_min()
        self.proj = _project("IT", "incident")
        self.hr = _project("HR", "incident")
        self.admin = User.objects.create_superuser(username="root-search", password="x")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = reverse("itsm-ticket-list")

    def _mk(self, summary="T", project=None, **kw):
        project = project or self.proj
        kw.setdefault("priority", "p3")
        with self.captureOnCommitCallbacks(execute=True):
            return ticket_service.create_ticket(
                project=project, ticket_type=project.ticket_types.first(),
                summary=summary, apply_routing=False, **kw,
            )

    def _search(self, term, client=None, **params):
        resp = (client or self.client).get(self.url, {"search": term, "page_size": 100, **params})
        self.assertEqual(resp.status_code, 200, resp.content)
        return [r["ticket_number"] for r in resp.data["results"]]

    def _agent(self, username="ag-search", private=True):
        from apps.itsm_helpdesks.models import HelpdeskMembership
        from apps.itsm_projects.models import ProjectMembership

        agent = User.objects.create_user(username=username, password="x")
        role = SystemRole.objects.get(code="agent")
        RoleAssignment.objects.create(user=agent, role=role)
        HelpdeskMembership.objects.create(helpdesk_id=self.proj.helpdesk_id, user=agent)
        ProjectMembership.objects.create(project=self.proj, user=agent)
        if not private:
            RoleModulePermission.objects.filter(
                role=role, module__code="itsm.tickets.comments_private").update(can_read=False)
            cache.clear()
        client = APIClient()
        client.force_authenticate(agent)
        return client

    # ── infrastructure ────────────────────────────────────────────────────────
    def test_pg_trgm_installed_in_public_schema(self):
        with connection.cursor() as cur:
            cur.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n "
                        "ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'")
            self.assertEqual(cur.fetchone(), ("public",))

    def test_index_expressions_match_query_expressions(self):
        """Postgres only uses an expression index when the query expression is identical."""
        t_idx = {i.name: i for i in Ticket._meta.indexes}
        self.assertEqual(t_idx["itsm_tkt_search_fts"].expressions[0], search.ticket_fts_vector())
        c_idx = {i.name: i for i in Comment._meta.indexes}
        self.assertEqual(c_idx["itsm_cmt_body_fts"].expressions[0], search.comment_fts_vector())
        self.assertEqual(search.FTS_TEXT_CAP, 100_000)

    # ── ticket numbers ─────────────────────────────────────────────────────────
    def test_exact_number_then_prefix_then_text_mentions(self):
        tickets = [self._mk(f"Ticket {i}") for i in range(12)]   # ITINC1 … ITINC12
        first = tickets[0]
        # Substring match only (another project, so its own number isn't an ITINC1… prefix).
        mention = self._mk(f"Follow-up of {first.ticket_number}",
                           project=_project("IT", "service_request"))
        got = self._search(first.ticket_number)
        self.assertEqual(got[0], first.ticket_number)              # exact
        prefix = {t.ticket_number for t in tickets[9:12]}          # ITINC10/11/12
        self.assertEqual(set(got[1:4]), prefix)
        self.assertIn(mention.ticket_number, got[4:])

    def test_digits_only_number_suffix_ranks_first(self):
        tickets = [self._mk(f"Ticket {i}") for i in range(12)]
        got = self._search("2")
        self.assertEqual(got[0], tickets[1].ticket_number)        # ITINC2 before ITINC12
        self.assertIn(tickets[11].ticket_number, got)

    def test_hyphenated_and_hash_number_forms(self):
        t = self._mk("Keyboard")
        key, n = self.proj.key, t.ticket_number[len(self.proj.key):]
        self.assertEqual(self._search(f"{key}-{n}")[0], t.ticket_number)
        self.assertEqual(self._search(f"{key.lower()} {n}")[0], t.ticket_number)

    def test_moved_ticket_found_by_old_number(self):
        t = self._mk("Moved one")
        TicketNumberAlias.objects.create(ticket=t, old_number="OLDX77", new_number=t.ticket_number)
        self.assertEqual(self._search("OLDX77"), [t.ticket_number])

    # ── text ──────────────────────────────────────────────────────────────────
    def test_typo_tolerant_summary(self):
        hit = self._mk("Printer jammed on floor 3")
        self._mk("Laptop battery")
        got = self._search("printr")
        self.assertEqual(got, [hit.ticket_number])

    def test_stemmed_full_text_over_description(self):
        hit = self._mk("Office issue", description_html="<p>The printers keep disconnecting</p>")
        self._mk("Other", description_html="<p>Nothing relevant</p>")
        # "disconnected" is not a substring of "disconnecting" — only FTS stemming matches.
        self.assertEqual(self._search("disconnected printer"), [hit.ticket_number])

    def test_summary_hit_outranks_newer_description_hit(self):
        summary_hit = self._mk("VPN tunnel down")
        desc_hit = self._mk("Remote access", description_html="<p>user says vpn is slow</p>")
        got = self._search("vpn")
        self.assertEqual(got, [summary_hit.ticket_number, desc_hit.ticket_number])
        # The queue always sends its default ordering — that still ranks by relevance.
        self.assertEqual(self._search("vpn", ordering="-created_at"), got)

    def test_explicit_ordering_wins_over_relevance(self):
        summary_hit = self._mk("VPN tunnel down")
        desc_hit = self._mk("Remote access", description_html="<p>user says vpn is slow</p>")
        self.assertEqual(self._search("vpn", ordering="created_at"),
                         [summary_hit.ticket_number, desc_hit.ticket_number])
        self.assertEqual(self._search("vpn", ordering="-updated_at")[0], desc_hit.ticket_number)

    def test_combines_with_filters(self):
        p2 = self._mk("Printer offline", priority="p2")
        self._mk("Printer offline too", priority="p4")
        self.assertEqual(self._search("printer", priority="p2"), [p2.ticket_number])

    def test_short_query_is_substring_only(self):
        hit = self._mk("PC will not boot")
        self._mk("Monitor", description_html="<p>pc flicker</p>")   # description ignored <3 chars
        self.assertEqual(self._search("pc"), [hit.ticket_number])

    def test_special_characters_never_error(self):
        self._mk("C++ compiler crash")
        for term in ("c++ & (foo) 'bar' :*", "!!", "a|b<->c", "\\", "%_%"):
            self._search(term)
        self.assertEqual(len(self._search("c++")), 1)

    def test_pulse_counts_the_same_matches(self):
        self._mk("Printer jammed")
        self._mk("Printer offline")
        self._mk("Laptop")
        resp = self.client.get(reverse("itsm-ticket-pulse"), {"search": "printr"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], len(self._search("printr")))
        self.assertEqual(resp.data["count"], 2)

    # ── scope + comments ──────────────────────────────────────────────────────
    def test_helpdesk_scope_is_kept(self):
        mine = self._mk("Printer jammed")
        other = self._mk("Printer jammed in HR", project=self.hr)
        ticket_service.add_comment(ticket=other, author=self.admin, body_html="<p>printer jammed</p>")
        got = self._search("printer", client=self._agent())
        self.assertEqual(got, [mine.ticket_number])
        self.assertNotIn(other.ticket_number, got)
        self.assertIn(other.ticket_number, self._search("printer"))  # superuser sees both

    def test_public_comment_text_is_searchable(self):
        t = self._mk("Billing question")
        self._mk("Unrelated")
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=t, author=self.admin,
                                       body_html="<p>Invoice 5531 attached</p>")
        self.assertEqual(self._search("invoices", client=self._agent()), [t.ticket_number])

    def test_internal_note_only_for_users_who_can_read_it(self):
        t = self._mk("Account issue")
        with self.captureOnCommitCallbacks(execute=True):
            ticket_service.add_comment(ticket=t, author=self.admin, visibility="private",
                                       body_html="<p>escalated to zanzibar team</p>")
        self.assertEqual(self._search("zanzibar", client=self._agent("ag-priv")), [t.ticket_number])
        self.assertEqual(self._search("zanzibar", client=self._agent("ag-nopriv", private=False)), [])

    def test_link_picker_request_shape(self):
        """The Linked-issues picker sends only ?search=&page_size= (no ordering)."""
        hit = self._mk("Printer jammed")
        resp = self.client.get(self.url, {"search": "printr", "page_size": 25})
        self.assertEqual([r["ticket_number"] for r in resp.data["results"]], [hit.ticket_number])
