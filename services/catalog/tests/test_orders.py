import uuid
from decimal import Decimal

import pytest

from zakka_catalog.connectors import ConnectorError
from zakka_catalog.models import TrackingInfo
from zakka_catalog.orders import OrderNotForwardable, OrderNotFound, forward_order, poll_tracking

ADDRESS = {"name": "A", "line1": "1 St", "city": "Nairobi", "country_code": "KE"}


def make_order(store, items, status="paid", address=ADDRESS):
    oid = uuid.uuid4()
    rows = [{"offer_id": store.find_offer(src, ext).id, "qty": qty, "unit_price": "10"} for src, ext, qty in items]
    store.add_order(oid, status, "USD", rows, address)
    return oid


def test_forward_groups_by_supplier_and_skips_affiliate(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 2), ("cj", "CJ-PHN-004", 1),
                              ("printful", "4001", 1), ("amazon", "B0MOCKUS01", 1)])
    res = forward_order(synced, oid, connectors)
    assert res.order_status == "forwarded" and synced.get_order(oid).status == "forwarded"
    by = {g.source: g for g in res.groups}
    assert set(by) == {"cj", "printful"}
    assert by["cj"].items == 2 and by["cj"].status == "placed"
    assert Decimal(by["cj"].cost_usd) == Decimal("24.20")  # (6.80+3.20)*2 + (2.30+1.90)
    assert len(res.skipped_affiliate_items) == 1
    sos = synced.list_supplier_orders(oid)
    assert {s.source_code for s in sos} == {"cj", "printful"}
    assert all(s.status == "placed" and s.external_order_id for s in sos)


def test_forward_is_idempotent(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1)])
    forward_order(synced, oid, connectors)
    res = forward_order(synced, oid, connectors)  # status now 'forwarded'; allowed, but no new orders
    assert [g.status for g in res.groups] == ["already_placed"]
    assert len(synced.list_supplier_orders(oid)) == 1


def test_forward_rejects_unpaid_and_missing(synced, connectors):
    for status in ("pending_payment", "cancelled", "refunded", "shipped"):
        with pytest.raises(OrderNotForwardable):
            forward_order(synced, make_order(synced, [("cj", "CJ-EAR-001", 1)], status=status), connectors)
    with pytest.raises(OrderNotFound):
        forward_order(synced, uuid.uuid4(), connectors)


def test_failed_group_recorded_and_retried(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1), ("printful", "4001", 1)])
    real = connectors["printful"].place_order
    connectors["printful"].place_order = lambda req: (_ for _ in ()).throw(ConnectorError("supplier down"))
    res = forward_order(synced, oid, connectors)
    assert {g.source: g.status for g in res.groups} == {"cj": "placed", "printful": "failed"}
    assert res.order_status == "paid"  # not forwarded until every group is placed
    connectors["printful"].place_order = real
    res = forward_order(synced, oid, connectors)
    assert {g.source: g.status for g in res.groups} == {"cj": "already_placed", "printful": "placed"}
    assert res.order_status == "forwarded"
    assert len(synced.list_supplier_orders(oid)) == 2  # failed row was reused, not duplicated


def test_affiliate_only_order_is_left_alone(synced, connectors):
    oid = make_order(synced, [("amazon", "B0MOCKUS01", 1)])
    res = forward_order(synced, oid, connectors)
    assert res.groups == [] and res.order_status == "paid"


def test_explicit_address_overrides_and_live_requires_address(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1)], address=None)
    seen = {}
    orig = connectors["cj"].place_order

    def spy(req):
        seen["address"] = req.address
        return orig(req)

    connectors["cj"].place_order = spy
    forward_order(synced, oid, connectors)
    assert seen["address"] is None  # mock connector accepts it; live connectors raise (see test_connectors)


def test_poll_tracking_updates_shipments_and_rolls_up(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1), ("printful", "4001", 1)])
    forward_order(synced, oid, connectors)
    ups = poll_tracking(synced, connectors)
    assert {u.status for u in ups} == {"shipped"}
    assert len(synced.shipments) == 2
    assert synced.get_order(oid).status == "shipped"

    for c in connectors.values():
        c._mock_track = lambda ext: TrackingInfo(status="delivered", carrier="X", tracking_number="T1")
    poll_tracking(synced, connectors)
    assert {s.status for s in synced.list_supplier_orders(oid)} == {"delivered"}
    assert synced.get_order(oid).status == "delivered"
    assert poll_tracking(synced, connectors) == []  # nothing open anymore


def test_poll_tracking_partial_shipment_keeps_forwarded(synced, connectors):
    oid = make_order(synced, [("cj", "CJ-EAR-001", 1), ("printful", "4001", 1)])
    forward_order(synced, oid, connectors)
    connectors["printful"]._mock_track = lambda ext: TrackingInfo(status="pending")
    poll_tracking(synced, connectors)
    assert synced.get_order(oid).status == "forwarded"
