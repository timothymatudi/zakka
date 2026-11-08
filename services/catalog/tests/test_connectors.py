import json
from decimal import Decimal

import httpx
import pytest

from zakka_catalog.connectors import (
    SOURCE_CODES,
    ConnectorError,
    NotConfirmedError,
    NotSupportedError,
    all_connectors,
    get_connector,
)
from zakka_catalog.connectors.aliexpress import sign_params
from zakka_catalog.connectors.amazon import parse_partner_tags, with_tag
from zakka_catalog.models import Address, SupplierOrderLine, SupplierOrderRequest

EXPECTED = {"cj", "aliexpress_ds", "spocket", "printful", "amazon", "temu", "shein", "aliexpress_aff",
            "jumia", "noon", "flipkart", "ebay", "awin", "impact", "rakuten", "admitad", "cj_affiliate",
            "mercadolibre", "shopee", "lazada", "rakuten_ichiba", "coupang"}
ADDR = Address(name="T", line1="1 St", city="Austin", country_code="US")


def test_registry_matches_contract_codes():
    assert set(SOURCE_CODES) == EXPECTED
    kinds = {c: k.kind for c, k in all_connectors(env={}).items()}
    assert {c for c, k in kinds.items() if k == "dropship"} == {"cj", "aliexpress_ds", "spocket", "printful"}


def test_unknown_code():
    with pytest.raises(ValueError):
        get_connector("walmart", env={})


@pytest.mark.parametrize("code", sorted(EXPECTED))
def test_every_connector_mock_mode_serves_valid_fixtures(code):
    c = get_connector(code, env={})
    assert c.mock and c.missing_keys
    page = c.fetch_products(1)
    assert page.items, code
    ids = [p.external_id for p in page.items]
    assert len(ids) == len(set(ids))
    for p in page.items:
        assert p.ships_to and p.ships_from and len(p.ships_from) == 2
        assert p.delivery_days_min <= p.delivery_days_max
        if c.kind == "dropship":
            assert p.cost is not None and p.url is None
        else:
            assert p.list_price is not None and p.url and p.commission_rate is not None
    assert c.fetch_offer(ids[0]).external_id == ids[0]
    assert c.fetch_offer("nope") is None


def test_fixtures_are_varied():
    allp = [p for c in all_connectors(env={}).values() for p in c.fetch_products(1).items]
    assert len({p.ships_from for p in allp}) >= 8
    assert len({p.currency for p in allp}) >= 5
    assert min(p.delivery_days_min for p in allp) <= 1 and max(p.delivery_days_max for p in allp) >= 20


def test_mock_pagination():
    c = get_connector("cj", env={}, page_size=5)
    total = len(c.fixture["products"])
    pages, page = [], 1
    while page:
        result = c.fetch_products(page)
        pages.append(result)
        page = result.next_page
    assert len(pages) == -(-total // 5) and all(len(p.items) == 5 for p in pages[:-1])
    assert sum(len(p.items) for p in pages) == total


def test_keys_switch_mode():
    assert get_connector("printful", env={"PRINTFUL_API_TOKEN": "x"}).mock is False
    assert get_connector("cj", env={"CJ_API_KEY": ""}).mock is True
    assert get_connector("cj", env={"CJ_API_KEY": "  "}).mock is True
    assert get_connector("cj", env={"CJ_API_KEY": "CJ1@api@k"}).mock is False  # apiKey is the only credential


def test_mock_place_order_and_track_are_deterministic():
    c = get_connector("cj", env={})
    req = SupplierOrderRequest(reference="order-1", address=ADDR,
                               lines=[SupplierOrderLine(external_id="CJ-EAR-001", qty=2)])
    r1, r2 = c.place_order(req), c.place_order(req)
    assert r1.external_order_id == r2.external_order_id and r1.external_order_id.startswith("CJ-MOCK-")
    assert r1.cost_usd == Decimal("20.00")  # (6.80 + 3.20) * 2
    t = c.track(r1.external_order_id)
    assert t.status == "in_transit" and t.carrier == "YunExpress" and t.tracking_number.startswith("YT")
    assert t.tracking_number in t.tracking_url


def test_mock_place_order_validation():
    c = get_connector("cj", env={})
    with pytest.raises(ConnectorError):
        c.place_order(SupplierOrderRequest(reference="x", lines=[SupplierOrderLine(external_id="??", qty=1)]))
    with pytest.raises(ConnectorError):  # CJ-BLD-005 is out of stock
        c.place_order(SupplierOrderRequest(reference="x", lines=[SupplierOrderLine(external_id="CJ-BLD-005", qty=1)]))


def test_affiliates_cannot_order_or_track():
    c = get_connector("amazon", env={})
    with pytest.raises(NotSupportedError):
        c.place_order(SupplierOrderRequest(reference="x", lines=[SupplierOrderLine(external_id="B0MOCKUS01", qty=1)]))
    with pytest.raises(NotSupportedError):
        c.track("x")


@pytest.mark.parametrize("code,env", [
    ("amazon", {"AMAZON_CREATORS_CREDENTIAL_ID": "i", "AMAZON_CREATORS_CREDENTIAL_SECRET": "s"}),
    ("temu", {"TEMU_AFFILIATE_ID": "t"}), ("shein", {"SHEIN_AFFILIATE_ID": "s"}),
    ("jumia", {"JUMIA_AFFILIATE_ID": "j"}), ("noon", {"NOON_AFFILIATE_ID": "n"}),
    ("flipkart", {"FLIPKART_AFFILIATE_ID": "f", "FLIPKART_AFFILIATE_TOKEN": "t"}), ("spocket", {"SPOCKET_API_KEY": "k"}),
])
def test_unconfirmed_live_adapters_refuse_instead_of_guessing(code, env):
    c = get_connector(code, env=env)
    assert not c.mock
    with pytest.raises(NotConfirmedError) as exc:
        c.fetch_products(1)
    assert "confirm" in str(exc.value)


def test_new_credential_env_vars_gate_live_mode():
    ds = {"ALIEXPRESS_DS_APP_KEY": "k", "ALIEXPRESS_DS_APP_SECRET": "s"}
    assert get_connector("aliexpress_ds", env=ds).mock  # access token missing -> mock
    assert not get_connector("aliexpress_ds", env={**ds, "ALIEXPRESS_DS_ACCESS_TOKEN": "t"}).mock
    aff = {"ALIEXPRESS_AFF_APP_KEY": "k", "ALIEXPRESS_AFF_TRACKING_ID": "t"}
    assert get_connector("aliexpress_aff", env=aff).mock  # app secret missing -> mock
    assert not get_connector("aliexpress_aff", env={**aff, "ALIEXPRESS_AFF_APP_SECRET": "s"}).mock
    assert get_connector("flipkart", env={"FLIPKART_AFFILIATE_ID": "i"}).mock
    assert not get_connector("flipkart", env={"FLIPKART_AFFILIATE_ID": "i", "FLIPKART_AFFILIATE_TOKEN": "t"}).mock


def test_aliexpress_ds_live_sends_session_and_refuses_unconfirmed_mapping():
    seen = {}

    def handler(request):
        seen.update(dict(httpx.QueryParams(request.content.decode())))
        return httpx.Response(200, json={"aliexpress_ds_recommend_feed_get_response": {}})

    env = {"ALIEXPRESS_DS_APP_KEY": "k", "ALIEXPRESS_DS_APP_SECRET": "s", "ALIEXPRESS_DS_ACCESS_TOKEN": "tok"}
    c = get_connector("aliexpress_ds", env=env, http=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(NotConfirmedError):
        c.fetch_products(1)
    assert seen["session"] == "tok" and seen["app_key"] == "k" and len(seen["sign"]) == 64


def test_aliexpress_aff_live_products_with_mock_transport():
    def handler(request):
        params = dict(httpx.QueryParams(request.content.decode()))
        assert params["method"] == "aliexpress.affiliate.product.query" and params["tracking_id"] == "trk"
        unsigned = {k: v for k, v in params.items() if k != "sign"}
        assert params["sign"] == sign_params(unsigned, "sec")
        return httpx.Response(200, json={"aliexpress_affiliate_product_query_response": {"resp_result": {
            "result": {"total_record_count": 1, "products": {"product": [
                {"product_id": 42, "product_title": "Lamp", "target_sale_price": "9.90",
                 "target_sale_price_currency": "USD", "commission_rate": "7.0%",
                 "promotion_link": "https://s.click.aliexpress.com/e/_x"}]}}}}})

    env = {"ALIEXPRESS_AFF_APP_KEY": "k", "ALIEXPRESS_AFF_APP_SECRET": "sec", "ALIEXPRESS_AFF_TRACKING_ID": "trk"}
    c = get_connector("aliexpress_aff", env=env, http=httpx.Client(transport=httpx.MockTransport(handler)))
    page = c.fetch_products(1)
    p = page.items[0]
    assert page.next_page is None and p.external_id == "42" and p.list_price == Decimal("9.90")
    assert p.commission_rate == Decimal("0.07") and p.url.startswith("https://s.click.aliexpress.com/")


def test_aliexpress_signature_is_sorted_hmac_sha256():
    import hashlib
    import hmac
    params = {"method": "m", "app_key": "123", "timestamp": "1", "sign": "ignored"}
    expected = hmac.new(b"sec", b"app_key123methodmtimestamp1", hashlib.sha256).hexdigest().upper()
    assert sign_params(params, "sec") == expected


def test_amazon_partner_tags_applied_per_marketplace():
    assert parse_partner_tags("US:zakka-20, AE:zakka-21,bad,IN:") == {"US": "zakka-20", "AE": "zakka-21"}
    assert with_tag("https://www.amazon.com/dp/X?tag=old&th=1", "new") == "https://www.amazon.com/dp/X?th=1&tag=new"
    c = get_connector("amazon", env={"AMAZON_PARTNER_TAGS": "US:zakka-20,AE:zakka-21"})
    urls = {p.external_id: p.url for p in c.fetch_products(1).items}
    assert urls["B0MOCKUS01"].endswith("tag=zakka-20")
    assert urls["B0MOCKAE01"].endswith("tag=zakka-21")
    assert "tag=" not in urls["B0MOCKIN01"]  # no IN tag configured


def test_mock_mode_never_builds_http_client():
    with pytest.raises(ConnectorError):
        get_connector("cj", env={}).http


# --- live adapters exercised against httpx.MockTransport (no network) ----------

def _cj_ok(data):
    return httpx.Response(200, json={"code": 200, "result": True, "success": True, "data": data})


def _cj_handler(calls, sent):
    """Responses shaped like CJ API 2.0 (developers.cjdropshipping.com, checked 2026-11)."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api2.0/v1")
        calls.append((request.method, path))
        if path == "/authentication/getAccessToken":
            sent["auth"] = json.loads(request.content)
            return _cj_ok({"accessToken": "tok", "accessTokenExpiryDate": "2099-01-01T00:00:00+08:00",
                           "refreshToken": "ref", "refreshTokenExpiryDate": "2099-06-01T00:00:00+08:00"})
        assert request.headers["CJ-Access-Token"] == "tok"
        if path == "/product/list":
            return _cj_ok({"pageNum": 1, "pageSize": 200, "total": 1, "list": [
                {"pid": "P1", "productNameEn": "Thing", "sellPrice": "3.50 -- 4.20", "productImage": "https://img/1.jpg",
                 "categoryName": "Home", "productSku": "CJ-1"}]})
        if path == "/product/query":
            assert request.url.params["pid"] == "P1"
            return _cj_ok({"pid": "P1", "productNameEn": "Thing", "bigImage": "https://img/1.jpg",
                           "productImageSet": ["https://img/1.jpg", "https://img/2.jpg"], "description": "<p>Nice</p>",
                           "variants": [{"vid": "V1", "variantSku": "CJ-1-A", "variantSellPrice": 3.5}]})
        if path == "/shopping/order/getOrderDetail":
            if request.url.params["orderId"] == "CJ123":
                return _cj_ok({"orderId": "CJ123", "orderStatus": "SHIPPED", "trackNumber": "YT1",
                               "logisticName": "YunExpress", "trackingUrl": "https://t/YT1"})
            return httpx.Response(200, json={"code": 1600100, "result": False, "message": "not found", "data": None})
        if path == "/logistic/freightCalculate":
            sent["freight"] = json.loads(request.content)
            return _cj_ok([{"logisticName": "CJPacket", "logisticPrice": 4.1, "logisticAging": "7-12"},
                           {"logisticName": "YunExpress", "logisticPrice": "2.9", "logisticAging": "10-20"}])
        if path == "/shopping/order/createOrderV3":
            sent["order"] = json.loads(request.content)
            return _cj_ok({"orderId": "CJ123", "shipmentOrderId": "S9", "orderAmount": 9.1, "orderStatus": "UNPAID"})
        if path == "/shopping/pay/payBalanceV2":
            sent["pay"] = json.loads(request.content)
            return _cj_ok(None)
        return httpx.Response(404, json={"code": 404, "result": False, "message": "no route"})

    return handler


def test_cj_live_products_order_and_track_with_mock_transport():
    calls, sent = [], {}
    c = get_connector("cj", env={"CJ_API_KEY": "CJ1@api@k", "CJ_SANDBOX": "1"},
                      http=httpx.Client(transport=httpx.MockTransport(_cj_handler(calls, sent))))
    assert sent == {}  # nothing happens until the first call
    page = c.fetch_products(1)
    assert sent["auth"] == {"apiKey": "CJ1@api@k"}  # current auth body (email/password is deprecated)
    p = page.items[0]
    assert p.external_id == "P1" and p.cost == Decimal("3.50") and page.next_page is None  # range -> lowest

    detail = c.fetch_detail("P1")
    assert detail.image_urls == ["https://img/1.jpg", "https://img/2.jpg"] and detail.attributes["variants"][0]["vid"] == "V1"

    res = c.place_order(SupplierOrderRequest(reference="o-1", address=ADDR,
                                             lines=[SupplierOrderLine(external_id="P1", qty=2)]))
    assert res.external_order_id == "CJ123" and res.cost_usd == Decimal("9.1")
    order = sent["order"]
    assert order["products"] == [{"vid": "V1", "quantity": 2}]  # single-variant product resolved to its vid
    assert order["logisticName"] == "YunExpress"  # cheapest freight option
    assert order["fromCountryCode"] == "CN" and order["shippingCountryCode"] == ADDR.country_code
    assert order["orderNumber"] == "o-1" and order["isSandbox"] == 1
    assert sent["freight"]["startCountryCode"] == "CN" and sent["freight"]["products"] == [{"vid": "V1", "quantity": 2}]
    assert sent["pay"] == {"shipmentOrderId": "S9"}

    t = c.track("CJ123")
    assert t.status == "in_transit" and t.tracking_number == "YT1" and t.tracking_url == "https://t/YT1"
    assert sum(1 for _, path in calls if path.endswith("getAccessToken")) == 1  # token cached (CJ allows 1 per 5 min)


def test_cj_retry_reuses_existing_order_instead_of_creating_a_second():
    calls, sent = [], {}
    c = get_connector("cj", env={"CJ_API_KEY": "k"}, http=httpx.Client(transport=httpx.MockTransport(_cj_handler(calls, sent))))
    res = c.place_order(SupplierOrderRequest(reference="CJ123", address=ADDR,
                                             lines=[SupplierOrderLine(external_id="P1", qty=1)]))
    assert res.external_order_id == "CJ123" and res.raw["reused"] is True
    assert "order" not in sent and "pay" not in sent  # shipped already: no new order, no payment


def test_cj_multi_variant_product_needs_a_variant():
    def handler(request):
        path = request.url.path.removeprefix("/api2.0/v1")
        if path == "/authentication/getAccessToken":
            return _cj_ok({"accessToken": "tok"})
        if path == "/product/query":
            return _cj_ok({"pid": "P2", "variants": [{"vid": "A"}, {"vid": "B"}]})
        return httpx.Response(200, json={"code": 1600100, "result": False, "message": "not found"})

    c = get_connector("cj", env={"CJ_API_KEY": "k"}, http=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ConnectorError, match="2 variants"):
        c.place_order(SupplierOrderRequest(reference="o-2", address=ADDR, lines=[SupplierOrderLine(external_id="P2", qty=1)]))


def test_live_order_requires_address():
    c = get_connector("printful", env={"PRINTFUL_API_TOKEN": "t"},
                      http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    with pytest.raises(ConnectorError, match="address"):
        c.place_order(SupplierOrderRequest(reference="o", lines=[SupplierOrderLine(external_id="1", qty=1)]))


def test_printful_live_track_with_mock_transport():
    def handler(request):
        assert request.headers["Authorization"] == "Bearer t"
        return httpx.Response(200, json={"result": {"status": "fulfilled", "shipments": [
            {"carrier": "USPS", "tracking_number": "9400", "tracking_url": "https://t/9400"}]}})

    c = get_connector("printful", env={"PRINTFUL_API_TOKEN": "t"},
                      http=httpx.Client(transport=httpx.MockTransport(handler)))
    t = c.track("55")
    assert t.status == "in_transit" and t.tracking_number == "9400"


def test_printful_order_external_id_fits_printful_rules():
    from zakka_catalog.connectors.printful import order_external_id
    eid = order_external_id("d0000000-0000-4000-8000-000000000003")
    assert len(eid) <= 32 and eid.isalnum()


def test_printful_live_order_sends_store_id_and_is_retry_safe():
    seen = {"posts": 0}

    def handler(request):
        assert request.headers["X-PF-Store-Id"] == "42"
        if request.method == "GET" and request.url.path.startswith("/orders/@"):
            if seen["posts"]:
                return httpx.Response(200, json={"result": {"id": 77, "status": "pending", "costs": {"total": "12.40"}}})
            return httpx.Response(404, json={"error": {"message": "Not found"}})
        if request.method == "POST" and request.url.path == "/orders":
            seen["posts"] += 1
            body = json.loads(request.content)
            assert request.url.params["confirm"] == "true" and len(body["external_id"]) <= 32
            assert body["items"] == [{"sync_variant_id": 5, "quantity": 1}]
            return httpx.Response(200, json={"result": {"id": 77, "status": "pending", "costs": {"total": "12.40"}}})
        return httpx.Response(500)

    c = get_connector("printful", env={"PRINTFUL_API_TOKEN": "t", "PRINTFUL_STORE_ID": "42"},
                      http=httpx.Client(transport=httpx.MockTransport(handler)))
    req = SupplierOrderRequest(reference="d0000000-0000-4000-8000-000000000003", address=ADDR,
                               lines=[SupplierOrderLine(external_id="5", qty=1)])
    first, again = c.place_order(req), c.place_order(req)
    assert first.external_order_id == again.external_order_id == "77" and first.cost_usd == Decimal("12.40")
    assert seen["posts"] == 1 and again.raw["reused"] is True  # the retry did not submit a second order
