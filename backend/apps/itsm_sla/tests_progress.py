"""M5 (2026-10-18): the queue SLA bar fills by BUSINESS time. `timer_snapshot` is the
one source for the queue list entry and the detail countdown, and the list stays at
a constant number of queries per page."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from .tests_priority_recalc import SlaTicketMixin

UTC = ZoneInfo("UTC")
FRI_16 = datetime(2026, 10, 16, 16, 0, tzinfo=UTC)   # Friday 16:00
MON_08 = datetime(2026, 10, 19, 8, 0, tzinfo=UTC)    # Monday 08:00 (before opening)


class TimerSnapshotTests(SlaTicketMixin, TestCase):
    def setUp(self):
        from .models import BusinessCalendar, BusinessHours
        self._seed()
        self.cal = BusinessCalendar.objects.create(name="9-5", timezone="UTC")
        for d in range(5):
            BusinessHours.objects.create(calendar=self.cal, weekday=d,
                                         start_time=time(9, 0), end_time=time(17, 0))
        self.ticket = self._create("p4")  # p4 has no targets → no auto clocks

    def _tracker(self, metric, **kw):
        from .models import SLATracker
        kw.setdefault("target_minutes", 120)
        kw.setdefault("started_at", FRI_16)
        kw.setdefault("due_at", datetime(2026, 10, 19, 10, 0, tzinfo=UTC))  # 60 Fri + 60 Mon
        return SLATracker.objects.create(ticket=self.ticket, metric=metric, calendar=self.cal, **kw)

    def test_weekend_counts_no_business_time(self):
        from .services import sla_engine
        tr = self._tracker(self.res)
        snap = sla_engine.timer_snapshot(tr, now=MON_08)
        # Wall-clock would be 64h of a 66h window (~97%, amber); business time is 60 of 120.
        self.assertAlmostEqual(snap["elapsed_minutes"], 60, delta=0.1)
        self.assertEqual(snap["percent_used"], 50.0)
        self.assertEqual(snap["rag"], "green")
        self.assertFalse(snap["breached"])

    def test_paused_clock_percent_is_frozen(self):
        from .services import sla_engine
        tr = self._tracker(self.res, state="paused",
                           paused_at=datetime(2026, 10, 19, 9, 30, tzinfo=UTC))
        later = datetime(2026, 10, 19, 15, 0, tzinfo=UTC)
        snap = sla_engine.timer_snapshot(tr, now=later)
        self.assertEqual(snap["percent_used"], 75.0)  # 60 Fri + 30 Mon, frozen at the pause
        self.assertEqual(snap["rag"], "amber")

    def test_list_entry_matches_detail_countdown(self):
        from apps.itsm_tickets.serializers import _list_sla_entry

        from .services import sla_engine
        tr = self._tracker(self.res)
        entry = _list_sla_entry(tr, MON_08)
        snap = sla_engine.timer_snapshot(tr, now=MON_08)
        self.assertEqual(entry["percent_used"], snap["percent_used"])
        self.assertEqual(entry["rag"], snap["rag"])
        self.assertIn("percent_used", sla_engine.countdown_payload(tr))

    def test_finished_clock_colour_is_outcome(self):
        from .services import sla_engine
        tr = self._tracker(self.res, state="met",
                           stopped_at=datetime(2026, 10, 19, 9, 50, tzinfo=UTC))
        snap = sla_engine.timer_snapshot(tr, now=MON_08 + timedelta(days=3))
        self.assertGreater(snap["percent_used"], 90)
        self.assertEqual(snap["rag"], "green")

    def _list_queries(self, n):
        from apps.itsm_tickets.serializers import TicketListSerializer
        from apps.itsm_tickets.views import TicketViewSet

        ids = []
        for _ in range(n):
            t = self._create("p4")
            for metric in (self.fr, self.res):
                from .models import SLATracker
                SLATracker.objects.create(ticket=t, metric=metric, calendar=self.cal, target_minutes=120,
                                          started_at=FRI_16, due_at=FRI_16 + timedelta(days=3))
            ids.append(t.id)
        qs = TicketViewSet.queryset.filter(id__in=ids)
        with CaptureQueriesContext(connection) as ctx:
            data = TicketListSerializer(qs, many=True).data
        self.assertTrue(all(row["sla"]["resolution"]["percent_used"] is not None for row in data))
        return len(ctx.captured_queries)

    def test_list_query_count_is_constant(self):
        small = self._list_queries(2)
        big = self._list_queries(6)
        self.assertEqual(small, big)
