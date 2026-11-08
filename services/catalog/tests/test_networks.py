"""Worldwide network sources (eBay, Awin, Impact, Rakuten Advertising, Admitad) against httpx.MockTransport."""
import gzip
import json
from decimal import Decimal

import httpx
import pytest

from zakka_catalog.connectors import NotSupportedError, get_connector
from zakka_catalog.connectors.networks import EBAY_SITES

NETWORKS = {
    "ebay": {"EBAY_CLIENT_ID": "cid", "EBAY_CLIENT_SECRET": "sec", "EBAY_CAMPAIGN_ID": "5338000000"},
    "awin": {"AWIN_PUBLISHER_ID": "123", "AWIN_FEED_KEY": "fk"},
    "impact": {"IMPACT_ACCOUNT_SID": "IRabc", "IMPACT_AUTH_TOKEN": "tok"},
    "rakuten": {"RAKUTEN_ADV_TOKEN": "rt"},
    "admitad": {"ADMITAD_CLIENT_ID": "aid", "ADMITAD_CLIENT_SECRET": "asec", "ADMITAD_WEBSITE_ID": "77"},
    "cj_affiliate": {"CJ_AFFILIATE_TOKEN": "pat", "CJ_AFFILIATE_COMPANY_ID": "7000001", "CJ_AFFILIATE_WEBSITE_ID": "100200"},
}


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("code", sorted(NETWORKS))
def test_networks_are_affiliate_and_need_every_key(code):
    env = NETWORKS[code]
    assert get_connector(code, env={}).mock
    assert not get_connector(code, env=env).mock
    for k in env:  # any one missing key keeps the source in mock mode
        assert get_connector(code, env={**env, k: ""}).mock
    assert get_connector(code, env={}).kind == "affiliate"


def test_mock_fixtures_cover_regions_without_other_sources():
    countries = set()
    for code in NETWORKS:
        for p in get_connector(code, env={}).fetch_products(1).items:
            countries |= set(p.ships_to)
            assert p.attributes.get("merchant")  # retailer inside the network, internal only
    assert {"BR", "MX", "JP", "PL", "TR", "SE", "AU", "CA", "ID"} <= countries


# --- eBay -----------------------------------------------------------------------------------------------

def test_ebay_search_sends_affiliate_context_and_parses_items():
    seen = {}

    def handler(request: httpx.Request):
        if request.url.path == "/identity/v1/oauth2/token":
            seen["token_auth"] = request.headers["Authorization"]
            seen["token_body"] = request.content.decode()
            return httpx.Response(200, json={"access_token": "app-tok", "expires_in": 7200, "token_type": "Application Access Token"})
        assert request.url.path == "/buy/browse/v1/item_summary/search"
        assert request.headers["Authorization"] == "Bearer app-tok"
        seen["site"] = request.headers["X-EBAY-C-MARKETPLACE-ID"]
        seen["ctx"] = request.headers["X-EBAY-C-ENDUSERCTX"]
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"total": 1, "itemSummaries": [{
            "itemId": "v1|123|0", "title": "Desk Lamp", "price": {"value": "19.99", "currency": "USD"},
            "image": {"imageUrl": "https://i.ebayimg.example/1.jpg"},
            "additionalImages": [{"imageUrl": "https://i.ebayimg.example/2.jpg"}],
            "itemWebUrl": "https://www.ebay.com/itm/123",
            "itemAffiliateWebUrl": "https://www.ebay.com/itm/123?mkcid=1&campid=5338000000",
            "itemLocation": {"country": "US"}, "condition": "New",
            "categories": [{"categoryName": "Home & Garden"}, {"categoryName": "Lamps"}],
            "shippingOptions": [{"shippingCost": {"value": "4.50", "currency": "USD"}}]}]})

    c = get_connector("ebay", env=NETWORKS["ebay"], http=client(handler))
    items = c.fetch_live("desk lamp", "KE", 10)
    assert seen["token_auth"].startswith("Basic ") and "grant_type=client_credentials" in seen["token_body"]
    assert seen["site"] == "EBAY_US"  # Kenya has no eBay site: US site, filtered to items that ship to KE
    assert "deliveryCountry:KE" in seen["params"]["filter"] and "conditions:{NEW}" in seen["params"]["filter"]
    assert "affiliateCampaignId=5338000000" in seen["ctx"] and "contextualLocation=country%3DKE" in seen["ctx"]
    p = items[0]
    assert p.external_id == "v1|123|0" and p.list_price == Decimal("19.99") and p.shipping == Decimal("4.50")
    assert "campid=5338000000" in p.url and p.ships_to == ["KE"] and p.ships_from == "US"
    assert p.image_urls == ["https://i.ebayimg.example/2.jpg"][:0] + ["https://i.ebayimg.example/1.jpg", "https://i.ebayimg.example/2.jpg"]
    assert p.category_hint == "Home & Garden > Lamps"


def test_ebay_local_site_for_countries_with_their_own_ebay():
    assert EBAY_SITES["DE"] == "EBAY_DE" and EBAY_SITES["AU"] == "EBAY_AU"
    seen = []

    def handler(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 7200})
        seen.append(request.headers["X-EBAY-C-MARKETPLACE-ID"])
        return httpx.Response(200, json={"total": 0, "itemSummaries": []})

    c = get_connector("ebay", env=NETWORKS["ebay"], http=client(handler))
    c.fetch_live("bohrmaschine", "DE", 5)
    c.fetch_live("drill", "AU", 5)
    assert seen == ["EBAY_DE", "EBAY_AU"]


def test_ebay_catalogue_import_pages_over_sites_and_seed_queries():
    def handler(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 7200})
        return httpx.Response(200, json={"total": 0, "itemSummaries": []})

    env = {**NETWORKS["ebay"], "EBAY_MARKETPLACES": "EBAY_US,EBAY_GB", "EBAY_SEED_QUERIES": "lamp,kettle"}
    c = get_connector("ebay", env=env, http=client(handler))
    pages, page = 0, 1
    while page:
        page = c.fetch_products(page).next_page
        pages += 1
    assert pages == 4  # 2 sites x 2 queries


# --- Awin ----------------------------------------------------------------------------------------------

def test_awin_reads_joined_feeds_from_the_feed_list():
    feed_list = ("Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,URL\n"
                 "11,Shop DE,DE,active,901,Main,de,https://productdata.awin.example/feed/901.csv.gz\n"
                 "12,Not Joined,FR,notjoined,902,Main,fr,https://productdata.awin.example/feed/902.csv.gz\n")
    feed = ("aw_product_id,product_name,aw_deep_link,merchant_image_url,search_price,currency,delivery_cost,ean,brand_name,in_stock,merchant_category\n"
            "5001,Wasserkocher,https://www.awin1.example/pclick.php?p=5001,https://img.example/5001.jpg,29.99,EUR,0,4000000000017,Kochwerk,1,Küche\n")

    def handler(request):
        if request.url.path.endswith("/feedList"):
            assert "/publisher/123/fk/" in request.url.path
            return httpx.Response(200, content=feed_list.encode())
        if request.url.path.endswith("901.csv.gz"):
            return httpx.Response(200, content=gzip.compress(feed.encode()))
        return httpx.Response(404)

    c = get_connector("awin", env=NETWORKS["awin"], http=client(handler))
    page = c.fetch_products(1)
    assert page.next_page is None  # only the joined feed counts
    p = page.items[0]
    assert p.external_id == "901:5001" and p.list_price == Decimal("29.99") and p.currency == "EUR"
    assert p.ships_to == ["DE"] and p.gtin == "4000000000017" and p.attributes["merchant"] == "Shop DE"
    with pytest.raises(NotSupportedError):
        c.fetch_live("lamp", "DE", 5)
    assert c.supports_live_search is False and c.supports_single_lookup is False


# --- Impact ---------------------------------------------------------------------------------------------

def test_impact_item_search_uses_basic_auth():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["Authorization"]
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"Items": [{
            "CatalogItemId": "SKU-9", "Name": "Trail Shoes", "Url": "https://goto.example/c/1/2/3",
            "ImageUrl": "https://img.example/9.jpg", "CurrentPrice": "89.00", "Currency": "USD",
            "Manufacturer": "Peak", "Gtin": "0000000000093", "Category": "Shoes", "ShippingRate": "5.00",
            "StockAvailability": "InStock", "CampaignName": "Peak Outdoors"}]})

    c = get_connector("impact", env=NETWORKS["impact"], http=client(handler))
    p = c.fetch_live("trail shoes", "US", 10)[0]
    assert seen["auth"].startswith("Basic ") and seen["path"] == "/Mediapartners/IRabc/Catalogs/ItemSearch"
    assert seen["params"]["Keyword"] == "trail shoes"
    assert p.external_id == "SKU-9" and p.list_price == Decimal("89.00") and p.shipping == Decimal("5.00")
    assert p.brand == "Peak" and p.attributes["merchant"] == "Peak Outdoors"


def test_impact_catalog_import_follows_next_page():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        if request.url.path.endswith("/Catalogs"):
            return httpx.Response(200, json={"Catalogs": [{"Id": "55", "AdvertiserName": "Brand", "Currency": "USD",
                                                            "ItemsUri": "/Mediapartners/IRabc/Catalogs/55/Items"}]})
        if request.url.params.get("Page") == "2":
            return httpx.Response(200, json={"Items": [{"Id": "2", "Name": "B", "Url": "https://u/2", "CurrentPrice": "2"}]})
        return httpx.Response(200, json={"Items": [{"Id": "1", "Name": "A", "Url": "https://u/1", "CurrentPrice": "1"}],
                                         "@nextpageuri": "/Mediapartners/IRabc/Catalogs/55/Items?Page=2"})

    c = get_connector("impact", env=NETWORKS["impact"], http=client(handler))
    page = c.fetch_products(1)
    assert [p.external_id for p in page.items] == ["1", "2"] and page.next_page is None


# --- Rakuten Advertising -----------------------------------------------------------------------------------

def test_rakuten_product_search_parses_xml():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<result><TotalMatches>1</TotalMatches><TotalPages>1</TotalPages><PageNumber>1</PageNumber>
<item><mid>38605</mid><merchantname>Store US</merchantname><linkid>777</linkid><sku>SC-1</sku>
<productname>Cashmere Scarf</productname><category><primary>Accessories</primary><secondary>Scarves</secondary></category>
<price currency="USD">99.00</price><saleprice currency="USD">79.00</saleprice><upccode>012345678905</upccode>
<description><short>Soft</short><long>Very soft scarf</long></description>
<linkurl>https://click.linksynergy.example/link?id=x&amp;offerid=777</linkurl><imageurl>https://img.example/s.jpg</imageurl></item>
</result>"""
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["Authorization"]
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, content=xml.encode(), headers={"Content-Type": "application/xml"})

    c = get_connector("rakuten", env=NETWORKS["rakuten"], http=client(handler))
    p = c.fetch_live("scarf", "US", 10)[0]
    assert seen["auth"] == "Bearer rt" and seen["params"]["keyword"] == "scarf"
    assert p.external_id == "38605:777" and p.list_price == Decimal("79.00")  # sale price wins
    assert p.description == "Very soft scarf" and p.gtin == "012345678905" and p.attributes["merchant"] == "Store US"
    assert p.category_hint == "Accessories > Scarves"


# --- Admitad --------------------------------------------------------------------------------------------

def test_admitad_lists_joined_programs_and_reads_their_feeds():
    feed = 'id;name;price;currencyId;url;picture;vendor;available;category\n' \
           'A1;Tênis Corrida;249.90;BRL;https://ad.admitad.example/g/1/?ulp=x;https://img.example/a1.jpg;Veloz;true;Calçados\n'
    seen = {}

    def handler(request):
        if request.url.path == "/token/":
            seen["token"] = request.content.decode()
            return httpx.Response(200, json={"access_token": "adm", "expires_in": 3600, "token_type": "bearer"})
        if request.url.path == "/advcampaigns/website/77/":
            assert request.headers["Authorization"] == "Bearer adm"
            return httpx.Response(200, json={"_meta": {"count": 2}, "results": [
                {"id": 101, "name": "Loja BR", "show_products_links": True, "currency": "BRL",
                 "regions": [{"region": "BR"}],
                 "feeds_info": [{"name": "Main", "csv_link": "https://export.admitad.example/101.csv"}]},
                {"id": 102, "name": "No feed", "show_products_links": False, "regions": [{"region": "MX"}]}]})
        if request.url.path == "/101.csv":
            return httpx.Response(200, content=feed.encode())
        return httpx.Response(404)

    c = get_connector("admitad", env=NETWORKS["admitad"], http=client(handler))
    page = c.fetch_products(1)
    assert "grant_type=client_credentials" in seen["token"] and "advcampaigns_for_website" in seen["token"]
    assert page.next_page is None  # the program without feed links is skipped
    p = page.items[0]
    assert p.external_id == "101:A1" and p.list_price == Decimal("249.90") and p.currency == "BRL"
    assert p.ships_to == ["BR"] and p.brand == "Veloz" and p.attributes["merchant"] == "Loja BR"


def test_feed_networks_are_skipped_by_live_search():
    from zakka_catalog.scale.live import LiveAffiliateSearch
    connectors = {code: get_connector(code, env={}) for code in ("awin", "admitad", "ebay")}
    _, status = LiveAffiliateSearch(connectors)._collect("lamp", "US", 5, None)
    assert "awin" not in status and "admitad" not in status  # feed-only: no live call, no error
    assert status["ebay"] == "live"


def test_ebay_token_is_cached():
    tokens = []

    def handler(request):
        if request.url.path.endswith("/token"):
            tokens.append(1)
            return httpx.Response(200, json={"access_token": "t", "expires_in": 7200})
        return httpx.Response(200, content=json.dumps({"total": 0, "itemSummaries": []}).encode())

    c = get_connector("ebay", env=NETWORKS["ebay"], http=client(handler))
    c.fetch_live("a", "US", 1)
    c.fetch_live("b", "GB", 1)
    assert len(tokens) == 1


# --- CJ Affiliate ---------------------------------------------------------------------------------------

def test_cj_affiliate_graphql_search_uses_tracked_links_only():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"products": {"totalCount": 2, "count": 2, "resultList": [
            {"id": "SKU1", "title": "Robot Vacuum", "brand": "Clean", "advertiserId": "1001", "advertiserName": "Retailer US",
             "advertiserCountry": "US", "imageLink": "https://img.example/1.jpg", "additionalImageLink": ["https://img.example/1b.jpg"],
             "price": {"amount": "349.00", "currency": "USD"}, "salePrice": {"amount": "299.00", "currency": "USD"},
             "availability": "IN_STOCK", "gtin": "0000000000017",
             "shipping": [{"price": {"amount": "0", "currency": "USD"}, "country": "US"}, {"country": "CA"}],
             "linkCode": {"clickUrl": "https://www.anrdoezrs.net/click-100200-1"}},
            {"id": "SKU2", "title": "No link", "advertiserId": "1001", "price": {"amount": "10", "currency": "USD"}, "linkCode": None},
        ]}}})

    c = get_connector("cj_affiliate", env=NETWORKS["cj_affiliate"], http=client(handler))
    items = c.fetch_live("robot vacuum", "CA", 10)
    assert seen["auth"] == "Bearer pat"
    v = seen["body"]["variables"]
    assert v["companyId"] == "7000001" and v["pid"] == "100200" and v["keywords"] == ["robot", "vacuum"]
    assert "partnerStatus: JOINED" in seen["body"]["query"]
    assert len(items) == 1  # the item without a tracked click URL is dropped
    p = items[0]
    assert p.external_id == "1001:SKU1" and p.list_price == Decimal("299.00")  # sale price wins
    assert p.url.startswith("https://www.anrdoezrs.net/") and p.ships_to == ["CA", "US"] and p.ships_from == "US"
    assert p.image_urls == ["https://img.example/1.jpg", "https://img.example/1b.jpg"] and p.attributes["merchant"] == "Retailer US"


def test_cj_affiliate_reports_graphql_errors():
    c = get_connector("cj_affiliate", env=NETWORKS["cj_affiliate"],
                      http=client(lambda r: httpx.Response(200, json={"errors": [{"message": "Not authorized"}]})))
    with pytest.raises(Exception, match="Not authorized"):
        c.fetch_live("lamp", "US", 5)
