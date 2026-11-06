"""Scale pipeline: batching, checkpoint/resume after a kill, incremental runs, tiering,
lazy cost control, import scope, job queue, live affiliate search. No network."""

import json
import threading
from datetime import timedelta
from decimal import Decimal

import pytest

from zakka_catalog.connectors import all_connectors, get_connector
from zakka_catalog.enrich import MockEnricher
from zakka_catalog.images import LocalImageStore
from zakka_catalog.pricing import OfferPricingInput, display_price_usd, display_price_usd_for_rule, select_markup_rule
from zakka_catalog.scale.bulkstore import SqliteBulkStore, utcnow
from zakka_catalog.scale.jobqueue import NonRetryable, SqliteJobQueue, Worker, drain_parallel
from zakka_catalog.scale.live import LiveAffiliateSearch, QuotaTracker
from zakka_catalog.scale.pipeline import ImportRun, ScaleContext, make_handlers, plan_refresh
from zakka_catalog.scale.synthetic import SimulatedKill, SyntheticSupplier
from zakka_catalog.scheduler import run_once


class CountingEnricher(MockEnricher):
    def __init__(self):
        self.calls = 0

    def enrich(self, product, categories, locales):
        self.calls += 1
        return super().enrich(product, categories, locales)


def fresh(tmp_path, name="c"):
    return SqliteBulkStore(tmp_path / f"{name}.sqlite"), SqliteJobQueue(tmp_path / f"{name}-jobs.sqlite")


# --- batching / streaming ---------------------------------------------------------------------

def test_100k_items_stream_through_in_1000_row_batches():
    bulk, queue = SqliteBulkStore(":memory:"), SqliteJobQueue(":memory:")
    supplier = SyntheticSupplier(100_000)
    batches = []
    real = bulk.upsert_offers
    bulk.upsert_offers = lambda rows: (batches.append(len(rows)), real(rows))[1]
    res = ImportRun(bulk, supplier, queue=queue, batch_size=1000).run()
    assert res.complete and res.scope == "full" and res.pages == 100
    assert batches == [1000] * 100                 # one multi-row upsert per page, never more than 1,000 rows
    assert res.stats.scanned == res.stats.new == 100_000
    assert bulk.offer_count() == 100_000 and bulk.product_count() == 100_000
    assert queue.counts()["queued"] == 100         # one reindex job per page, not per item
    # incremental run: 1% changed at the supplier -> only those flow through
    supplier.generation = 1
    inc = ImportRun(bulk, supplier, queue=queue).run()
    assert inc.scope == "delta" and inc.stats.scanned == inc.stats.changed == 1000
    assert inc.stats.new == 0 and bulk.offer_count() == 100_000
    # nothing changed -> nothing flows
    supplier.generation = 1
    again = ImportRun(bulk, supplier, queue=queue).run()
    assert again.stats.changed == 0 and again.stats.unchanged == again.stats.scanned


def test_rule_cache_price_matches_reference_pricing():
    bulk = SqliteBulkStore(":memory:")
    for cat in bulk.ref.categories[:40]:
        off = OfferPricingInput(kind="dropship", cost_usd=Decimal("7.31"), list_price_usd=None,
                                shipping_usd=Decimal("2.10"), product_id="p", source_id="s")
        lineage = bulk.ref.lineage(str(cat.id))
        rule = select_markup_rule(bulk.ref.rules, product_id="p", source_id="s", category_lineage=lineage)
        assert display_price_usd_for_rule(off, rule) == display_price_usd(off, rules=bulk.ref.rules,
                                                                          category_lineage=lineage)


# --- checkpoint / resume -------------------------------------------------------------------------

def test_killed_run_resumes_from_checkpoint(tmp_path):
    bulk, queue = fresh(tmp_path)
    killer = SyntheticSupplier(20_000, kill_at_cursor="7000")
    with pytest.raises(SimulatedKill):
        ImportRun(bulk, killer, queue=queue).run()
    bulk.close()  # the "process" is gone: anything uncommitted is lost

    bulk = SqliteBulkStore(tmp_path / "c.sqlite")
    src = bulk.get_source("synthetic")
    assert bulk.get_checkpoint(src.id, "full")["cursor"] == "7000"
    assert bulk.offer_count() == 7000
    supplier = SyntheticSupplier(20_000)
    res = ImportRun(bulk, supplier, queue=queue).run()
    assert res.resumed_from == "7000" and res.complete and res.pages == 13
    assert supplier.cursors_seen[0] == "7000"       # did not start over
    assert bulk.offer_count() == 20_000 and res.stats.deactivated == 0
    assert res.stats.new == 20_000                   # stats carried across the restart (7,000 + 13,000)
    assert bulk.get_checkpoint(src.id, "full")["cursor"] is None


def test_kill_in_the_middle_of_writing_a_page_loses_only_that_page(tmp_path):
    bulk, queue = fresh(tmp_path)
    calls = {"n": 0}
    real = bulk.upsert_offers

    def dying(rows):
        calls["n"] += 1
        if calls["n"] == 4:  # products/translations of page 4 already written, not committed
            raise SimulatedKill("power cut")
        return real(rows)

    bulk.upsert_offers = dying
    with pytest.raises(SimulatedKill):
        ImportRun(bulk, SyntheticSupplier(10_000), queue=queue).run()
    bulk.close()
    bulk = SqliteBulkStore(tmp_path / "c.sqlite")
    assert bulk.offer_count() == 3000 and bulk.product_count() == 3000  # page 4 rolled back as a unit
    res = ImportRun(bulk, SyntheticSupplier(10_000), queue=queue).run()
    assert res.resumed_from == "3000" and bulk.offer_count() == bulk.product_count() == 10_000


def test_transient_supplier_error_is_retried_by_the_job_queue(tmp_path):
    bulk, queue = fresh(tmp_path)
    queue.backoff_base = timedelta(0)
    flaky = SyntheticSupplier(5000, fail_at_cursor="2000", fail_times=1)
    ctx = ScaleContext(make_bulk=lambda: bulk, queue=queue, connectors={"synthetic": flaky},
                       enricher=MockEnricher(), call_for=lambda c: (lambda fn, *a: fn(*a)))
    queue.enqueue("import_source", {"source": "synthetic"}, dedupe_key="import:synthetic")
    stats = Worker(queue, make_handlers(ctx)).drain()
    assert stats.retried == 1 and stats.dead == 0
    assert [r.resumed_from for r in ctx.results] == ["2000"]  # 2nd attempt resumed (1st raised before returning)
    assert bulk.offer_count() == 5000


def test_full_scan_deactivates_items_gone_at_the_supplier(tmp_path):
    bulk, queue = fresh(tmp_path)
    ImportRun(bulk, SyntheticSupplier(3000), queue=queue).run()
    shrunk = SyntheticSupplier(2500)
    res = ImportRun(bulk, shrunk, queue=queue, full_scan_every=timedelta(0)).run()
    already_inactive = sum(1 for i in range(2500, 3000) if i % 250 == 7)  # out of stock before
    assert res.scope == "full" and res.stats.deactivated == 500 - already_inactive
    assert bulk.offer_count(active_only=True) == 2500 - sum(1 for i in range(2500) if i % 250 == 7)


# --- tiers -----------------------------------------------------------------------------------------

def test_tiering_and_due_refresh(tmp_path):
    bulk, queue = fresh(tmp_path)
    supplier = SyntheticSupplier(2000)
    ImportRun(bulk, supplier, queue=queue).run()
    src = bulk.get_source("synthetic")
    rows = bulk.query("select id, product_id, external_id from offers where is_active order by external_id limit 30")
    hot, warm = [r["id"] for r in rows[:5]], [r["product_id"] for r in rows[5:15]]
    now = utcnow()
    with bulk.transaction():
        bulk.record_engagement(hot, now)
        bulk.record_impressions(warm, now)
        t = bulk.recompute_tiers(now)
    assert t["promoted"] == 15 and bulk.tier_counts()["hot"] == 5 and bulk.tier_counts()["warm"] == 10
    assert len(bulk.due_offers(src.id, now, 100)) == 15   # promoted -> due immediately
    clock = {"now": now}
    ctx = ScaleContext(make_bulk=lambda: bulk, queue=queue, connectors={"synthetic": supplier},
                       enricher=MockEnricher(), now=lambda: clock["now"])
    assert plan_refresh(ctx) == 1                          # one bulk refresh job (bulk_size 200)
    assert bulk.due_offers(src.id, now, 100) == []
    Worker(queue, make_handlers(ctx)).drain()
    clock["now"] = now + timedelta(minutes=61)
    assert {r["refresh_tier"] for r in bulk.due_offers(src.id, clock["now"], 100)} == {"hot"}
    clock["now"] = now + timedelta(days=1, minutes=1)
    assert len(bulk.due_offers(src.id, clock["now"], 100)) == 15
    # engagement ages out -> demoted to cold, never due through the tier path
    with bulk.transaction():
        bulk.recompute_tiers(now + timedelta(days=40))
    assert bulk.tier_counts() == {"cold": bulk.offer_count(active_only=True)}


def test_lazy_cost_ai_and_images_only_for_promoted_products(tmp_path):
    bulk, queue = fresh(tmp_path)
    enricher, images = CountingEnricher(), LocalImageStore(tmp_path / "images")
    supplier = SyntheticSupplier(3000)
    connectors = {"synthetic": supplier}
    summary = run_once(lambda: bulk, queue, connectors, enricher, images=images, workers=1, cache_dir=tmp_path)
    assert summary.imports["synthetic"]["new"] == 3000
    assert enricher.calls == 0 and not (tmp_path / "images").exists()     # cold: no AI, no mirroring
    pids = [r["product_id"] for r in bulk.query("select product_id from offers where is_active limit 3")]
    offer_ids = [r["id"] for r in bulk.query("select id from offers where is_active limit 3")]
    with bulk.transaction():
        bulk.record_engagement(offer_ids)
    summary = run_once(lambda: bulk, queue, connectors, enricher, images=images, workers=2, cache_dir=tmp_path)
    assert summary.promoted == 3 and summary.jobs["dead"] == 0
    assert enricher.calls == 3                                               # one AI call per promoted product
    p = bulk.get_product(pids[0])
    assert p["attributes"]["_sync"]["full"] is True and p["attributes"]["variants"]
    assert all(u.startswith("file:") for u in p["image_urls"]) and len(p["image_urls"]) == 3  # gallery, deduped
    assert len(bulk.get_translations(pids[0])) == 10
    assert len(list((tmp_path / "images").rglob("*.svg"))) == 9
    assert json.loads((tmp_path / "last-run.json").read_text())["promoted"] == 3


def test_changed_hot_item_goes_through_detail_job_not_bulk_overwrite(tmp_path):
    bulk, queue = fresh(tmp_path)
    supplier = SyntheticSupplier(1000, changed_every=100)
    ImportRun(bulk, supplier, queue=queue).run()
    row = bulk.query("select id, product_id from offers where external_id = 'SYN00000100'")[0]
    with bulk.transaction():
        bulk.record_engagement([row["id"]])
        bulk.recompute_tiers(utcnow())
    supplier.generation = 2
    res = ImportRun(bulk, supplier, queue=queue).run()
    assert res.stats.changed == 10
    detail = [j for j in queue.claim("t", kinds=("fetch_detail",), limit=50)]
    assert [j.payload["external_id"] for j in detail] == ["SYN00000100"]


# --- import scope -----------------------------------------------------------------------------------

def test_import_scope_filters(tmp_path):
    bulk, queue = fresh(tmp_path)
    src = bulk.ensure_source("synthetic", "dropship", "Synthetic Supplier")
    with bulk.transaction():
        bulk.set_source_config(src.id, {"import": {"categories": ["electronics"], "min_rating": 4.0,
                                                   "ships_to": ["KE", "US"], "max_items": 50}})
    res = ImportRun(bulk, SyntheticSupplier(5000), queue=queue).run()
    assert bulk.offer_count() == 50 and res.stats.filtered == 5000 - 50
    electronics = bulk.ref.slug_to_id["electronics"]
    for r in bulk.query("select p.category_id from offers o join products p on p.id = o.product_id"):
        assert electronics in bulk.ref.lineage(r["category_id"])


def test_affiliates_are_never_bulk_imported(tmp_path):
    bulk, queue = fresh(tmp_path)
    with pytest.raises(NonRetryable):
        ImportRun(bulk, get_connector("amazon", env={}), queue=queue)
    summary = run_once(lambda: bulk, queue, all_connectors(env={}), MockEnricher(), cache_dir=tmp_path)
    assert set(summary.imports) == {"cj", "aliexpress_ds", "spocket", "printful"}
    dropship_items = sum(len(c.fixture["products"]) for c in all_connectors(env={}).values() if c.kind == "dropship")
    assert bulk.offer_count() == dropship_items
    assert summary.api["cj"]["calls"] >= 1 and summary.duration_s >= 0


# --- job queue -------------------------------------------------------------------------------------------

def test_queue_dedupe_concurrency_retry_and_dead_letter(tmp_path):
    q = SqliteJobQueue(tmp_path / "q.sqlite")
    q.backoff_base = timedelta(0)
    assert q.enqueue("x", {"i": 0}, dedupe_key="same") and q.enqueue("x", {}, dedupe_key="same") is None
    for i in range(1, 200):
        q.enqueue("x", {"i": i})
    seen, lock = [], threading.Lock()

    def handle(job, hb):
        with lock:
            seen.append(job.payload["i"])

    stats = drain_parallel(lambda i: Worker(q, {"x": handle}, name=f"w{i}"), 4)
    assert stats.done == 200 and sorted(seen) == list(range(200))  # each job exactly once
    calls = {"n": 0}

    def flaky(job, hb):
        calls["n"] += 1
        raise RuntimeError("boom")

    q.enqueue("flaky", {}, max_attempts=3)
    q.enqueue("fatal", {})
    w = Worker(q, {"flaky": flaky, "fatal": lambda j, hb: (_ for _ in ()).throw(NonRetryable("bad payload"))})
    w.drain()
    assert calls["n"] == 3 and w.stats.retried == 2 and w.stats.dead == 2
    assert {d["kind"] for d in q.dead_jobs()} == {"flaky", "fatal"}
    q.enqueue("slow", {})
    assert q.claim("crashed-worker", kinds=("slow",))
    assert q.requeue_stale(timedelta(0)) == 1 and q.counts()["queued"] == 1


# --- live affiliate search ----------------------------------------------------------------------------------

def test_live_search_caches_and_respects_quota():
    clock = {"t": 0.0}
    conns = all_connectors(env={})
    live = LiveAffiliateSearch(conns, ttl_seconds=3600, clock=lambda: clock["t"],
                               quota=QuotaTracker({"amazon": 2}))
    r1 = live.search("earbuds", "US")
    assert r1["sources"]["amazon"] == "live" and any(i["source_code"] == "amazon" for i in r1["items"])
    assert all(i["kind"] == "affiliate" for i in r1["items"]) and "cj" not in r1["sources"]
    assert live.search("Earbuds ", "us")["sources"]["amazon"] == "cache"
    live.search("air fryer", "AE")
    assert live.search("kurta", "IN")["sources"]["amazon"] == "quota_exceeded"
    assert live.quota.snapshot()["amazon"] == {"used": 2, "quota": 2}
    clock["t"] = 3601
    assert live.search("earbuds", "US")["sources"]["amazon"] == "quota_exceeded"  # cache expired, no budget


def test_api_live_materialize_refresh_and_signals(synced, connectors):
    from fastapi.testclient import TestClient

    from zakka_catalog.api import create_app

    c = TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token="t"))
    auth = {"Authorization": "Bearer t"}
    assert c.get("/live/search?q=earbuds").status_code == 401
    hits = c.get("/live/search?q=earbuds&country=US", headers=auth).json()["items"]
    amazon = next(h for h in hits if h["source_code"] == "amazon")
    m = c.post(f"/live/amazon/{amazon['external_id']}/materialize", headers=auth).json()
    assert synced.get_offer(__import__("uuid").UUID(m["offer_id"])).kind == "affiliate"
    oid = str(synced.find_offer("cj", "CJ-EAR-001").id)
    assert c.post(f"/offers/{oid}/refresh", headers=auth).json()["refreshed"] is False      # fresh
    r = c.post(f"/offers/{oid}/refresh?force=true&country=KE", headers=auth).json()
    assert r["refreshed"] is True and r["price"]["currency"] == "KES"
    pid = synced.find_offer("cj", "CJ-EAR-001").product_id
    del synced.translations[(pid, "sw")]
    s = c.post("/signals", headers=auth, json={"engaged_offer_ids": [oid], "impression_product_ids": [str(pid)],
                                               "viewed": [{"product_id": str(pid), "locale": "sw"}]}).json()
    assert s["translated_now"] == 1 and (pid, "sw") in synced.translations


# --- stored display prices stay current -------------------------------------------------------------

def test_markup_rule_or_fx_change_reprices_stored_offers(tmp_path):
    from zakka_catalog.pricing import MarkupRule
    from zakka_catalog.scale.pipeline import plan_reprice

    bulk, queue = fresh(tmp_path)
    ImportRun(bulk, SyntheticSupplier(3000), queue=queue).run()
    ctx = ScaleContext(make_bulk=lambda: bulk, queue=queue, connectors={}, enricher=MockEnricher())
    assert plan_reprice(ctx) == 0                       # first run records the pricing fingerprint
    assert plan_reprice(ctx) == 0                       # nothing changed
    before = {r["id"]: r["display_price_usd"] for r in bulk.query("select id, display_price_usd from offers")}
    src = bulk.get_source("synthetic")
    bulk.ref.rules.append(MarkupRule(id="zz-src", scope="source", scope_id=src.id, percent=Decimal("80"),
                                     fixed_usd=Decimal("0"), round_to=Decimal("0.99")))
    assert plan_reprice(ctx) == 1
    Worker(queue, make_handlers(ctx), name="w").drain()
    after = {r["id"]: r["display_price_usd"] for r in bulk.query("select id, display_price_usd from offers")}
    raised = sum(1 for i in before if Decimal(after[i]) > Decimal(before[i]))
    assert all(Decimal(after[i]) >= Decimal(before[i]) for i in before)  # x.99 rounding can absorb tiny deltas
    assert raised > 0.9 * len(before)                                    # repriced by the streaming job
    assert plan_reprice(ctx) == 0                                       # fingerprint stored after the job


def test_fx_change_updates_affiliate_usd_from_local_price(tmp_path):
    from zakka_catalog.scale.pipeline import Ingestor, reprice_source

    bulk = SqliteBulkStore(tmp_path / "c.sqlite")
    jumia = get_connector("jumia", env={})
    src = bulk.ensure_source("jumia", "affiliate", "Jumia")
    with bulk.transaction():
        Ingestor(bulk, src, jumia).process(jumia.fetch_products(1).items)
    row = lambda: bulk.query("select list_price_usd, display_price_usd from offers where external_id = 'JM-NG-801'")[0]  # noqa: E731
    assert Decimal(row()["display_price_usd"]) == Decimal("39.35")      # (58,500 + 2,500) / 1,550
    bulk.ref.fx["NGN"] = Decimal("1600")
    ngn = sum(1 for p in jumia.fixture["products"] if p.get("currency", "NGN") == "NGN")
    assert reprice_source(bulk, src.id) == ngn  # only NGN-priced offers move (KES/EGP rates unchanged)
    assert Decimal(row()["list_price_usd"]) == Decimal("36.56") and Decimal(row()["display_price_usd"]) == Decimal("38.12")


def test_live_hits_shape_and_materialize_ids_match(synced, connectors):
    from fastapi.testclient import TestClient

    from zakka_catalog.api import create_app

    c = TestClient(create_app(store=synced, connectors=connectors, store_name="memory", api_token="t"))
    auth = {"Authorization": "Bearer t"}
    body = c.get("/live?q=earbuds&country=US&locale=sw", headers=auth).json()
    assert body["locale"] == "sw" and body["hits"]
    hit = next(h for h in body["hits"] if h["gtin"] == "2000000000015")
    assert {o["source_code"] for o in hit["offers"]} == {"amazon", "aliexpress_aff"}  # same GTIN merged
    off = next(o for o in hit["offers"] if o["source_code"] == "amazon")
    assert set(off) >= {"offer_id", "kind", "display_price_usd", "delivery_days_min", "delivery_days_max",
                        "ships_from", "ships_to", "url", "list_price_local", "list_currency", "shipping_local"}
    assert "amazon" not in hit["title"].lower()
    m = c.post(f"/live/amazon/{'B0MOCKUS01'}/materialize", headers=auth).json()
    assert m["offer_id"] == off["offer_id"]                                 # click maps to the same offer id
    assert c.post("/admin/reprice", headers=auth).json()["repriced"] > 0
