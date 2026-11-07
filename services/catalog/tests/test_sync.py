from datetime import timedelta
from decimal import Decimal

from zakka_catalog.config import PHASE1_LOCALES
from zakka_catalog.connectors import get_connector
from zakka_catalog.enrich import MockEnricher
from zakka_catalog.models import ProductPage, SourceProduct
from zakka_catalog.store import utcnow
from zakka_catalog.sync import sync_source


class ListConnector:
    """Wraps a mock connector but serves a custom item list."""

    def __init__(self, code, items, fail_on_page=None):
        base = get_connector(code, env={})
        self.code, self.kind, self.name, self.mock = base.code, base.kind, base.name, True
        self.items, self.fail_on_page = items, fail_on_page

    def fetch_products(self, page):
        if page == self.fail_on_page:
            raise RuntimeError("upstream 500")
        size = 2
        chunk = self.items[(page - 1) * size: page * size]
        return ProductPage(items=chunk, page=page, next_page=page + 1 if page * size < len(self.items) else None)


def sp(eid, **kw):
    base = dict(external_id=eid, title=f"Item {eid}", cost=Decimal("5"), shipping=Decimal("1"),
                ships_from="CN", ships_to=["US"], delivery_days_min=5, delivery_days_max=9, stock=10)
    base.update(kw)
    return SourceProduct(**base)


def test_sync_all_sources_in_mock_mode(synced):
    offers = synced.list_offers(active_only=False)
    assert len(offers) == 139
    assert all(o.last_synced_at for o in offers)
    # every product has all 10 locales
    for pid in {o.product_id for o in offers}:
        assert synced.translation_locales(pid) == set(PHASE1_LOCALES)
    # display prices computed for every offer
    assert len(synced.display_prices) == 139


def test_gtin_dedupes_across_sources(synced):
    earbuds = [o for o in synced.list_offers() if o.external_id in
               ("CJ-EAR-001", "1005001003", "B0MOCKUS01", "1005002003")]
    assert len(earbuds) == 4
    assert len({o.product_id for o in earbuds}) == 1
    assert {o.kind for o in earbuds} == {"dropship", "affiliate"}


def test_currency_normalised_to_usd(synced):
    fan = synced.find_offer("jumia", "JM-NG-801")
    assert fan.list_price_usd == Decimal("37.74")  # 58500 / 1550
    assert fan.shipping_usd == Decimal("1.61")      # 2500 / 1550
    assert fan.cost_usd is None and fan.url
    kurta = synced.find_offer("amazon", "B0MOCKIN01")
    assert kurta.list_price_usd == Decimal("15.46")  # 1299 / 84


def test_dropship_offer_fields_and_display_price(synced):
    o = synced.find_offer("cj", "CJ-EAR-001")
    assert o.cost_usd == Decimal("6.80") and o.list_price_usd is None and o.url is None
    assert synced.display_prices[o.id] == Decimal("13.99")  # electronics rule inherited by headphones


def test_out_of_stock_is_inactive(synced):
    assert synced.find_offer("cj", "CJ-BLD-005").is_active is False


def test_stale_offers_marked_inactive_only_after_complete_run(store):
    items = [sp("A"), sp("B"), sp("C")]
    r1 = sync_source(store, ListConnector("cj", items), MockEnricher(), now=utcnow() - timedelta(hours=1))
    assert r1.complete and r1.offers_upserted == 3 and r1.pages == 2
    # partial run never deactivates
    r2 = sync_source(store, ListConnector("cj", items[:1]), MockEnricher(), max_pages=0)
    assert not r2.complete and r2.stale_deactivated == 0
    # failing run never deactivates
    r3 = sync_source(store, ListConnector("cj", items, fail_on_page=2), MockEnricher())
    assert r3.error and r3.stale_deactivated == 0
    assert all(o.is_active for o in store.list_offers(active_only=False))
    # a complete run without C deactivates exactly C
    r4 = sync_source(store, ListConnector("cj", items[:2]), MockEnricher())
    assert r4.complete and r4.stale_deactivated == 1
    assert not store.find_offer("cj", "C").is_active
    assert store.find_offer("cj", "A").is_active


def test_resync_is_idempotent_and_retranslates_on_change(store):
    enr = MockEnricher()
    sync_source(store, ListConnector("cj", [sp("A")]), enr)
    pid = store.find_offer("cj", "A").product_id
    r = sync_source(store, ListConnector("cj", [sp("A")]), enr)
    assert r.products_matched == 1 and r.products_created == 0 and r.translations_written == 0
    r = sync_source(store, ListConnector("cj", [sp("A", title="Better title")]), enr)
    assert r.translations_written == len(PHASE1_LOCALES)
    assert store.get_translation(pid, "fr").title == "[fr] Better title"
    assert len(store.products) == 1


def test_matched_product_from_other_source_keeps_existing_translations(store):
    sync_source(store, ListConnector("cj", [sp("A", gtin="123", title="First title")]), MockEnricher())
    r = sync_source(store, ListConnector("aliexpress_ds", [sp("Z", gtin="123", title="Other title")]),
                    MockEnricher())
    assert r.products_matched == 1 and r.translations_written == 0
    pid = store.find_offer("cj", "A").product_id
    assert store.get_translation(pid, "en").title == "First title"


def test_invalid_items_are_skipped_not_fatal(store):
    items = [sp("ok"), sp("nocost", cost=None), sp("nowhere", ships_to=[]),
             sp("badcur", currency="XYZ"), sp("days", delivery_days_min=9, delivery_days_max=2)]
    r = sync_source(store, ListConnector("cj", items), MockEnricher())
    assert r.offers_upserted == 1 and len(r.skipped) == 4
    assert any("fx rate" in s for s in r.skipped)


def test_affiliate_without_url_skipped(store):
    r = sync_source(store, ListConnector("temu", [sp("T", cost=None, list_price=Decimal("3"))]), MockEnricher())
    assert r.offers_upserted == 0 and "url" in r.skipped[0]


def test_unconfirmed_live_connector_reports_error_without_crash(store):
    c = get_connector("temu", env={"TEMU_AFFILIATE_ID": "x"})
    r = sync_source(store, c, MockEnricher())
    assert r.error and "NotConfirmedError" in r.error and r.stale_deactivated == 0
