import uuid

import pytest
from fastapi.testclient import TestClient

from zakka_catalog.api import create_app


@pytest.fixture
def client(synced, connectors):
    return TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token=""))


def offer_id(store, src, ext):
    return str(store.find_offer(src, ext).id)


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["store"] == "memory"
    assert body["connectors"]["cj"] == "mock" and len(body["connectors"]) == 22


def test_price_contract_shape_usd(client, synced):
    r = client.get(f"/offers/{offer_id(synced, 'cj', 'CJ-EAR-001')}/price", params={"country": "US"})
    assert r.status_code == 200
    body = r.json()
    assert {"price", "currency", "price_usd", "delivery_days_min", "delivery_days_max"} <= set(body)
    assert body["price"] == 13.99 and body["currency"] == "USD" and body["price_usd"] == 13.99
    assert (body["delivery_days_min"], body["delivery_days_max"]) == (8, 15)
    assert body["ships_to_country"] is True


def test_price_local_currency(client, synced):
    oid = offer_id(synced, "cj", "CJ-EAR-001")
    ae = client.get(f"/offers/{oid}/price?country=ae").json()
    assert ae["currency"] == "AED" and ae["price"] == 49.99  # 13.50*3.6725 = 49.58 -> 49.99
    ke = client.get(f"/offers/{oid}/price?country=KE").json()
    assert ke["currency"] == "KES" and ke["price"] == 1742  # 13.50*129 = 1741.5 -> whole shillings
    jp = client.get(f"/offers/{oid}/price?country=JP").json()
    assert jp["price"] == 2025


def test_affiliate_price_no_markup(client, synced):
    body = client.get(f"/offers/{offer_id(synced, 'amazon', 'B0MOCKUS01')}/price?country=US").json()
    assert body["price"] == 24.99 and body["kind"] == "affiliate"
    body = client.get(f"/offers/{offer_id(synced, 'amazon', 'B0MOCKUS01')}/price?country=GB").json()
    assert body["ships_to_country"] is False


def test_price_errors(client, synced):
    oid = offer_id(synced, "cj", "CJ-EAR-001")
    assert client.get(f"/offers/{oid}/price?country=ZZ").status_code == 422
    assert client.get(f"/offers/{oid}/price").status_code == 422
    assert client.get(f"/offers/{uuid.uuid4()}/price?country=US").status_code == 404
    assert client.get("/offers/not-a-uuid/price?country=US").status_code == 422
    inactive = offer_id(synced, "cj", "CJ-BLD-005")
    assert client.get(f"/offers/{inactive}/price?country=US").status_code == 410


def test_batch_prices(client, synced):
    ids = [offer_id(synced, "cj", "CJ-EAR-001"), offer_id(synced, "noon", "NN-AE-901"), str(uuid.uuid4())]
    body = client.post("/prices", json={"country": "SA", "offer_ids": ids}).json()
    assert len(body["prices"]) == 2 and list(body["errors"]) == [ids[2]]
    assert {p["currency"] for p in body["prices"]} == {"SAR"}


def test_forward_endpoint(client, synced):
    oid = uuid.uuid4()
    synced.add_order(oid, "paid", "USD", [{"offer_id": synced.find_offer("cj", "CJ-EAR-001").id, "qty": 1,
                                            "unit_price": "13.99"}])
    addr = {"shipping_address": {"name": "A", "line1": "1 St", "city": "Lagos", "country_code": "NG"}}
    r = client.post(f"/orders/{oid}/forward", json=addr)
    assert r.status_code == 200 and r.json()["order_status"] == "forwarded"
    assert client.post(f"/orders/{oid}/forward").json()["groups"][0]["status"] == "already_placed"
    assert client.post(f"/orders/{uuid.uuid4()}/forward").status_code == 404
    pending = uuid.uuid4()
    synced.add_order(pending, "pending_payment", "USD", [])
    assert client.post(f"/orders/{pending}/forward").status_code == 409
    assert client.post("/tracking/poll").json()["updates"][0]["status"] == "shipped"


def test_default_app_falls_back_to_memory_demo_store(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("CATALOG_API_TOKEN", "")
    c = TestClient(create_app())
    assert c.get("/health").json()["store"] == "memory"
