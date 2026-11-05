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

import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

from .connectors import Connector
from .enrich import Enricher
from .models import SourceProduct, Translation
from .pricing import PricingError, display_price_usd
from .store import OfferWrite, ProductWrite, Store, utcnow

log = logging.getLogger(__name__)
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

    def as_dict(self) -> dict:
        d = asdict(self)
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
            r"|jumia(?:\.[a-z.]+)?|flipkart|noon\.com|cj)")
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


def sync_source(
    store: Store,
    connector: Connector,
    enricher: Enricher,
    *,
    max_pages: int | None = None,
    now: datetime | None = None,
) -> SourceReport:
    run_started = now or utcnow()
    report = SourceReport(source=connector.code, kind=connector.kind, mock=connector.mock)
    source = store.get_source(connector.code) or store.ensure_source(connector.code, connector.kind, connector.name)
    if source.kind != connector.kind:
        report.error = f"sources.kind={source.kind} disagrees with connector kind={connector.kind}"
        return report

    categories = store.list_categories()
    slug_to_id = {c.slug: c.id for c in categories}
    locales = store.active_locales()
    rules = store.list_markup_rules()

    page: int | None = 1
    try:
        while page is not None:
            if max_pages is not None and report.pages >= max_pages:
                break
            result = connector.fetch_products(page)
            report.pages += 1
            for sp in result.items:
                report.items += 1
                try:
                    report.offers.append(
                        _sync_item(store, connector, source.id, sp, enricher, categories, slug_to_id,
                                   locales, rules, run_started, report))
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
        report.stale_deactivated = store.deactivate_stale_offers(source.id, run_started)
        store.commit()
    return report


def _sync_item(store, connector, source_id, sp: SourceProduct, enricher, categories, slug_to_id, locales,
               rules, run_started, report: SourceReport) -> OfferResult:
    _validate(sp, connector.kind)
    sp = customer_copy(sp)
    cost_usd = to_usd(sp.cost, sp.currency, store)
    list_usd = to_usd(sp.list_price, sp.currency, store)
    ship_usd = to_usd(sp.shipping, sp.currency, store) or Decimal(0)

    product_id = store.find_product_for_offer(source_id, sp.external_id)
    own_product = product_id is not None
    created = False
    if product_id is None and sp.gtin:
        product_id = store.find_product_by_gtin(sp.gtin)
    pw = ProductWrite(brand=sp.brand, gtin=sp.gtin, image_urls=list(sp.image_urls), attributes=dict(sp.attributes),
                      rating=sp.rating, review_count=sp.review_count,
                      origin_key=f"{connector.code}:{sp.external_id}")

    # What does the enricher need to do?
    source_text = Translation(title=sp.title, description=sp.description, bullet_points=list(sp.bullet_points))
    if product_id is None:
        created, target_locales, need_category = True, list(locales), True
    else:
        have = store.translation_locales(product_id)
        changed = own_product and store.get_translation(product_id, sp.locale) != source_text
        target_locales = list(locales) if changed else [loc for loc in locales if loc not in have]
        need_category = store.get_product_category(product_id) is None

    enrichment = None
    if target_locales or need_category:
        enrichment = enricher.enrich(sp, categories, target_locales)
        if need_category and enrichment.category_slug:
            pw.category_id = slug_to_id.get(enrichment.category_slug)

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
    offer_id = store.upsert_offer(OfferWrite(
        product_id=product_id, source_id=source_id, external_id=sp.external_id, url=sp.url,
        cost_usd=cost_usd if connector.kind == "dropship" else None,
        list_price_usd=list_usd, shipping_usd=ship_usd, stock=sp.stock, ships_from=sp.ships_from,
        ships_to=list(sp.ships_to), delivery_days_min=sp.delivery_days_min,
        delivery_days_max=sp.delivery_days_max,
        commission_rate=sp.commission_rate if connector.kind == "affiliate" else None,
        last_synced_at=run_started, is_active=is_active,
        # Keep the partner's own-currency price so it displays exactly in that currency (0006).
        list_price_local=(Decimal(sp.list_price).quantize(CENT, rounding=ROUND_HALF_UP)
                          if connector.kind == "affiliate" and sp.list_price is not None else None),
        list_currency=sp.currency if connector.kind == "affiliate" and sp.list_price is not None else None,
        shipping_local=(Decimal(sp.shipping).quantize(CENT, rounding=ROUND_HALF_UP)
                        if connector.kind == "affiliate" and sp.list_price is not None else None)))
    report.offers_upserted += 1

    offer = store.get_offer(offer_id)
    price = display_price_usd(offer.pricing_input(), rules=rules,
                              category_lineage=store.category_lineage(offer.category_id))
    store.set_display_price(offer_id, price)
    cat_slug = next((c.slug for c in categories if c.id == offer.category_id), None)
    return OfferResult(source=connector.code, external_id=sp.external_id, offer_id=str(offer_id),
                       product_id=str(product_id), kind=connector.kind, title=sp.title, category=cat_slug,
                       display_price_usd=price, is_active=is_active, product_created=created)


def sync_many(store: Store, connectors: Iterable[Connector], enricher: Enricher, **kwargs) -> list[SourceReport]:
    return [sync_source(store, c, enricher, **kwargs) for c in connectors]
