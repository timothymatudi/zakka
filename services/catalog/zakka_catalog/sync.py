"""Sync connectors into Postgres (or a MemoryStore for dry runs).

Per item:
1. normalise amounts to USD with fx_rates (fx_rates.rate is USD -> quote, so usd = amount / rate);
2. find the product: existing offer (source_id, external_id) -> same product;
   else same GTIN from any source -> attach this offer to that product
   (cross-source dedupe); else create a product;
3. categorise + translate via the enricher when the product is new, its
   source text changed, it has no category, or locales are missing;
4. upsert the offer (is_active = stock is unknown or > 0);
5. compute display_price_usd with pricing.py (written to offers.display_price_usd
   if that column exists, and always returned in the report for indexing).

After a *complete* run of a source, its offers not seen in this run are marked
inactive (stale). Partial runs (``max_pages``) or fetch errors never deactivate.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Iterable
from uuid import UUID

from .connectors import CONNECTORS, Connector
from .images import ImageStore, dedupe
from .enrich import Enricher
from .models import SourceProduct
from .pricing import PricingError, display_price_usd
from .store import OfferWrite, ProductWrite, Store, utcnow

log = logging.getLogger(__name__)
_AFFILIATE_CODES = frozenset(c for c, k in CONNECTORS.items() if k.kind == "affiliate")
CENT = Decimal("0.01")


class SyncItemError(ValueError):
    pass


@dataclass
class OfferResult:
    source: str
    external_id: str
    offer_id: str
    product_id: str
    kind: str
    title: str
    category: str | None
    display_price_usd: Decimal | None
    is_active: bool
    product_created: bool


@dataclass
class SourceReport:
    source: str
    kind: str
    mock: bool
    pages: int = 0
    items: int = 0
    products_created: int = 0
    products_matched: int = 0
    offers_upserted: int = 0
    translations_written: int = 0
    stale_deactivated: int = 0
    complete: bool = False
    skipped: list[str] = field(default_factory=list)
    error: str | None = None
    offers: list[OfferResult] = field(default_factory=list)
    details_fetched: int = 0
    detail_failures: list[str] = field(default_factory=list)
    enriched: int = 0
    images_mirrored: int = 0
    image_failures: int = 0
    changed_product_ids: set[str] = field(default_factory=set)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["changed_product_ids"] = sorted(self.changed_product_ids)
        for o in d["offers"]:
            o["display_price_usd"] = str(o["display_price_usd"]) if o["display_price_usd"] is not None else None
        return d


def to_usd(amount: Decimal | None, currency: str, store: Store) -> Decimal | None:
    if amount is None:
        return None
    rate = store.get_fx_rate(currency)
    if rate is None or rate <= 0:
        raise SyncItemError(f"no fx rate USD->{currency}")
    return (Decimal(amount) / rate).quantize(CENT, rounding=ROUND_HALF_UP)


# Contract: customer-facing text never shows supplier/partner names. Product copy we store
# (titles, descriptions, bullets, brand) is customer-facing, so partner names are removed.
# "noon" is only matched as a domain (it is an ordinary English word).
_PARTNER = (r"(?:cj\s*dropshipping|aliexpress|spocket|printful|amazon(?:\.[a-z.]+)?|temu|shein"
            r"|jumia(?:\.[a-z.]+)?|flipkart|noon\.com|ebay(?:\.[a-z.]+)?|awin|rakuten|admitad|impact\.com|mercado\s*li[bv]re|shopee|lazada|coupang|commission\s*junction|cj)")
_PARTNER_RE = re.compile(rf"(?i)\b{_PARTNER}\b")
# A partner mention plus the words that only exist to introduce it ("Sold on X", "ships from X").
_MENTION_RE = re.compile(
    r"(?i)(?:\b(?:sold|ships|shipped|delivered|fulfilled|available|buy|only|exclusively)\s+)?"
    rf"(?:\b(?:on|by|from|via|at|in)\s+)?\b{_PARTNER}\b")
_SEP = r"[-\u2013\u2014|/\u2022\u00b7:;,]"


def scrub_partner_names(text: str | None) -> str | None:
    """Remove partner names without leaving stray separators or whitespace."""
    if text is None:
        return None
    if not _PARTNER_RE.search(text):  # fast path: the vast majority of texts
        return text
    out = _MENTION_RE.sub(" ", text)
    out = re.sub(r"\(\s*\)|\[\s*\]", " ", out)                   # emptied brackets
    out = re.sub(rf"\s*({_SEP})(?:\s*{_SEP})+", r" \1", out)       # "a | | b" -> "a | b"
    out = re.sub(r"([(\[])\s+", r"\1", out)                       # "( x" -> "(x"
    out = re.sub(r"\s+([)\].,;:!?])", r"\1", out)                  # "x ." -> "x."
    out = re.sub(r"\s{2,}", " ", out)
    out = re.sub(rf"^(?:\s|{_SEP})+|(?:\s|{_SEP})+$", "", out)     # trim edge separators
    return out


def customer_copy(sp: SourceProduct) -> SourceProduct:
    """Copy of ``sp`` whose customer-facing fields contain no partner names."""
    texts = [sp.title, sp.description or "", sp.brand or "", *sp.bullet_points,
             *(t.title for t in sp.translations.values())]
    if not any(_PARTNER_RE.search(t) for t in texts):
        return sp
    brand = sp.brand
    if brand and _PARTNER_RE.search(brand):
        brand = None  # e.g. a retailer's own label: don't name the partner
    title = scrub_partner_names(sp.title)
    if not title:
        raise SyncItemError("title is only a partner name")
    return sp.model_copy(update={
        "title": title,
        "description": scrub_partner_names(sp.description),
        "bullet_points": [b for b in (scrub_partner_names(x) for x in sp.bullet_points) if b],
        "brand": brand,
        "translations": {loc: t.model_copy(update={"title": scrub_partner_names(t.title) or title})
                         for loc, t in sp.translations.items()},
    })


def _validate(sp: SourceProduct, kind: str) -> None:
    if kind == "dropship" and sp.cost is None:
        raise SyncItemError("dropship item without cost")
    if kind == "affiliate" and (sp.list_price is None or not sp.url):
        raise SyncItemError("affiliate item without list_price/url")
    if not sp.ships_to:
        raise SyncItemError("item ships nowhere (empty ships_to)")
    if (sp.delivery_days_min is not None and sp.delivery_days_max is not None
            and sp.delivery_days_min > sp.delivery_days_max):
        raise SyncItemError("delivery_days_min > delivery_days_max")


def _direct_call(fn, *args):
    return fn(*args)


@dataclass
class SyncOptions:
    """Extras used by the scheduler. Defaults keep ``sync`` cheap (listing data only)."""

    fetch_detail: bool = False          # fetch full detail for new/changed items
    images: ImageStore | None = None    # mirror dropship images (None: keep supplier URLs)
    call: Callable = _direct_call       # wrapper for connector calls (retry/backoff/throttle)


def content_hash(sp: SourceProduct) -> str:
    """Hash of the listing content that decides whether an item is new/changed.
    Price, stock and rating are excluded: they refresh every run without re-enrichment."""
    data = {"title": sp.title, "description": sp.description, "bullets": sp.bullet_points, "brand": sp.brand,
            "gtin": sp.gtin, "images": sp.image_urls, "attributes": sp.attributes, "category": sp.category_hint}
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:32]


def text_hash(sp: SourceProduct) -> str:
    data = [sp.title, sp.description, sp.bullet_points]
    return hashlib.sha256(json.dumps(data, default=str).encode()).hexdigest()[:32]


def merge_detail(listing: SourceProduct, detail: SourceProduct) -> SourceProduct:
    """Listing data enriched with the detail call: all images (listing first, then gallery,
    deduped, order kept), longer description, bullets, attributes/specs/variants, brand, GTIN,
    rating and review count. Commercial fields (price, stock, shipping) stay from the listing."""
    return listing.model_copy(update={
        "image_urls": dedupe(list(listing.image_urls) + list(detail.image_urls)),
        "description": detail.description if len(detail.description or "") > len(listing.description or "")
        else listing.description,
        "bullet_points": detail.bullet_points or listing.bullet_points,
        "attributes": {**listing.attributes, **detail.attributes},
        "brand": detail.brand or listing.brand,
        "gtin": detail.gtin or listing.gtin,
        "rating": detail.rating if detail.rating is not None else listing.rating,
        "review_count": detail.review_count or listing.review_count,
    })


def sync_source(
    store: Store,
    connector: Connector,
    enricher: Enricher,
    *,
    max_pages: int | None = None,
    now: datetime | None = None,
    options: SyncOptions | None = None,
) -> SourceReport:
    options = options or SyncOptions()
    run_started = now or utcnow()
    report = SourceReport(source=connector.code, kind=connector.kind, mock=connector.mock)
    source = store.get_source(connector.code) or store.ensure_source(connector.code, connector.kind, connector.name)
    if source.kind != connector.kind:
        report.error = f"sources.kind={source.kind} disagrees with connector kind={connector.kind}"
        return report

    ctx = _Ctx(store=store, connector=connector, source_id=source.id, enricher=enricher,
               categories=store.list_categories(), locales=store.active_locales(),
               rules=store.list_markup_rules(), run_started=run_started, report=report, options=options)
    ctx.slug_to_id = {c.slug: c.id for c in ctx.categories}

    page: int | None = 1
    try:
        while page is not None:
            if max_pages is not None and report.pages >= max_pages:
                break
            result = options.call(connector.fetch_products, page)
            report.pages += 1
            for sp in result.items:
                report.items += 1
                try:
                    report.offers.append(_sync_item(ctx, sp))
                except (SyncItemError, PricingError, ValueError) as exc:
                    report.skipped.append(f"{sp.external_id}: {exc}")
            store.commit()
            page = result.next_page
        report.complete = page is None
    except Exception as exc:  # fetch/auth failure: keep what we have, never mark stale
        log.exception("sync %s failed", connector.code)
        report.error = f"{type(exc).__name__}: {exc}"
        store.commit()
        return report

    if report.complete:
        stale = [o for o in store.list_offers(source.id)
                 if o.last_synced_at is None or o.last_synced_at < run_started]
        report.stale_deactivated = store.deactivate_stale_offers(source.id, run_started)
        report.changed_product_ids.update(str(o.product_id) for o in stale)
        store.commit()
    return report


@dataclass
class _Ctx:
    store: Store
    connector: Connector
    source_id: UUID
    enricher: Enricher
    categories: list
    locales: list[str]
    rules: list
    run_started: datetime
    report: SourceReport
    options: SyncOptions
    slug_to_id: dict = field(default_factory=dict)


def _offer_state(o) -> tuple | None:
    if o is None:
        return None
    return (o.cost_usd, o.list_price_usd, o.shipping_usd, o.stock, o.is_active, tuple(o.ships_to), o.ships_from,
            o.delivery_days_min, o.delivery_days_max, o.url, o.list_price_local, o.shipping_local, o.list_currency)


def _sync_item(ctx: _Ctx, sp: SourceProduct) -> OfferResult:
    store, connector, report, kind = ctx.store, ctx.connector, ctx.report, ctx.connector.kind
    _validate(sp, kind)
    key = f"{connector.code}:{sp.external_id}"
    before = store.get_offer_by_external(ctx.source_id, sp.external_id)
    product_id = before.product_id if before else None
    if product_id is None and sp.gtin:
        product_id = store.find_product_by_gtin(sp.gtin)
    created = product_id is None
    existing = store.get_product(product_id) if product_id else None
    attrs = dict((existing or {}).get("attributes") or {})
    meta = dict(attrs.pop("_sync", None) or {})
    offer_hashes = dict(meta.get("offers") or {})
    owner = meta.get("content_owner")
    is_owner = created or owner in (None, key)

    listing_hash = content_hash(sp)
    changed = created or offer_hashes.get(key) != listing_hash
    if changed and ctx.options.fetch_detail:
        try:
            detail = ctx.options.call(connector.fetch_detail, sp.external_id)
            if detail is not None:
                sp = merge_detail(sp, detail)
                report.details_fetched += 1
        except Exception as exc:  # keep listing data; retried next run (hash not stored on failure)
            report.detail_failures.append(f"{sp.external_id}: {type(exc).__name__}: {exc}")
            listing_hash = None
    sp = customer_copy(sp)

    cost_usd = to_usd(sp.cost, sp.currency, store)
    list_usd = to_usd(sp.list_price, sp.currency, store)
    ship_usd = to_usd(sp.shipping, sp.currency, store) or Decimal(0)

    # --- enrichment: only for new products or the owner's changed text -------------
    new_text_hash = text_hash(sp)
    retranslate = created or (is_owner and changed and meta.get("text_hash") != new_text_hash)
    if created:
        target_locales, need_category = list(ctx.locales), True
    else:
        have = store.translation_locales(product_id)
        target_locales = list(ctx.locales) if retranslate else [loc for loc in ctx.locales if loc not in have]
        need_category = existing.get("category_id") is None
    enrichment = None
    if target_locales or need_category:
        enrichment = ctx.enricher.enrich(sp, ctx.categories, target_locales)
        report.enriched += 1

    # --- images ---------------------------------------------------------------------
    image_owner = meta.get("image_owner")
    images = list((existing or {}).get("image_urls") or [])
    mirrors = dict(meta.get("mirrors") or {})
    if kind == "dropship":
        # Mirror into our storage; dropship images win over partner images.
        if image_owner in (None, key) or str(image_owner).split(":")[0] in _AFFILIATE_CODES:
            if ctx.options.images is not None:
                urls, mirrors, failures = ctx.options.images.mirror(connector.code, sp.image_urls, mirrors)
                report.image_failures += len(failures)
                report.images_mirrored += sum(1 for u in dedupe(sp.image_urls) if u not in failures)
            else:
                urls = dedupe(sp.image_urls)
            images, image_owner = urls, key
    elif image_owner in (None, key):
        # Affiliate programs require their own image URLs: never re-host; refresh every run.
        images, image_owner = dedupe(sp.image_urls), key

    # --- product write ---------------------------------------------------------------
    if is_owner and (changed or created):
        attrs.update(sp.attributes)
    if listing_hash is not None:
        offer_hashes[key] = listing_hash
    meta.update(offers=offer_hashes, image_owner=image_owner, mirrors=mirrors,
                content_owner=owner or key)
    if retranslate or created:
        meta["text_hash"] = new_text_hash
    pw = ProductWrite(
        brand=sp.brand if is_owner else (existing or {}).get("brand"),
        gtin=sp.gtin if is_owner else (existing or {}).get("gtin"),
        image_urls=images, attributes={**attrs, "_sync": meta},
        rating=sp.rating if is_owner else (existing or {}).get("rating"),
        review_count=sp.review_count if is_owner else (existing or {}).get("review_count", 0),
        origin_key=key)
    if need_category and enrichment and enrichment.category_slug:
        pw.category_id = ctx.slug_to_id.get(enrichment.category_slug)
    content_changed = created or (is_owner and changed) or images != list((existing or {}).get("image_urls") or [])

    if created:
        product_id = store.insert_product(pw)
        report.products_created += 1
    else:
        store.update_product(product_id, pw)
        report.products_matched += 1

    if enrichment:
        for loc in target_locales:
            t = enrichment.translations.get(loc)
            if t:
                store.upsert_translation(product_id, loc, t)
                report.translations_written += 1

    is_active = sp.stock is None or sp.stock > 0
    affiliate_local = kind == "affiliate" and sp.list_price is not None
    offer_id = store.upsert_offer(OfferWrite(
        product_id=product_id, source_id=ctx.source_id, external_id=sp.external_id, url=sp.url,
        cost_usd=cost_usd if kind == "dropship" else None,
        list_price_usd=list_usd, shipping_usd=ship_usd, stock=sp.stock, ships_from=sp.ships_from,
        ships_to=list(sp.ships_to), delivery_days_min=sp.delivery_days_min,
        delivery_days_max=sp.delivery_days_max,
        commission_rate=sp.commission_rate if kind == "affiliate" else None,
        last_synced_at=ctx.run_started, is_active=is_active,
        # Keep the partner's own-currency price so it displays exactly in that currency (0006).
        list_price_local=Decimal(sp.list_price).quantize(CENT, rounding=ROUND_HALF_UP) if affiliate_local else None,
        list_currency=sp.currency if affiliate_local else None,
        shipping_local=Decimal(sp.shipping).quantize(CENT, rounding=ROUND_HALF_UP) if affiliate_local else None))
    report.offers_upserted += 1

    offer = store.get_offer(offer_id)
    if content_changed or _offer_state(before) != _offer_state(offer):
        report.changed_product_ids.add(str(product_id))
    price = display_price_usd(offer.pricing_input(), rules=ctx.rules,
                              category_lineage=store.category_lineage(offer.category_id))
    store.set_display_price(offer_id, price)
    cat_slug = next((c.slug for c in ctx.categories if c.id == offer.category_id), None)
    return OfferResult(source=connector.code, external_id=sp.external_id, offer_id=str(offer_id),
                       product_id=str(product_id), kind=kind, title=sp.title, category=cat_slug,
                       display_price_usd=price, is_active=is_active, product_created=created)


def ingest_items(store: Store, connector: Connector, items: Iterable[SourceProduct], enricher: Enricher, *,
                 options: SyncOptions | None = None) -> SourceReport:
    """Write specific items (no listing scan, no stale marking): JIT refreshes and
    affiliate items a customer actually saw or clicked."""
    report = SourceReport(source=connector.code, kind=connector.kind, mock=connector.mock)
    source = store.get_source(connector.code) or store.ensure_source(connector.code, connector.kind, connector.name)
    ctx = _Ctx(store=store, connector=connector, source_id=source.id, enricher=enricher,
               categories=store.list_categories(), locales=store.active_locales(), rules=store.list_markup_rules(),
               run_started=utcnow(), report=report, options=options or SyncOptions())
    ctx.slug_to_id = {c.slug: c.id for c in ctx.categories}
    for sp in items:
        report.items += 1
        try:
            report.offers.append(_sync_item(ctx, sp))
        except (SyncItemError, PricingError, ValueError) as exc:
            report.skipped.append(f"{sp.external_id}: {exc}")
    store.commit()
    return report


def sync_many(store: Store, connectors: Iterable[Connector], enricher: Enricher, **kwargs) -> list[SourceReport]:
    return [sync_source(store, c, enricher, **kwargs) for c in connectors]
