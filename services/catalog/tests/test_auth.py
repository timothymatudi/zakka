import logging
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from zakka_catalog.api import bearer_matches, create_app
from zakka_catalog.connectors import get_connector
from zakka_catalog.models import Address

TOKEN = "s3cret-token"


def paid_order(store):
    oid = uuid.uuid4()
    store.add_order(oid, "paid", "USD", [{"offer_id": store.find_offer("cj", "CJ-EAR-001").id, "qty": 1,
                                          "unit_price": "13.99"}],
                    {"name": "A", "phone_e164": "+254700000000", "line1": "1 St", "city": "Nairobi",
                     "country_code": "KE"})
    return oid


@pytest.fixture
def secured(synced, connectors):
    return TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token=TOKEN))


def test_bearer_matches():
    assert bearer_matches(f"Bearer {TOKEN}", TOKEN)
    assert bearer_matches(f"bearer   {TOKEN} ", TOKEN)
    for bad in (None, "", TOKEN, f"Basic {TOKEN}", "Bearer ", "Bearer wrong", f"Bearer {TOKEN}x"):
        assert not bearer_matches(bad, TOKEN)


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nope"}, {"Authorization": f"Basic {TOKEN}"}])
def test_state_changing_routes_require_token(secured, synced, headers):
    oid = paid_order(synced)
    for path in (f"/orders/{oid}/forward", "/tracking/poll", f"/orders/{uuid.uuid4()}/forward"):
        r = secured.post(path, headers=headers)
        assert r.status_code == 401, path  # auth is checked before the order lookup
        assert r.headers["www-authenticate"] == "Bearer"
    assert synced.get_order(oid).status == "paid"
    assert synced.list_supplier_orders(oid) == []


def test_valid_token_allows_writes(secured, synced):
    oid = paid_order(synced)
    auth = {"Authorization": f"Bearer {TOKEN}"}
    assert secured.post(f"/orders/{oid}/forward", headers=auth).json()["order_status"] == "forwarded"
    assert secured.post("/tracking/poll", headers=auth).status_code == 200
    assert secured.get("/health").json()["write_auth"] == "bearer"


def test_read_routes_stay_open_with_token(secured, synced):
    oid = str(synced.find_offer("cj", "CJ-EAR-001").id)
    assert secured.get(f"/offers/{oid}/price?country=US").status_code == 200
    assert secured.post("/prices", json={"country": "US", "offer_ids": [oid]}).status_code == 200
    assert secured.get("/health").status_code == 200


def test_no_token_open_only_in_mock_mode_with_warning(synced, connectors, caplog):
    client = TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token=""))
    assert client.get("/health").json()["write_auth"] == "open-mock-mode"
    with caplog.at_level(logging.WARNING, logger="zakka_catalog.api"):
        r = client.post(f"/orders/{paid_order(synced)}/forward")
    assert r.status_code == 200
    assert any("CATALOG_API_TOKEN is empty" in m for m in caplog.messages)


def test_no_token_with_live_dropship_connector_disables_writes(synced, connectors):
    live = dict(connectors)
    live["printful"] = get_connector("printful", env={"PRINTFUL_API_TOKEN": "t"},
                                     http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    client = TestClient(create_app(store=synced, connectors=live, store_name="memory", api_token=""))
    oid = paid_order(synced)
    assert client.post(f"/orders/{oid}/forward").status_code == 503
    assert client.post("/tracking/poll").status_code == 503
    assert synced.get_order(oid).status == "paid"
    offer = str(synced.find_offer("cj", "CJ-EAR-001").id)
    assert client.get(f"/offers/{offer}/price?country=US").status_code == 200
    assert client.get("/health").json()["write_auth"] == "disabled"


def test_token_read_from_env(synced, connectors, monkeypatch):
    monkeypatch.setenv("CATALOG_API_TOKEN", TOKEN)
    client = TestClient(create_app(store=synced, connectors=connectors, store_name="memory"))
    assert client.post("/tracking/poll").status_code == 401
    assert client.post("/tracking/poll", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200


def test_shipping_address_shape_from_migration_0005(synced, connectors):
    a = Address.model_validate({"name": "A", "phone_e164": "+254700000000", "line1": "1 St", "line2": None,
                                "city": "Nairobi", "region": None, "postal_code": None, "country_code": "KE"})
    assert a.phone == "+254700000000"
    seen = {}
    orig = connectors["cj"].place_order

    def spy(req):
        seen["addr"] = req.address
        return orig(req)

    connectors["cj"].place_order = spy
    client = TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token=TOKEN))
    oid = paid_order(synced)
    client.post(f"/orders/{oid}/forward", headers={"Authorization": f"Bearer {TOKEN}"})
    assert seen["addr"].phone == "+254700000000" and seen["addr"].country_code == "KE"
