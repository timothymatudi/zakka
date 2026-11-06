import json
import logging
import uuid
from decimal import Decimal

import httpx

from zakka_catalog.models import TrackingInfo
from zakka_catalog.notify import ConciergeNotifier
from zakka_catalog.orders import forward_order, poll_tracking

INFO = TrackingInfo(status="in_transit", carrier="DHL", tracking_number="T1", tracking_url="https://t/T1",
                    last_event="Departed")


def make_order(store, items):
    oid = uuid.uuid4()
    store.add_order(oid, "paid", "USD",
                    [{"offer_id": store.find_offer(s, e).id, "qty": q, "unit_price": "10", "unit_cost_usd": c}
                     for s, e, q, c in items],
                    {"name": "A", "line1": "1 St", "city": "Austin", "country_code": "US"})
    return oid


def live_notifier(handler, url="http://concierge.test:4030/"):
    return ConciergeNotifier({"CONCIERGE_PUBLIC_URL": url, "CONCIERGE_INTERNAL_TOKEN": "itok"},
                             http=httpx.Client(transport=httpx.MockTransport(handler)))


# --- unit_cost_usd -------------------------------------------------------------

def test_forward_fills_unit_cost_from_offer(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 2, None), ("printful", "4001", 1, "1.00"),
                              ("amazon", "B0MOCKUS01", 1, "5.00")])
    forward_order(synced, oid, connectors)
    costs = {i.external_id: i.unit_cost_usd for i in synced.get_order_items(oid)}
    assert costs == {"CJ-EAR-001": Decimal("6.80"), "4001": Decimal("9.25"), "B0MOCKUS01": None}


def test_unit_cost_filled_even_when_supplier_fails(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1, None)])
    connectors["cj"].place_order = lambda req: (_ for _ in ()).throw(RuntimeError("down"))
    forward_order(synced, oid, connectors)
    assert synced.get_order_items(oid)[0].unit_cost_usd == Decimal("6.80")


# --- notifier ------------------------------------------------------------------

def test_notifier_mock_mode_logs_only(caplog):
    n = ConciergeNotifier({})
    assert n.mock and n.base_url == "http://localhost:4030"
    with caplog.at_level(logging.INFO, logger="zakka_catalog.notify"):
        assert n.notify("o1", INFO) is True
    assert n.sent == [("o1", ConciergeNotifier.payload(INFO))]
    assert any("mock, not sent" in m for m in caplog.messages)


def test_notifier_live_request_shape():
    seen = {}

    def handler(request):
        seen.update(url=str(request.url), token=request.headers.get("x-internal-token"),
                    body=json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    assert live_notifier(handler).notify("ord-1", INFO) is True
    assert seen["url"] == "http://concierge.test:4030/internal/orders/ord-1/notify"
    assert seen["token"] == "itok"
    assert seen["body"] == {"status": "in_transit", "carrier": "DHL", "tracking_number": "T1",
                            "tracking_url": "https://t/T1", "last_event": "Departed"}


def test_notifier_failures_never_raise(caplog):
    def boom(request):
        raise httpx.ConnectError("refused", request=request)

    with caplog.at_level(logging.WARNING, logger="zakka_catalog.notify"):
        assert live_notifier(lambda r: httpx.Response(500, text="err")).notify("o", INFO) is False
        assert live_notifier(boom).notify("o", INFO) is False
    assert sum("concierge notify for order o failed" in m for m in caplog.messages) == 2


# --- polling integration ---------------------------------------------------------

def test_poll_notifies_only_on_status_change(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1, None)])
    forward_order(synced, oid, connectors)
    calls = []

    def handler(request):
        calls.append((request.url.path, json.loads(request.content)["status"]))
        return httpx.Response(200)

    n = live_notifier(handler)
    ups = poll_tracking(synced, connectors, n)
    assert ups[0].notified is True and calls == [(f"/internal/orders/{oid}/notify", "in_transit")]
    ups = poll_tracking(synced, connectors, n)  # same status again -> no call
    assert ups[0].notified is None and len(calls) == 1
    connectors["cj"]._mock_track = lambda ext: TrackingInfo(
        status="delivered", carrier="YunExpress", tracking_number=ups[0].tracking_number)
    poll_tracking(synced, connectors, n)
    assert calls[-1][1] == "delivered" and len(calls) == 2
    assert synced.get_order(oid).status == "delivered"


def test_poll_continues_when_concierge_is_down(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1, None), ("printful", "4001", 1, None)])
    forward_order(synced, oid, connectors)

    def boom(request):
        raise httpx.ConnectTimeout("timeout", request=request)

    ups = poll_tracking(synced, connectors, live_notifier(boom))
    assert len(ups) == 2 and all(u.notified is False and u.error is None for u in ups)
    assert len(synced.shipments) == 2 and synced.get_order(oid).status == "shipped"


def test_poll_in_mock_mode_records_without_http(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1, None)])
    forward_order(synced, oid, connectors)
    n = ConciergeNotifier({})
    poll_tracking(synced, connectors, n)
    assert [o for o, _ in n.sent] == [str(oid)]


def test_poll_can_enqueue_durable_notify_jobs(synced, connectors):
    from zakka_catalog.scale.jobqueue import SqliteJobQueue, Worker
    from zakka_catalog.scale.pipeline import ScaleContext, make_handlers

    oid = make_order(synced, [("cj", "CJ-EAR-001", 1, None)])
    forward_order(synced, oid, connectors)
    q = SqliteJobQueue(":memory:")
    ups = poll_tracking(synced, connectors, ConciergeNotifier({}), queue=q)
    assert ups[0].notified is True and q.counts() == {"queued": 1}
    n = ConciergeNotifier({})
    ctx = ScaleContext(make_bulk=lambda: None, queue=q, connectors={}, enricher=None, notifier=n)
    Worker(q, make_handlers(ctx)).drain()
    assert [o for o, _ in n.sent] == [str(oid)] and q.counts() == {"done": 1}
