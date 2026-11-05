import json
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from zakka_catalog.api import create_app
from zakka_catalog.connectors.base import load_fixture
from zakka_catalog.pricing import ZERO_DECIMAL_CURRENCIES, default_decimals
from zakka_catalog.store import MemoryStore

TOKEN = "t0k"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ZERO = {"KES", "IDR", "TZS", "UGX", "NGN", "JPY", "KRW", "VND", "CLP", "PKR"}


@pytest.fixture
def client(synced, connectors):
    return TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token=TOKEN))


def concierge_body(oid, offers, status="paid"):
    """Shaped like services/concierge's {shipping_address, order, items} (extra fields included)."""
    addr = {"name": "Wanjiru K", "phone_e164": "+254700000001", "line1": "Moi Ave 5", "line2": None,
            "city": "Nairobi", "region": None, "postal_code": None, "country_code": "KE"}
    return {
        "shipping_address": addr,
        "order": {"id": str(oid), "customer_id": None, "status": status, "currency": "KES", "subtotal": 3600,
                  "shipping": 0, "tax": 0, "total": 3600, "total_usd": 27.9, "payment_provider": "mock",
                  "payment_ref": "ref", "channel": "whatsapp", "shipping_address": addr,
                  "created_at": "2026-11-05T10:00:00Z"},
        "items": [{"order_id": str(oid), "offer_id": str(o.id), "product_id": str(uuid.uuid4()), "qty": 2,
                   "unit_price": 1800, "unit_cost_usd": 0.01, "title": "tampered"} for o in offers],
    }


# --- (1) posted order snapshot ---------------------------------------------------------

def test_unknown_order_is_adopted_from_snapshot_and_forwarded(client, synced):
    oid = uuid.uuid4()
    earbuds = synced.find_offer("cj", "CJ-EAR-001")
    amazon = synced.find_offer("amazon", "B0MOCKUS01")
    r = client.post(f"/orders/{oid}/forward", json=concierge_body(oid, [earbuds, amazon]), headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order_status"] == "forwarded" and len(body["skipped_affiliate_items"]) == 1
    assert Decimal(body["groups"][0]["cost_usd"]) == Decimal("20.00")  # (6.80+3.20)*2 from OUR offer
    items = {i.external_id: i for i in synced.get_order_items(oid)}
    assert items["CJ-EAR-001"].unit_cost_usd == Decimal("6.80")      # not the posted 0.01
    assert items["CJ-EAR-001"].product_id == earbuds.product_id      # not the posted product_id
    assert items["B0MOCKUS01"].unit_cost_usd is None
    order = synced.get_order(oid)
    assert order.currency == "KES" and order.shipping_address["phone"] == "+254700000001"


@pytest.mark.parametrize("mutate,code,msg", [
    (lambda b, oid: b["order"].update(id=str(uuid.uuid4())), 422, "does not match"),
    (lambda b, oid: b["items"][0].update(offer_id=str(uuid.uuid4())), 422, "unknown offer"),
    (lambda b, oid: b.update(items=[]), 422, "items are required"),
    (lambda b, oid: b["items"][0].update(qty=0), 422, None),
    (lambda b, oid: b["order"].update(status="paid_probably"), 422, None),
    (lambda b, oid: b["order"].update(status="pending_payment"), 409, "only paid"),
])
def test_snapshot_validation(client, synced, mutate, code, msg):
    oid = uuid.uuid4()
    body = concierge_body(oid, [synced.find_offer("cj", "CJ-EAR-001")])
    mutate(body, oid)
    r = client.post(f"/orders/{oid}/forward", json=body, headers=AUTH)
    assert r.status_code == code, r.text
    if msg:
        assert msg in r.text
    assert synced.list_supplier_orders(oid) == []


def test_known_order_ignores_posted_snapshot(client, synced):
    oid = uuid.uuid4()
    synced.add_order(oid, "pending_payment", "USD", [{"offer_id": synced.find_offer("cj", "CJ-EAR-001").id,
                                                       "qty": 1, "unit_price": "13.99"}])
    r = client.post(f"/orders/{oid}/forward", json=concierge_body(oid, [synced.find_offer("cj", "CJ-EAR-001")]),
                    headers=AUTH)
    assert r.status_code == 409  # stored status wins over the posted "paid"
    assert synced.get_order(oid).status == "pending_payment"


def test_snapshot_needs_auth(client, synced):
    oid = uuid.uuid4()
    r = client.post(f"/orders/{oid}/forward", json=concierge_body(oid, [synced.find_offer("cj", "CJ-EAR-001")]))
    assert r.status_code == 401 and synced.get_order(oid) is None


def test_db_backed_store_ignores_snapshot(synced, connectors):
    synced.accepts_order_snapshots = False  # behave like PostgresStore
    client = TestClient(create_app(store=synced, connectors=connectors, store_name="postgres", api_token=TOKEN))
    oid = uuid.uuid4()
    r = client.post(f"/orders/{oid}/forward", json=concierge_body(oid, [synced.find_offer("cj", "CJ-EAR-001")]),
                    headers=AUTH)
    assert r.status_code == 404 and synced.get_order(oid) is None


# --- (2) display decimals --------------------------------------------------------------

def test_zero_decimal_set_and_reference_data():
    assert ZERO_DECIMAL_CURRENCIES == ZERO
    assert all(default_decimals(c) == 0 for c in ZERO)
    assert default_decimals("usd") == 2 and default_decimals("KWD") == 3
    decimals = {c["code"]: c["decimals"] for c in load_fixture("reference")["currencies"]}
    assert {c for c, d in decimals.items() if d == 0} == ZERO


def test_unknown_currency_row_falls_back_to_display_decimals():
    store = MemoryStore(reference={"currencies": []})
    assert store.get_currency_decimals("VND") == 0 and store.get_currency_decimals("EUR") == 2


@pytest.mark.parametrize("country", ["KE", "ID", "TZ", "UG", "NG", "JP", "KR", "VN", "CL", "PK"])
@pytest.mark.parametrize("offer", [("cj", "CJ-EAR-001"), ("noon", "NN-AE-903"), ("jumia", "JM-NG-801")])
def test_zero_decimal_prices_are_whole_numbers(client, synced, country, offer):
    oid = synced.find_offer(*offer).id
    r = client.get(f"/offers/{oid}/price?country={country}")
    assert r.status_code == 200
    raw = json.loads(r.text)
    assert raw["currency"] in ZERO
    assert isinstance(raw["price"], int), raw  # serialized as 2192, never 2191.71 or 2192.0
    assert '"price":' + str(raw["price"]) + "," in r.text.replace(" ", "")


def test_affiliate_kes_example_rounds_to_whole_shillings(client, synced):
    # NN-AE-903: AED 149 -> 40.57 USD; 40.57 * 129 = 5233.53 -> KES 5234 (half-up, whole units)
    oid = synced.find_offer("noon", "NN-AE-903").id
    assert client.get(f"/offers/{oid}/price?country=KE").json()["price"] == 5234
