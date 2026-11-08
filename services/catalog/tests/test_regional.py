"""Regional leaders (Mercado Libre, Shopee, Lazada, Rakuten Ichiba, Coupang) against httpx.MockTransport."""
import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest

from zakka_catalog.connectors import NotConfirmedError, NotSupportedError, get_connector
from zakka_catalog.connectors.regional import coupang_authorization, shopee_authorization

KEYS = {
    "mercadolibre": {"MERCADOLIBRE_AFFILIATE_ID": "ml"},
    "shopee": {"SHOPEE_APP_ID": "123", "SHOPEE_SECRET": "sec"},
    "lazada": {"LAZADA_FEED_URLS": "MY=https://feeds.lazada.example/my.csv"},
    "rakuten_ichiba": {"RAKUTEN_APP_ID": "app", "RAKUTEN_AFFILIATE_ID": "aff"},
    "coupang": {"COUPANG_ACCESS_KEY": "ak", "COUPANG_SECRET_KEY": "sk"},
}


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("code", sorted(KEYS))
def test_regional_sources_gate_on_their_keys(code):
    assert get_connector(code, env={}).mock
    assert not get_connector(code, env=KEYS[code]).mock
    assert get_connector(code, env={}).kind == "affiliate"


def test_mock_fixtures_fill_the_regional_gaps():
    countries = set()
    for code in KEYS:
        countries |= {c for p in get_connector(code, env={}).fetch_products(1).items for c in p.ships_to}
    assert {"AR", "BR", "MX", "CO", "CL", "PE", "MY", "SG", "TH", "VN", "ID", "PH", "TW", "JP", "KR"} <= countries


def test_rakuten_ichiba_item_search():
    seen = {}

    def handler(request):
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"count": 1, "page": 1, "hits": 1, "Items": [{
            "itemName": "抹茶 100g", "itemCode": "shop-a:10001", "itemPrice": 2480, "itemUrl": "https://item.rakuten.co.jp/x",
            "affiliateUrl": "https://hb.afl.rakuten.co.jp/hgc/x", "mediumImageUrls": ["https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128"],
            "itemCaption": "宇治の抹茶", "shopName": "宇治茶店", "reviewAverage": 4.6, "reviewCount": 88, "postageFlag": 0,
            "affiliateRate": 4.0, "genreId": "100227"}]})

    c = get_connector("rakuten_ichiba", env={**KEYS["rakuten_ichiba"], "RAKUTEN_ACCESS_KEY": "ak"}, http=client(handler))
    p = c.fetch_live("抹茶", "JP", 10)[0]
    assert seen["params"]["applicationId"] == "app" and seen["params"]["affiliateId"] == "aff"
    assert seen["params"]["formatVersion"] == "2" and seen["params"]["accessKey"] == "ak"
    assert p.external_id == "shop-a:10001" and p.list_price == Decimal("2480") and p.currency == "JPY"
    assert p.url.startswith("https://hb.afl.rakuten.co.jp/") and p.commission_rate == Decimal("0.04")
    assert p.image_urls == ["https://thumbnail.image.rakuten.co.jp/a.jpg"] and p.locale == "ja"
    assert c.fetch_live("matcha", "US", 5) == []  # Japan only


def test_coupang_signature_and_search():
    now = datetime(2026, 11, 7, 9, 30, 0, tzinfo=timezone.utc)
    auth = coupang_authorization("ak", "sk", "GET", "/v2/x", "keyword=a&limit=1", now)
    expected = hmac.new(b"sk", b"261107T093000ZGET/v2/xkeyword=a&limit=1", hashlib.sha256).hexdigest()
    assert auth == f"CEA algorithm=HmacSHA256, access-key=ak, signed-date=261107T093000Z, signature={expected}"

    def handler(request):
        assert request.headers["Authorization"].startswith("CEA algorithm=HmacSHA256, access-key=ak")
        assert request.url.path.endswith("/openapi/products/search")
        return httpx.Response(200, json={"rCode": "0", "rMessage": "", "data": {"productData": [
            {"productId": 7, "productName": "에어프라이어", "productPrice": 89000, "productImage": "https://img/7.jpg",
             "productUrl": "https://link.coupang.com/a/x", "isRocket": True, "isFreeShipping": True, "categoryName": "주방가전"}]}})

    p = get_connector("coupang", env=KEYS["coupang"], http=client(handler)).fetch_live("에어프라이어", "KR", 5)[0]
    assert p.external_id == "7" and p.list_price == Decimal("89000") and p.delivery_days_max == 1 and p.shipping == 0


def test_coupang_error_code_in_body_is_an_error():
    c = get_connector("coupang", env=KEYS["coupang"], http=client(lambda r: httpx.Response(200, json={"rCode": "400", "rMessage": "bad"})))
    with pytest.raises(Exception, match="400"):
        c.fetch_live("x", "KR", 5)


def test_shopee_graphql_signed_request():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"data": {"productOfferV2": {"nodes": [
            {"itemId": 55, "productName": "Baju Kurung", "priceMin": "89.00", "imageUrl": "https://cf.shopee.example/1.jpg",
             "offerLink": "https://s.shopee.com.my/abc", "commissionRate": "0.08", "shopName": "Kedai", "ratingStar": "4.8", "sales": 1200}],
            "pageInfo": {"page": 1, "limit": 20, "hasNextPage": False}}}})

    c = get_connector("shopee", env={**KEYS["shopee"], "SHOPEE_COUNTRIES": "MY,PH"}, http=client(handler))
    p = c.fetch_live("baju kurung", "MY", 20)[0]
    assert seen["url"] == "https://open-api.affiliate.shopee.com.my/graphql"
    ts = seen["auth"].split("Timestamp=")[1].split(",")[0]
    assert seen["auth"] == shopee_authorization("123", "sec", seen["body"], int(ts))  # signs the exact body sent
    assert json.loads(seen["body"])["variables"]["keyword"] == "baju kurung"
    assert p.external_id == "MY:55" and p.currency == "MYR" and p.commission_rate == Decimal("0.08")
    assert c.fetch_live("x", "TH", 5) == []  # not an approved country for this account


def test_lazada_reads_country_datafeeds():
    feed = "sku_id,product_name,sale_price,promotion_link,image_url,brand,category\n" \
           "99,Rice Cooker,129.00,https://c.lazada.com.my/t/x,https://img/99.jpg,Kukus,Kitchen\n"
    c = get_connector("lazada", env=KEYS["lazada"], http=client(lambda r: httpx.Response(200, content=feed.encode())))
    page = c.fetch_products(1)
    p = page.items[0]
    assert p.external_id == "MY:99" and p.currency == "MYR" and p.ships_to == ["MY"] and page.next_page is None
    with pytest.raises(NotSupportedError):
        c.fetch_live("rice cooker", "MY", 5)


def test_mercadolibre_refuses_to_guess_without_a_confirmed_api():
    c = get_connector("mercadolibre", env=KEYS["mercadolibre"])
    with pytest.raises(NotConfirmedError):
        c.fetch_products(1)
    with pytest.raises(NotConfirmedError):
        c.fetch_live("tenis", "BR", 5)
