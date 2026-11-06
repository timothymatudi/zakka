"""Scale pipeline: streaming, checkpointed, tiered catalog ingestion.

Design (see README "Scale"):

* **Only dropship catalogues are imported.** Affiliate partners are searched live
  (``scale.live``); only items customers see/click are stored.
* **Streaming.** Listings are read page by page (cursor), each page is written with
  set-based upserts (``batch_size`` rows, default 1,000) in one transaction together
  with the source's checkpoint. A crash loses at most the page in flight, and the
  next run resumes from the checkpoint. Memory use does not grow with catalogue size.
* **Incremental.** Full scans run weekly (they also detect removed items). In between,
  suppliers with an "updated since" API are read as deltas, and hot/warm offers are
  re-priced on their own schedule (``refresh_offers`` jobs).
* **Content hashing.** Unchanged listings only update commercial fields (price, stock,
  delivery, availability). Changed content is handled according to the offer's tier.
* **Tiers** (``offers.refresh_tier``): hot (engaged in the last 7 days) is refreshed
  hourly, warm (seen in search in the last 30 days) daily, cold weekly.
* **Lazy cost.** New and cold products get a rule-based category, the source-language
  text and supplier image URLs. AI translation, image mirroring and full detail are
  done only for hot/warm products, or when a product is first viewed in a locale.
* **Import scope.** ``sources.config.import`` holds categories, min_rating, ships_to,
  min_price_usd, max_price_usd and max_items.
* **Heavy work runs as jobs.** fetch_detail, translate, mirror_images, refresh_offers,
  reindex and notify go through the durable ``jobs`` queue (retries, dead-letter).
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Mapping

from ..connectors import Connector
from ..enrich import Enricher, MockEnricher, _slug
from ..images import ImageStore, dedupe
from ..models import CategoryRef, SourceProduct, TrackingInfo
from ..pricing import OfferPricingInput, display_price_usd_for_rule, select_markup_rule
from ..sync import SyncItemError, _validate, content_hash, customer_copy, text_hash
from .bulkstore import TIER_INTERVAL, SourceInfo, SqlBulkStore, product_id_for, utcnow
from .jobqueue import Job, JobQueue, NonRetryable

log = logging.getLogger(__name__)

BATCH_SIZE = 1000
FULL_SCAN_EVERY = timedelta(days=7)
CENT = Decimal("0.01")


# ---------------------------------------------------------------------------------------------
@dataclass
class ImportScope:
    """Owner-controlled import filters from ``sources.config["import"]``."""

    categories: frozenset[str] | None = None  # category slugs (a product matches if any ancestor matches)
    min_rating: Decimal | None = None
    ships_to: frozenset[str] | None = None    # import only items shipping to at least one of these
    min_price_usd: Decimal | None = None      # on the display price
    max_price_usd: Decimal | None = None
    max_items: int | None = None              # cap on active offers for the source

    @classmethod
    def from_config(cls, config: Mapping[str, Any] | None) -> "ImportScope":
        c = dict((config or {}).get("import") or {})
        dec = lambda k: Decimal(str(c[k])) if c.get(k) is not None else None  # noqa: E731
        return cls(categories=frozenset(c["categories"]) if c.get("categories") else None,
                   min_rating=dec("min_rating"),
                   ships_to=frozenset(x.upper() for x in c["ships_to"]) if c.get("ships_to") else None,
                   min_price_usd=dec("min_price_usd"), max_price_usd=dec("max_price_usd"),
                   max_items=int(c["max_items"]) if c.get("max_items") else None)

    def reject(self, sp: SourceProduct, price_usd: Decimal, lineage_slugs: list[str]) -> str | None:
        if self.categories is not None and not self.categories.intersection(lineage_slugs):
            return "category"
        if self.min_rating is not None and (sp.rating is None or sp.rating < self.min_rating):
            return "rating"
        if self.ships_to is not None and not self.ships_to.intersection(sp.ships_to):
            return "ships_to"
        if self.min_price_usd is not None and price_usd < self.min_price_usd:
            return "price"
        if self.max_price_usd is not None and price_usd > self.max_price_usd:
            return "price"
        return None


@dataclass
class PageStats:
    scanned: int = 0
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    filtered: int = 0
    failed: int = 0
    deactivated: int = 0
    jobs_enqueued: int = 0

    def add(self, other: "PageStats") -> None:
        for k, v in asdict(other).items():
            setattr(self, k, getattr(self, k) + v)


class RuleCategorizer:
    """Cheap, deterministic categoriser for cold items (no AI): the source's own path,
    then keywords. Results are cached by category path."""

    def __init__(self, categories: list[CategoryRef]):
        self.categories = categories
        self.by_key: dict[str, str] = {}
        for c in categories:
            self.by_key[c.slug] = c.slug
            if c.name:
                self.by_key[_slug(c.name)] = c.slug
        self._mock = MockEnricher()
        self._cache: dict[str, str | None] = {}

    def __call__(self, sp: SourceProduct) -> str | None:
        hint = sp.category_hint or ""
        if hint in self._cache:
            return self._cache[hint]
        last = _slug(hint.split(">")[-1]) if hint else ""
        if last in self.by_key:
            self._cache[hint] = self.by_key[last]
            return self.by_key[last]
        return self._mock.categorize(sp, self.categories)


# ---------------------------------------------------------------------------------------------
class Ingestor:
    """Writes one page of listing items with set-based upserts. Caller commits."""

    def __init__(self, bulk: SqlBulkStore, source: SourceInfo, connector: Connector, *,
                 queue: JobQueue | None = None, now: Callable[[], datetime] = utcnow):
        self.bulk, self.source, self.connector, self.queue, self.now = bulk, source, connector, queue, now
        self.ref = bulk.ref
        self.categorize = RuleCategorizer(self.ref.categories)
        self.scope = ImportScope.from_config(source.config)
        self.active_count = bulk.count_active_offers(source.id) if self.scope.max_items else 0
        self._id_to_slug = {str(c.id): c.slug for c in self.ref.categories}
        self._product_rules = any(r.scope == "product" for r in self.ref.rules)
        self._rule_cache: dict = {}
        self.source_locale = "en"

    def _usd(self, amount, currency: str) -> Decimal | None:
        if amount is None:
            return None
        rate = self.ref.fx_rate(currency)
        if rate is None:
            raise SyncItemError(f"no fx rate USD->{currency}")
        return (Decimal(amount) / rate).quantize(CENT, rounding=ROUND_HALF_UP)

    def process(self, items: list[SourceProduct]) -> PageStats:
        st = PageStats(scanned=len(items))
        kind, now = self.connector.kind, self.now()
        prepared = []
        for sp in items:
            try:
                _validate(sp, kind)
                listing_hash = content_hash(sp)  # of the raw listing, compared on every scan
                sp = customer_copy(sp)
                prepared.append((sp, listing_hash, self._usd(sp.cost, sp.currency),
                                 self._usd(sp.list_price, sp.currency), self._usd(sp.shipping, sp.currency) or Decimal(0)))
            except (SyncItemError, ValueError) as exc:
                st.failed += 1
                log.debug("[%s] skip %s: %s", self.connector.code, sp.external_id, exc)
        index = self.bulk.offer_index(self.source.id, [p[0].external_id for p in prepared])
        gtin_map = self.bulk.products_by_gtin([p[0].gtin for p in prepared if p[0].external_id not in index and p[0].gtin])

        products, translations, offers, changed_pids, detail_jobs = [], [], [], set(), []
        new_products: dict[str, dict] = {}
        for sp, h, cost_usd, list_usd, ship_usd in prepared:
            idx = index.get(sp.external_id)
            key = f"{self.connector.code}:{sp.external_id}"
            if idx is not None:
                product_id, category_id, tier = idx.product_id, idx.category_id, idx.refresh_tier
            else:
                product_id = gtin_map.get(sp.gtin) if sp.gtin else None
                slug = self.categorize(sp)
                category_id = self.ref.slug_to_id.get(slug) if slug else None
                tier = "cold"
            price = display_price_usd_for_rule(
                OfferPricingInput(kind=kind, cost_usd=cost_usd, list_price_usd=list_usd, shipping_usd=ship_usd,
                                  product_id=product_id, source_id=self.source.id),
                self._rule(product_id, category_id))
            lineage_slugs = [self._id_to_slug.get(c, "") for c in self.ref.lineage(category_id)]
            reason = self.scope.reject(sp, price, lineage_slugs)
            if reason:
                st.filtered += 1
                continue
            offer_hash = h
            if idx is None:
                if self.scope.max_items and self.active_count >= self.scope.max_items:
                    st.filtered += 1
                    continue
                st.new += 1
                self.active_count += 1
                if product_id is None:  # brand-new product: light content (cold)
                    product_id = product_id_for(sp.gtin, key)
                    if product_id not in new_products:
                        new_products[product_id] = self._product_row(product_id, sp, category_id)
                        translations.append((product_id, self.source_locale, sp.title, sp.description,
                                             sp.bullet_points))
                        for loc, t in sp.translations.items():  # partner-provided copy is free
                            if loc in self.ref.locales:
                                translations.append((product_id, loc, t.title, t.description or sp.description,
                                                     t.bullet_points or sp.bullet_points))
                changed_pids.add(product_id)
            elif idx.content_hash != h:
                st.changed += 1
                changed_pids.add(product_id)
                if tier in ("hot", "warm"):
                    # Full treatment (detail, images, AI) happens in a job; keep the old hash
                    # until it succeeds so a failed job is retried by the next scan.
                    offer_hash = idx.content_hash
                    detail_jobs.append((sp.external_id, product_id, h))
                else:
                    products.append(self._product_row(product_id, sp, category_id))
                    translations.append((product_id, self.source_locale, sp.title, sp.description, sp.bullet_points))
            else:
                st.unchanged += 1
                if idx.is_active != (sp.stock is None or sp.stock > 0) or idx.display_price_usd != price:
                    changed_pids.add(product_id)  # price/availability changed: search must update
            local = kind == "affiliate" and sp.list_price is not None
            offers.append({
                "id": idx.id if idx else _offer_id(self.source.id, sp.external_id), "product_id": product_id,
                "source_id": self.source.id, "external_id": sp.external_id, "url": sp.url,
                "cost_usd": cost_usd if kind == "dropship" else None, "list_price_usd": list_usd,
                "shipping_usd": ship_usd, "stock": sp.stock, "ships_from": sp.ships_from, "ships_to": sp.ships_to,
                "delivery_days_min": sp.delivery_days_min, "delivery_days_max": sp.delivery_days_max,
                "commission_rate": sp.commission_rate if kind == "affiliate" else None, "last_synced_at": now,
                "is_active": sp.stock is None or sp.stock > 0, "display_price_usd": price,
                "list_price_local": Decimal(sp.list_price).quantize(CENT) if local else None,
                "list_currency": sp.currency if local else None,
                "shipping_local": Decimal(sp.shipping).quantize(CENT) if local else None,
                "content_hash": offer_hash, "refresh_tier": tier, "next_refresh_at": now + TIER_INTERVAL[tier],
            })
        self.bulk.upsert_products(list(new_products.values()) + products)
        self.bulk.upsert_translations(translations)
        self.bulk.upsert_offers(offers)
        if self.queue is not None:
            for ext, pid, h in detail_jobs:
                st.jobs_enqueued += enqueue_detail(self.queue, self.connector.code, ext, pid, h)
            st.jobs_enqueued += enqueue_reindex(self.queue, changed_pids)
        self.changed_product_ids = changed_pids
        return st

    def _rule(self, product_id, category_id):
        key = (product_id if self._product_rules else None, category_id)
        if key not in self._rule_cache:
            self._rule_cache[key] = select_markup_rule(self.ref.rules, product_id=product_id, source_id=self.source.id,
                                                       category_lineage=self.ref.lineage(category_id))
            if len(self._rule_cache) > 50_000:  # bounded
                self._rule_cache.clear()
        return self._rule_cache[key]

    def _product_row(self, product_id: str, sp: SourceProduct, category_id: str | None) -> dict:
        return {"id": product_id, "category_id": category_id, "brand": sp.brand, "gtin": sp.gtin,
                "image_urls": dedupe(sp.image_urls), "attributes": {**sp.attributes, "_sync": {"full": False}},
                "rating": sp.rating, "review_count": sp.review_count}


def _offer_id(source_id: str, external_id: str) -> str:
    from .bulkstore import offer_id_for

    return offer_id_for(source_id, external_id)


def enqueue_detail(queue: JobQueue, source_code: str, external_id: str, product_id: str, listing_hash: str | None) -> int:
    jid = queue.enqueue("fetch_detail", {"source": source_code, "external_id": external_id,
                                         "product_id": product_id, "listing_hash": listing_hash},
                        dedupe_key=f"detail:{source_code}:{external_id}", priority=5)
    return 1 if jid else 0


def enqueue_reindex(queue: JobQueue, product_ids, chunk: int = 1000) -> int:
    ids = sorted(product_ids)
    n = 0
    for i in range(0, len(ids), chunk):
        part = ids[i:i + chunk]
        key = hashlib.sha256(",".join(part).encode()).hexdigest()[:24]
        n += 1 if queue.enqueue("reindex", {"product_ids": part}, dedupe_key=f"reindex:{key}", priority=1) else 0
    return n


# ---------------------------------------------------------------------------------------------
@dataclass
class ImportResult:
    source: str
    scope: str                      # full | delta | none
    resumed_from: str | None = None
    pages: int = 0
    complete: bool = False
    stats: PageStats = field(default_factory=PageStats)
    api_calls: int = 0
    duration_s: float = 0.0
    error: str | None = None

    def as_dict(self) -> dict:
        d = asdict(self)
        return d


class ImportRun:
    """Checkpointed listing scan for one dropship source."""

    def __init__(self, bulk: SqlBulkStore, connector: Connector, *, queue: JobQueue | None = None,
                 call: Callable = lambda fn, *a: fn(*a), batch_size: int = BATCH_SIZE,
                 full_scan_every: timedelta = FULL_SCAN_EVERY, now: Callable[[], datetime] = utcnow):
        if connector.kind != "dropship":
            raise NonRetryable(f"{connector.code}: affiliate catalogues are not bulk-imported (use live search)")
        self.bulk, self.connector, self.queue, self.call = bulk, connector, queue, call
        self.batch_size, self.full_scan_every, self.now = batch_size, full_scan_every, now
        self.source = bulk.ensure_source(connector.code, connector.kind, connector.name)

    def plan(self) -> tuple[str, str | None, datetime | None, datetime | None]:
        """(scope, cursor, started_at, since)."""
        sid = self.source.id
        full = self.bulk.get_checkpoint(sid, "full")
        delta = self.bulk.get_checkpoint(sid, "delta")
        if full and full["cursor"]:
            return "full", full["cursor"], full["started_at"], None
        if delta and delta["cursor"]:
            return "delta", delta["cursor"], delta["started_at"], _ts((delta.get("stats") or {}).get("since"))
        last_full = _ts(((full or {}).get("stats") or {}).get("completed_at"))
        if last_full is None or self.now() - last_full >= self.full_scan_every:
            return "full", None, None, None
        if self.connector.supports_delta:
            since = _ts(((delta or {}).get("stats") or {}).get("since")) or _ts((full["stats"] or {}).get("started_at"))
            return "delta", None, None, since
        return "none", None, None, None

    def run(self, *, max_pages: int | None = None, heartbeat: Callable[[], None] = lambda: None) -> ImportResult:
        t0 = time.monotonic()
        scope, cursor, started, since = self.plan()
        res = ImportResult(source=self.connector.code, scope=scope, resumed_from=cursor)
        if scope == "none":
            res.complete = True
            return res
        started = started or self.now()
        sid = self.source.id
        cp = self.bulk.get_checkpoint(sid, scope)
        carried = dict((cp or {}).get("stats") or {}) if cursor else {}
        acc = PageStats(**{k: v for k, v in (carried.get("acc") or {}).items() if k in PageStats.__dataclass_fields__})
        ingestor = Ingestor(self.bulk, self.source, self.connector, queue=self.queue, now=self.now)
        calls0 = getattr(self.connector, "calls", 0)
        while True:
            page = self.call(self.connector.fetch_updates, cursor, since, self.batch_size)
            st = ingestor.process(page.items)
            acc.add(st)
            res.pages += 1
            cursor = page.next_cursor
            stats = {**carried, "acc": asdict(acc), "since": _iso(since), "started_at": _iso(started)}
            with self.bulk.transaction():  # page rows + checkpoint commit together
                self.bulk.save_checkpoint(sid, scope, cursor, started, stats)
            heartbeat()
            if cursor is None:
                break
            if max_pages is not None and res.pages >= max_pages:
                res.stats, res.duration_s = acc, round(time.monotonic() - t0, 3)
                return res
        # complete
        with self.bulk.transaction():
            if scope == "full":
                gone = self.bulk.deactivate_stale(sid, started)
                acc.deactivated += len(gone)
                if self.queue is not None and gone:
                    acc.jobs_enqueued += enqueue_reindex(self.queue, gone)
                prev = (self.bulk.get_checkpoint(sid, "full") or {}).get("stats") or {}
                self.bulk.save_checkpoint(sid, "full", None, None,
                                          {"completed_at": _iso(self.now()), "started_at": _iso(started),
                                           "last": asdict(acc), "runs": int(prev.get("runs", 0)) + 1})
                # deltas continue from the start of this scan
                self.bulk.save_checkpoint(sid, "delta", None, None, {"since": _iso(started)})
            else:
                self.bulk.save_checkpoint(sid, "delta", None, None, {"since": _iso(started), "last": asdict(acc)})
        res.complete, res.stats = True, acc
        res.api_calls = getattr(self.connector, "calls", 0) - calls0
        res.duration_s = round(time.monotonic() - t0, 3)
        return res


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def _ts(v) -> datetime | None:
    if v is None or isinstance(v, datetime):
        return v
    return datetime.fromisoformat(v)


# ---------------------------------------------------------------------------------------------
@dataclass
class ScaleContext:
    """Everything job handlers need. ``bulk`` is a factory so each worker thread gets its own connection."""

    make_bulk: Callable[[], SqlBulkStore]
    queue: JobQueue
    connectors: Mapping[str, Connector]
    enricher: Enricher
    images: ImageStore | None = None
    reindexer: Any = None
    notifier: Any = None
    call_for: Callable[[Connector], Callable] = lambda c: (lambda fn, *a: fn(*a))
    now: Callable[[], datetime] = utcnow
    batch_size: int = BATCH_SIZE
    _local: threading.local = field(default_factory=threading.local)
    results: list = field(default_factory=list)

    def bulk(self) -> SqlBulkStore:
        b = getattr(self._local, "bulk", None)
        if b is None:
            b = self._local.bulk = self.make_bulk()
        return b

    def connector(self, code: str) -> Connector:
        c = self.connectors.get(code)
        if c is None:
            raise NonRetryable(f"no connector for source {code!r}")
        return c


def plan_refresh(ctx: ScaleContext, *, limit_per_source: int = 20_000) -> int:
    """Enqueue refresh_offers jobs for due hot/warm offers (all sources, including stored affiliate items)."""
    bulk, n, now = ctx.bulk(), 0, ctx.now()
    for code, conn in ctx.connectors.items():
        src = bulk.get_source(code)
        if src is None or not src.is_active:
            continue
        due = bulk.due_offers(src.id, now, limit_per_source)
        if not due:
            continue
        size = max(1, conn.bulk_size)
        for i in range(0, len(due), size):
            chunk = due[i:i + size]
            exts = [r["external_id"] for r in chunk]
            key = hashlib.sha256(("|".join(exts)).encode()).hexdigest()[:24]
            if ctx.queue.enqueue("refresh_offers", {"source": code, "external_ids": exts},
                                 dedupe_key=f"refresh:{code}:{key}", priority=8):
                n += 1
        # Not due again until the job has had time to run; the job sets the real next date.
        with bulk.transaction():
            for tier in ("hot", "warm"):
                ids = [str(r["id"]) for r in due if r["refresh_tier"] == tier]
                bulk.set_next_refresh(ids, now + TIER_INTERVAL[tier])
    return n


def promote_detail_jobs(ctx: ScaleContext, product_ids: list[str]) -> int:
    """Products that just became hot/warm get the full treatment (detail, images, AI)."""
    if not product_ids:
        return 0
    bulk, n = ctx.bulk(), 0
    for i in range(0, len(product_ids), 1000):
        frag, params = bulk._in(product_ids[i:i + 1000], "uuid")
        rows = bulk.query(bulk._q(
            "select o.external_id, o.product_id, o.content_hash, s.code from offers o join sources s on s.id = o.source_id "
            f"where o.is_active and o.product_id in {frag}"), params)
        for r in rows:
            if r["code"] in ctx.connectors:
                n += enqueue_detail(ctx.queue, r["code"], r["external_id"], str(r["product_id"]), r["content_hash"])
    return n


def pricing_fingerprint(bulk: SqlBulkStore, source_id: str) -> str:
    """Changes whenever a markup rule or an FX rate that can affect this source's prices changes."""
    rules = sorted((str(r.id), r.scope, str(r.scope_id), str(r.percent), str(r.fixed_usd), str(r.round_to),
                    r.priority, r.is_active) for r in bulk.ref.rules
                   if r.scope != "source" or str(r.scope_id) == str(source_id))
    fx = sorted((k, str(v)) for k, v in bulk.ref.fx.items())
    return hashlib.sha256(repr((rules, fx)).encode()).hexdigest()[:24]


def plan_reprice(ctx: ScaleContext) -> int:
    """Enqueue a reprice job for every source whose pricing inputs changed since its last reprice."""
    bulk, n = ctx.bulk(), 0
    for src in bulk.list_sources():
        fp = pricing_fingerprint(bulk, src.id)
        cp = bulk.get_checkpoint(src.id, "pricing")
        if cp is None:  # first run: offers were priced with the current inputs
            with bulk.transaction():
                bulk.save_checkpoint(src.id, "pricing", None, None, {"fingerprint": fp})
            continue
        if (cp.get("stats") or {}).get("fingerprint") != fp:
            n += 1 if ctx.queue.enqueue("reprice", {"source_id": src.id, "fingerprint": fp},
                                        dedupe_key=f"reprice:{src.id}", priority=7) else 0
    return n


def reprice_source(bulk: SqlBulkStore, source_id: str, *, queue: JobQueue | None = None, page: int = 1000,
                   heartbeat: Callable[[], None] = lambda: None) -> int:
    """Recompute display_price_usd (and list_price_usd from the partner's local price, which
    FX moves) for every offer of a source, streaming by keyset. Returns offers changed."""
    from ..pricing import select_markup_rule

    ref, after, changed = bulk.ref, None, 0
    src_kind = next((s.kind for s in bulk.list_sources() if s.id == source_id), "dropship")
    while True:
        rows = bulk.offers_for_reprice(source_id, after, page)
        if not rows:
            return changed
        updates, pids = [], set()
        for r in rows:
            list_usd, ship_usd = r["list_price_usd"], r["shipping_usd"] or Decimal(0)
            if r["list_price_local"] is not None and r["list_currency"]:
                rate = ref.fx_rate(r["list_currency"])
                if rate:
                    list_usd = (r["list_price_local"] / rate).quantize(CENT, rounding=ROUND_HALF_UP)
                    if r["shipping_local"] is not None:
                        ship_usd = (r["shipping_local"] / rate).quantize(CENT, rounding=ROUND_HALF_UP)
            rule = select_markup_rule(ref.rules, product_id=r["product_id"], source_id=source_id,
                                      category_lineage=ref.lineage(r["category_id"]))
            try:
                price = display_price_usd_for_rule(OfferPricingInput(
                    kind=src_kind, cost_usd=r["cost_usd"], list_price_usd=list_usd, shipping_usd=ship_usd), rule)
            except ValueError:
                continue
            if price != r["display_price_usd"] or list_usd != r["list_price_usd"]:
                updates.append((list_usd, ship_usd, price, r["id"]))
                pids.add(r["product_id"])
        with bulk.transaction():
            bulk.update_prices(updates)
        if queue is not None and pids:
            enqueue_reindex(queue, pids)
        changed += len(updates)
        after = rows[-1]["id"]
        heartbeat()


# ---- job handlers -----------------------------------------------------------------------------
def make_handlers(ctx: ScaleContext) -> dict[str, Callable[[Job, Callable[[], None]], Any]]:
    def import_source(job: Job, heartbeat):
        conn = ctx.connector(job.payload["source"])
        run = ImportRun(ctx.bulk(), conn, queue=ctx.queue, call=ctx.call_for(conn), batch_size=ctx.batch_size,
                        now=ctx.now)
        res = run.run(max_pages=job.payload.get("max_pages"), heartbeat=heartbeat)
        ctx.results.append(res)
        if not res.complete and job.payload.get("max_pages") is None:
            raise RuntimeError("import incomplete")  # retried; resumes from checkpoint
        return res

    def refresh_offers(job: Job, heartbeat):
        code, exts = job.payload["source"], list(job.payload["external_ids"])
        conn, bulk = ctx.connector(code), ctx.bulk()
        src = bulk.get_source(code)
        items = ctx.call_for(conn)(conn.fetch_offers, exts)
        with bulk.transaction():
            ing = Ingestor(bulk, src, conn, queue=ctx.queue, now=ctx.now)
            ing.process(items)
            gone = sorted(set(exts) - {i.external_id for i in items})
            if gone:
                bulk.deactivate_offers(src.id, gone)
                rows = [bulk.offer_by_external(src.id, e) for e in gone]
                enqueue_reindex(ctx.queue, {str(r["product_id"]) for r in rows if r})

    def fetch_detail(job: Job, heartbeat):
        p = job.payload
        conn, bulk = ctx.connector(p["source"]), ctx.bulk()
        src = bulk.get_source(p["source"])
        detail = ctx.call_for(conn)(conn.fetch_detail, p["external_id"])
        if detail is None:
            return
        detail = customer_copy(detail)
        product = bulk.get_product(p["product_id"])
        if product is None:
            raise NonRetryable(f"product {p['product_id']} not found")
        attrs = dict(product["attributes"])
        meta = dict(attrs.pop("_sync", None) or {})
        attrs.update(detail.attributes)
        old_text = meta.get("text_hash")
        new_text = text_hash(detail)
        meta.update(full=True, text_hash=new_text)
        with bulk.transaction():
            bulk.upsert_products([{"id": product["id"], "category_id": product["category_id"],
                                   "brand": detail.brand or product.get("brand"), "gtin": detail.gtin or product.get("gtin"),
                                   "image_urls": dedupe(detail.image_urls) or product["image_urls"],
                                   "attributes": {**attrs, "_sync": meta}, "rating": detail.rating,
                                   "review_count": detail.review_count}])
            bulk.upsert_translations([(product["id"], "en", detail.title, detail.description, detail.bullet_points)])
            if p.get("listing_hash"):
                bulk.execute(bulk._q("update offers set content_hash = ? where source_id = ? and external_id = ?"),
                             (p["listing_hash"], src.id, p["external_id"]))
        if old_text != new_text or not product.get("category_id"):
            ctx.queue.enqueue("translate", {"product_id": product["id"], "locales": list(bulk.ref.locales)},
                              dedupe_key=f"translate:{product['id']}:all", priority=3)
        if conn.kind == "dropship":
            ctx.queue.enqueue("mirror_images", {"product_id": product["id"], "source": conn.code},
                              dedupe_key=f"mirror:{product['id']}", priority=2)
        enqueue_reindex(ctx.queue, [product["id"]])

    def translate(job: Job, heartbeat):
        bulk = ctx.bulk()
        pid = job.payload["product_id"]
        product = bulk.get_product(pid)
        if product is None:
            raise NonRetryable(f"product {pid} not found")
        tr = bulk.get_translations(pid)
        src = tr.get("en") or next(iter(tr.values()), None)
        if src is None:
            raise NonRetryable(f"product {pid} has no source text")
        sp = SourceProduct(external_id=pid, title=src["title"], description=src["description"],
                           bullet_points=src["bullet_points"], brand=product.get("brand"))
        locales = [loc for loc in job.payload.get("locales") or bulk.ref.locales if loc != "en" or "en" not in tr]
        result = ctx.enricher.enrich(sp, bulk.ref.categories, locales)
        with bulk.transaction():
            bulk.upsert_translations([(pid, loc, t.title, t.description, t.bullet_points)
                                      for loc, t in result.translations.items() if loc in locales])
            if not product.get("category_id") and result.category_slug in bulk.ref.slug_to_id:
                bulk.set_product_category(pid, bulk.ref.slug_to_id[result.category_slug])
        enqueue_reindex(ctx.queue, [pid])

    def mirror_images(job: Job, heartbeat):
        if ctx.images is None:
            return
        bulk = ctx.bulk()
        product = bulk.get_product(job.payload["product_id"])
        if product is None:
            raise NonRetryable("product not found")
        attrs = dict(product["attributes"])
        meta = dict(attrs.pop("_sync", None) or {})
        urls, mirrors, failures = ctx.images.mirror(job.payload["source"], product["image_urls"], meta.get("mirrors"))
        meta["mirrors"] = mirrors
        with bulk.transaction():
            bulk.upsert_products([{**{k: product.get(k) for k in ("id", "category_id", "brand", "gtin", "rating",
                                                                  "review_count")},
                                   "image_urls": urls, "attributes": {**attrs, "_sync": meta}}])
        if failures:
            raise RuntimeError(f"{len(failures)} image(s) failed; retrying")

    def reprice(job: Job, heartbeat):
        bulk = ctx.bulk()
        sid = job.payload["source_id"]
        n = reprice_source(bulk, sid, queue=ctx.queue, heartbeat=heartbeat)
        with bulk.transaction():
            bulk.save_checkpoint(sid, "pricing", None, None,
                                 {"fingerprint": job.payload.get("fingerprint") or pricing_fingerprint(bulk, sid),
                                  "last_changed": n})

    def reindex(job: Job, heartbeat):
        if ctx.reindexer is not None:
            ctx.reindexer.reindex(list(job.payload["product_ids"]))

    def notify(job: Job, heartbeat):
        if ctx.notifier is None:
            return
        info = TrackingInfo.model_validate(job.payload["tracking"])
        if not ctx.notifier.notify(job.payload["order_id"], info) and not ctx.notifier.mock:
            raise RuntimeError("concierge notify failed")

    return {"import_source": import_source, "refresh_offers": refresh_offers, "fetch_detail": fetch_detail,
            "translate": translate, "mirror_images": mirror_images, "reindex": reindex, "notify": notify,
            "reprice": reprice}
