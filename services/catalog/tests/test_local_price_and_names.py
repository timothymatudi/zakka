import re
from decimal import Decimal as D

import pytest

from zakka_catalog.connectors import all_connectors
from zakka_catalog.pricing import OfferPricingInput, quote
from zakka_catalog.sync import _PARTNER_RE, customer_copy, scrub_partner_names
from zakka_catalog.models import SourceProduct


def aff(list_usd, ship_usd="0", local=None, cur=None, ship_local=None):
    return OfferPricingInput(kind="affiliate", cost_usd=None, list_price_usd=D(list_usd), shipping_usd=D(ship_usd),
                             list_price_local=D(local) if local is not None else None, list_currency=cur,
                             shipping_local=D(ship_local) if ship_local is not None else None)


# --- exact local prices (migration 0006) -------------------------------------------

def test_ngn_61000_shows_exactly_in_nigeria():
    off = aff("39.35", local="61000", cur="NGN")  # 61000 / 1550 = 39.354.. stored as 39.35
    assert quote(off, currency="NGN", fx_rate=D("1550"), decimals=0).price == D("61000")
    # without the local price the USD round trip drifts
    assert quote(aff("39.35"), currency="NGN", fx_rate=D("1550"), decimals=0).price == D("60993")


def test_other_currencies_still_convert_from_usd():
    off = aff("39.35", local="61000", cur="NGN")
    assert quote(off, currency="KES", fx_rate=D("129"), decimals=0).price == D("5076")
    assert quote(off).price == D("39.35")  # USD shopper


def test_local_price_plus_local_shipping_is_exact():
    off = aff("37.74", "1.61", local="58500", cur="ngn ", ship_local="2500")
    assert quote(off, currency="NGN", fx_rate=D("1550"), decimals=0).price == D("61000")
    # legacy rows without shipping_local fall back to converting shipping_usd
    off = aff("37.74", "1.61", local="58500", cur="NGN")
    assert quote(off, currency="NGN", fx_rate=D("1550"), decimals=0).price == D("60996")


def test_dropship_ignores_local_fields():
    off = OfferPricingInput(kind="dropship", cost_usd=D("10"), list_price_usd=None, shipping_usd=D("0"),
                            list_price_local=D("1"), list_currency="USD")
    assert quote(off).price == D("10.99")


def test_sync_stores_partner_currency_price(synced):
    fan = synced.find_offer("jumia", "JM-NG-801")
    assert (fan.list_price_local, fan.shipping_local, fan.list_currency) == (D("58500.00"), D("2500.00"), "NGN")
    assert fan.list_price_usd == D("37.74")  # USD kept too
    us = synced.find_offer("amazon", "B0MOCKUS01")
    assert (us.list_price_local, us.list_currency) == (D("24.99"), "USD")
    cj = synced.find_offer("cj", "CJ-EAR-001")
    assert cj.list_price_local is None and cj.list_currency is None and cj.shipping_local is None


def test_api_shows_exact_local_price(synced):
    from fastapi.testclient import TestClient
    from zakka_catalog.api import create_app

    c = TestClient(create_app(store=synced, connectors={}, store_name="memory", api_token="x"))
    fan = synced.find_offer("jumia", "JM-NG-801")  # NGN 58,500 + NGN 2,500 shipping
    assert c.get(f"/offers/{fan.id}/price?country=NG").json()["price"] == 61000
    cooker = synced.find_offer("jumia", "JM-KE-802")  # KES 4,999 + KES 250 shipping
    assert c.get(f"/offers/{cooker.id}/price?country=KE").json()["price"] == 5249
    headset = synced.find_offer("noon", "NN-AE-903")  # AED 149, free shipping
    assert c.get(f"/offers/{headset.id}/price?country=AE").json()["price"] == 149


# --- no partner names in customer-facing text ------------------------------------------

@pytest.mark.parametrize("raw,clean", [
    ("Amazon Basics USB Cable", "Basics USB Cable"),
    ("Earbuds (Shein exclusive)", "Earbuds (exclusive)"),
    ("Earbuds (Shein)", "Earbuds"),
    ("Desk lamp, ships from AliExpress warehouse", "Desk lamp, warehouse"),
    ("Sold on noon.com - Lamp", "Lamp"),
    ("Lamp - Sold on noon.com", "Lamp"),
    ("Lamp | Temu |  Free  shipping", "Lamp | Free shipping"),
    ("Amazon: Bestseller", "Bestseller"),
    ("Mug, by Printful, ceramic", "Mug, ceramic"),
    ("  Temu  ", ""),
    ("Order by noon for same-day dispatch", "Order by noon for same-day dispatch"),  # ordinary word kept
    ("CJ Dropshipping best seller", "best seller"),
    ("Juicy cjelly", "Juicy cjelly"),
])
def test_scrub_partner_names(raw, clean):
    assert scrub_partner_names(raw) == clean


def test_customer_copy_drops_partner_brand():
    sp = SourceProduct(external_id="1", title="Temu Mug", brand="Amazon Basics", bullet_points=["Flipkart Assured", "Ceramic"],
                       description="Great mug from Jumia.")
    c = customer_copy(sp)
    assert c.title == "Mug" and c.brand is None and c.bullet_points == ["Assured", "Ceramic"]
    assert c.description == "Great mug."


def test_title_that_is_only_a_partner_name_is_rejected():
    from zakka_catalog.sync import SyncItemError
    with pytest.raises(SyncItemError):
        customer_copy(SourceProduct(external_id="1", title="Amazon"))


def test_fixture_customer_text_has_no_partner_names():
    for conn in all_connectors(env={}).values():
        for p in conn.fetch_products(1).items:
            for text in [p.title, p.description or "", p.brand or "", *p.bullet_points]:
                assert not _PARTNER_RE.search(text), (conn.code, text)


def test_synced_translations_have_no_partner_names(synced):
    for t in synced.translations.values():
        for text in [t.title, t.description or "", *t.bullet_points]:
            assert not re.search(r"(?i)amazon|aliexpress|temu|shein|jumia|flipkart|printful|spocket", text), text
