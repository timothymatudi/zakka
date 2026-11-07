"""Merchant feed export (zakka_catalog.feed): Google Merchant Center fields, dropship only,
no partner names, bounded-memory streaming. No network: MemoryStore + mock connectors."""

import io
import json
import re
import tracemalloc
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from zakka_catalog.api import create_app
from zakka_catalog.cli import main as cli_main
from zakka_catalog.feed import FORMATS, iter_feed_chunks, iter_feed_items, write_feed
from zakka_catalog.models import Translation
from zakka_catalog.store import Country, FeedCategory, FeedRow, OfferView, OfferWrite, PostgresStore, ProductWrite

BASE = "https://zakka.example"
G = "{http://base.google.com/ns/1.0}"
# Every supplier / partner name from docs/CONTRACT.md, as whole words.
PARTNER_WORDS = re.compile(r"(?i)\b(cj|aliexpress|spocket|printful|amazon|temu|shein|jumia|noon|flipkart)\b")


def items(store, country="KE", locale="sw"):
    return list(iter_feed_items(store, country, locale, web_base_url=BASE))


def feed_text(store, fmt, country="KE", locale="sw"):
    buf = io.StringIO()
    write_feed(store, buf, fmt, country, locale, web_base_url=BASE)
    return buf.getvalue()


def add_dropship(store, *, title="Steel water bottle 1 L", description="Keeps drinks cold.", brand="Pika",
                 gtin=None, images=None, cost="10.00", stock=50, ships_to=("KE", "US"), active=True,
                 source="cj", external_id=None, category_slug=None):
    src = store.get_source(source)
    cat = None
    if category_slug:
        cat = next(c.id for c in store.list_categories() if c.slug == category_slug)
    pid = store.insert_product(ProductWrite(
        brand=brand, gtin=gtin, image_urls=list(images if images is not None else ["https://img.example/a.jpg"]),
        attributes={}, rating=Decimal("4.5"), review_count=10, category_id=cat,
        origin_key=f"{source}:{external_id or uuid.uuid4()}"))
    store.upsert_translation(pid, "en", Translation(title=title, description=description))
    oid = store.upsert_offer(OfferWrite(
        product_id=pid, source_id=src.id, external_id=external_id or str(uuid.uuid4()), url=None,
        cost_usd=Decimal(cost) if cost is not None else None, list_price_usd=None, shipping_usd=Decimal("2.00"),
        stock=stock, ships_from="CN", ships_to=list(ships_to), delivery_days_min=5, delivery_days_max=9,
        commission_rate=None, last_synced_at=datetime.now(timezone.utc), is_active=active))
    return pid, oid


# --- selection -------------------------------------------------------------------


def test_only_active_priced_dropship_offers_that_ship_to_the_country(synced):
    got = {it["id"] for it in items(synced)}
    expected = set()
    for o in synced.list_offers(active_only=False):
        if o.kind == "dropship" and o.is_active and o.cost_usd is not None and "KE" in o.ships_to:
            expected.add(str(o.id))
    assert got == expected and len(got) > 5


def test_affiliate_offers_are_excluded(synced):
    affiliate_ids = {str(o.id) for o in synced.list_offers(active_only=False) if o.kind == "affiliate"}
    affiliate_ke = {i for i in affiliate_ids if "KE" in synced.get_offer(uuid.UUID(i)).ships_to}
    assert affiliate_ke, "fixture should have affiliate offers shipping to KE"
    for fmt in FORMATS:
        text = feed_text(synced, fmt)
        assert not any(i in text for i in affiliate_ids), fmt


def test_inactive_unshippable_and_unpriced_offers_are_excluded(store):
    _, inactive = add_dropship(store, active=False)
    _, elsewhere = add_dropship(store, ships_to=("US",))
    _, unpriced = add_dropship(store, cost=None)
    _, ok = add_dropship(store)
    ids = {it["id"] for it in items(store)}
    assert ids == {str(ok)}
    assert not {str(inactive), str(elsewhere), str(unpriced)} & ids


def test_items_without_images_are_skipped(store):
    add_dropship(store, images=[])
    assert items(store) == []


# --- Google fields -----------------------------------------------------------------


def test_google_fields_kes_zero_decimals(store):
    pid, oid = add_dropship(store, gtin="4006381333931", category_slug="electronics",
                            images=[f"https://img.example/{n}.jpg" for n in range(15)])
    (it,) = items(store)
    assert it["id"] == str(oid)
    assert it["link"] == f"{BASE}/sw/p/{pid}?country=KE"
    assert it["image_link"] == f"{BASE}/img/{pid}/0"
    assert it["additional_image_link"] == [f"{BASE}/img/{pid}/{n}" for n in range(1, 11)]  # max 10
    assert re.fullmatch(r"\d+ KES", it["price"])  # KES shows 0 decimals
    off = store.get_offer(oid)
    from zakka_catalog.api import price_offer
    assert it["price"] == f"{price_offer(store, oid, 'KE').price} KES"  # same price as the API / checkout
    assert it["availability"] == "in_stock" and it["condition"] == "new"
    assert it["gtin"] == "4006381333931" and "identifier_exists" not in it
    assert it["brand"] == "Pika"
    assert it["product_type"].startswith("Vifaa vya Kielektroniki")  # localized category path
    assert it["shipping"] == {"country": "KE", "price": "0 KES", "min_handling_time": 1, "max_handling_time": 1,
                              "min_transit_time": off.delivery_days_min - 1,
                              "max_transit_time": off.delivery_days_max - 1}
    assert it["content_language"] == "en"  # no sw translation for this product


def test_usd_two_decimals_identifier_exists_and_out_of_stock(store):
    add_dropship(store, stock=0, brand=None)
    (it,) = items(store, "US", "en")
    assert re.fullmatch(r"\d+\.\d\d USD", it["price"])
    assert it["availability"] == "out_of_stock"
    assert it["identifier_exists"] == "no" and "gtin" not in it
    assert it["brand"] == "Zakka"  # seller fallback
    assert "content_language" not in it


def test_google_category_comes_from_category_tree(store):
    from zakka_catalog.models import CategoryRef

    elec = next(c for c in store.list_categories() if c.slug == "electronics")
    store.categories[elec.id] = CategoryRef(**{**elec.model_dump(), "google_category_id": 222})
    child = next(c for c in store.list_categories() if c.parent_id == elec.id)
    add_dropship(store, category_slug=child.slug)
    (it,) = items(store)
    assert it["google_product_category"] == 222  # inherited from the nearest ancestor


def test_partner_names_are_stripped_and_partner_brand_becomes_zakka(store):
    add_dropship(store, title="Amazon Basics USB-C cable 2 m - Sold on AliExpress",
                 description="Ships from CJ Dropshipping. Great Temu alternative, like on Shein or Jumia.",
                 brand="Amazon")
    (it,) = items(store, "US", "en")
    assert it["brand"] == "Zakka"
    assert "USB-C cable 2 m" in it["title"]
    assert not PARTNER_WORDS.search(it["title"] + it["description"] + it["brand"])


def test_no_partner_names_in_any_generated_feed(synced):
    add_dropship(synced, title="Flipkart favourite noon.com lamp by Printful | Spocket", brand="Spocket",
                 description="Seen on Amazon.com")
    for country, locale in (("KE", "sw"), ("US", "en"), ("AE", "ar"), ("IN", "hi"), ("NG", "en")):
        for fmt in FORMATS:
            text = feed_text(synced, fmt, country, locale)
            hit = PARTNER_WORDS.search(text)
            assert hit is None, f"{fmt} {country}/{locale}: {hit and text[max(0, hit.start() - 80):hit.end() + 40]}"


# --- formats -------------------------------------------------------------------------


def test_xml_is_well_formed_rss_with_google_namespace(synced):
    root = ET.fromstring(feed_text(synced, "google-xml").encode("utf-8"))
    assert root.tag == "rss"
    its = root.findall("./channel/item")
    assert len(its) == len(items(synced))
    first = its[0]
    for tag in ("id", "title", "description", "link", "image_link", "availability", "price", "brand", "condition"):
        assert first.find(G + tag) is not None and first.find(G + tag).text, tag
    ship = first.find(G + "shipping")
    assert ship.find(G + "country").text == "KE" and ship.find(G + "price").text == "0 KES"


def test_xml_escapes_markup_and_control_characters(store):
    add_dropship(store, title='Mug <b>"big"</b> & co\x0b', description="a\x00b")
    root = ET.fromstring(feed_text(store, "google-xml").encode("utf-8"))
    title = root.find("./channel/item").find(G + "title").text
    assert title == 'Mug <b>"big"</b> & co'


def test_tsv_and_jsonl(synced):
    tsv = feed_text(synced, "google-tsv").splitlines()
    header = tsv[0].split("\t")
    assert header[:4] == ["id", "title", "description", "link"]
    rows = [dict(zip(header, line.split("\t"))) for line in tsv[1:]]
    assert rows and all(len(line.split("\t")) == len(header) for line in tsv[1:])
    assert all(r["shipping"] == "KE:::0 KES" for r in rows)
    lines = feed_text(synced, "jsonl").splitlines()
    assert [json.loads(x)["id"] for x in lines] == [r["id"] for r in rows]


def test_unknown_country_and_format_raise(synced):
    with pytest.raises(ValueError):
        items(synced, "XX")
    with pytest.raises(ValueError):
        list(iter_feed_chunks(synced, "csv", "KE", "sw", web_base_url=BASE))


# --- streaming -------------------------------------------------------------------------


class SyntheticFeedStore:
    """Lazily yields N feed rows; counts how many were pulled."""

    def __init__(self, n):
        self.n, self.pulled = n, 0
        self.cat = uuid.uuid4()
        self.src = uuid.uuid4()

    def get_country(self, code):
        return Country("KE", "KES", "sw")

    def get_fx_rate(self, quote):
        return Decimal("129")

    def get_currency_decimals(self, code):
        return 0

    def list_markup_rules(self):
        return []

    def feed_categories(self, locale):
        return {self.cat: FeedCategory(None, "Kitchen", 638)}

    def category_lineage(self, category_id):
        return [category_id]

    def iter_feed_rows(self, country, locale, batch_size=500):
        for i in range(self.n):
            self.pulled += 1
            pid = uuid.UUID(int=i + 1)
            yield FeedRow(
                offer=OfferView(id=uuid.UUID(int=10**12 + i), product_id=pid, source_id=self.src, source_code="cj",
                                kind="dropship", external_id=str(i), url=None, cost_usd=Decimal("7.50"),
                                list_price_usd=None, shipping_usd=Decimal("1.20"), stock=10, ships_from="CN",
                                ships_to=["KE"], delivery_days_min=6, delivery_days_max=12, is_active=True,
                                category_id=self.cat),
                brand="Pika", gtin=None, image_urls=["https://img.example/x.jpg"], rating=None, review_count=0,
                title=f"Synthetic product {i}", description="Generated for the streaming test.", text_locale="sw")


class CountingSink(io.TextIOBase):
    def __init__(self):
        self.chars = 0

    def write(self, s):
        self.chars += len(s)
        return len(s)


def test_feed_is_streamed_lazily():
    s = SyntheticFeedStore(1_000_000)
    chunks = iter_feed_chunks(s, "google-xml", "KE", "sw", web_base_url=BASE)
    next(chunks)  # header
    next(chunks)  # first item
    assert s.pulled == 1  # nothing is materialised ahead of the writer


def test_memory_stays_bounded():
    s = SyntheticFeedStore(20_000)
    sink = CountingSink()
    tracemalloc.start()
    try:
        stats = write_feed(s, sink, "google-xml", "KE", "sw", web_base_url=BASE)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert stats.items == 20_000 and sink.chars > 20_000 * 500
    assert peak < 5 * 1024 * 1024  # a 10+ MB feed written with well under 5 MB of Python allocations


def test_postgres_rows_use_keyset_pagination():
    pg = PostgresStore.__new__(PostgresStore)
    ids = [uuid.UUID(int=i) for i in range(1, 6)]
    calls = []

    def fake_all(sql, params):
        calls.append(params)
        locale, _, country, after, limit = params
        rest = [i for i in ids if i > after][:limit]
        return [{"id": i, "product_id": i, "source_id": i, "source_code": "cj", "kind": "dropship",
                 "external_id": str(i.int), "url": None, "cost_usd": Decimal("5"), "list_price_usd": None,
                 "shipping_usd": Decimal("1"), "stock": 3, "ships_from": "CN", "ships_to": [country],
                 "delivery_days_min": 3, "delivery_days_max": 6, "is_active": True, "last_synced_at": None,
                 "category_id": None, "brand": None, "gtin": None, "image_urls": [], "rating": None,
                 "review_count": 0, "title": "t", "description": None, "text_locale": locale} for i in rest]

    pg._all = fake_all
    rows = list(pg.iter_feed_rows("ke", "sw", batch_size=2))
    assert [r.offer.id for r in rows] == ids
    assert [c[3] for c in calls] == [uuid.UUID(int=0), ids[1], ids[3]]
    assert all(c[2] == "KE" and c[4] == 2 for c in calls)
    assert "s.kind = 'dropship'" in PostgresStore._FEED_SQL and "o.is_active" in PostgresStore._FEED_SQL


# --- HTTP + CLI -------------------------------------------------------------------------


@pytest.fixture
def client(synced, connectors, tmp_path):
    app = create_app(store=synced, connectors=connectors, store_name="memory", api_token="secret",
                     feed_cache_dir=tmp_path, web_base_url=BASE)
    return TestClient(app, follow_redirects=False)


def test_feed_endpoint_is_public_cached_and_well_formed(client, tmp_path, monkeypatch):
    r = client.get("/feeds/KE/sw.xml")  # no bearer token needed
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    assert "max-age=3600" in r.headers["cache-control"]
    ET.fromstring(r.content)
    assert not PARTNER_WORDS.search(r.text)

    import zakka_catalog.feed as feed_mod

    def boom(*a, **k):
        raise AssertionError("feed regenerated inside the TTL")

    monkeypatch.setattr(feed_mod, "write_feed", boom)
    assert client.get("/feeds/ke/sw.xml").content == r.content  # served from the 1h cache


def test_feed_endpoint_rejects_bad_paths(client):
    assert client.get("/feeds/KE/xx.xml").status_code == 404
    assert client.get("/feeds/KE/sw.csv").status_code == 404
    assert client.get("/feeds/KEN/sw.xml").status_code == 404
    assert client.get("/feeds/XX/sw.xml").status_code == 404  # unknown country


def test_image_redirect(client, synced):
    pid = next(iter(synced.products))
    url = synced.get_product(pid)["image_urls"][0]
    r = client.get(f"/images/{pid}/0")
    assert r.status_code == 302 and r.headers["location"] == url
    assert client.get(f"/images/{pid}/99").status_code == 404
    assert client.get(f"/images/{uuid.uuid4()}/0").status_code == 404


def test_cli_feed_demo(tmp_path, capsys):
    out = tmp_path / "ke-sw.xml"
    assert cli_main(["feed", "--country", "ke", "--locale", "sw", "--format", "google-xml", "--out", str(out),
                     "--demo", "--web-base-url", BASE]) == 0
    root = ET.parse(out).getroot()
    assert root.findall("./channel/item")
    assert "items=" in capsys.readouterr().err
    assert not list(tmp_path.glob("*.tmp"))
