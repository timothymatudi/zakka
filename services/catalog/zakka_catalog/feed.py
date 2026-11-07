"""Merchant product feeds (Google Merchant Center format).

``python -m zakka_catalog feed --country KE --locale sw --format google-xml --out feed.xml``

One feed per (country, locale). It lists only **dropship** offers (Zakka is the
seller) that are active, priced and ship to the country. Affiliate offers are never
included: those products are sold by partners, who list them themselves.

The same Google-format feed is used for Google free listings / AI Mode / Gemini and
for Perplexity's merchant program (see README). Output is streamed item by item from
``Store.iter_feed_rows`` (keyset-paginated in Postgres), so memory stays bounded for
a million offers.

Customer-facing rules (docs/CONTRACT.md): titles, descriptions and brands go through
``scrub_partner_names``; a partner brand becomes "Zakka". Image links go through the
storefront's ``/img/{product_id}/{n}`` redirect, because mirrored object paths start
with the source code.

Formats:
* ``google-xml``  RSS 2.0 + ``g:`` namespace (recommended: carries per-item handling
  and transit days inside ``g:shipping``)
* ``google-tsv``  tab-separated, Google attribute names as headers
* ``jsonl``       one JSON object per item (same fields; shipping as an object)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterator, TextIO
from urllib.parse import quote as urlquote
from uuid import UUID
from xml.sax.saxutils import escape as xml_escape

from .pricing import PricingError, quote
from .store import FeedCategory, FeedRow, Store
from .sync import _PARTNER_RE, scrub_partner_names

FORMATS = ("google-xml", "google-tsv", "jsonl")
CONTENT_TYPES = {"google-xml": "application/xml; charset=utf-8",
                 "google-tsv": "text/tab-separated-values; charset=utf-8",
                 "jsonl": "application/x-ndjson; charset=utf-8"}
SUFFIX_FORMATS = {"xml": "google-xml", "tsv": "google-tsv", "jsonl": "jsonl"}

SELLER_BRAND = "Zakka"
MAX_TITLE = 150
MAX_DESCRIPTION = 5000
MAX_ADDITIONAL_IMAGES = 10
# delivery_days_min/max are door-to-door estimates. Google splits them into handling
# (order to dispatch) and transit; we attribute one day to handling and the rest to
# transit, so handling + transit always equals our published estimate.
HANDLING_DAYS = 1

TSV_COLUMNS = ("id", "title", "description", "link", "image_link", "additional_image_link", "availability",
               "price", "brand", "gtin", "identifier_exists", "condition", "google_product_category",
               "product_type", "shipping", "min_handling_time", "max_handling_time")

_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffe\uffff]")
_WS_RE = re.compile(r"\s+")


@dataclass
class FeedStats:
    items: int = 0
    skipped: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def clean_text(text: str | None, limit: int) -> str:
    """Partner names removed, control characters dropped, whitespace collapsed, truncated."""
    out = scrub_partner_names(text or "") or ""
    out = _WS_RE.sub(" ", _CTRL_RE.sub(" ", out)).strip()
    if len(out) > limit:
        out = out[: limit - 1].rstrip() + "\u2026"
    return out


def feed_brand(brand: str | None) -> str:
    """Product brand, never a partner name; fallback "Zakka" (Zakka is the seller)."""
    b = clean_text(brand, 70)
    if not b or _PARTNER_RE.search(brand or ""):
        return SELLER_BRAND
    return b


def format_price(amount: Decimal, currency: str, decimals: int) -> str:
    return f"{amount.quantize(Decimal(1).scaleb(-decimals)):.{decimals}f} {currency}"


class _Categories:
    def __init__(self, cats: dict[UUID, FeedCategory]):
        self.cats = cats
        self._paths: dict[UUID, tuple[str, int | None]] = {}

    def info(self, category_id: UUID | None) -> tuple[str, int | None]:
        """(product_type "A > B > C", nearest google_category_id) for a category."""
        if not category_id or category_id not in self.cats:
            return "", None
        if category_id not in self._paths:
            names, google, cur, seen = [], None, category_id, set()
            while cur and cur in self.cats and cur not in seen:
                seen.add(cur)
                c = self.cats[cur]
                names.append(c.name)
                if google is None and c.google_category_id:
                    google = int(c.google_category_id)
                cur = c.parent_id
            self._paths[category_id] = (" > ".join(reversed(names)), google)
        return self._paths[category_id]


def iter_feed_items(store: Store, country: str, locale: str, *, web_base_url: str,
                    stats: FeedStats | None = None) -> Iterator[dict[str, Any]]:
    """Yield Google Merchant Center items (plain dicts) for one country and locale."""
    stats = stats if stats is not None else FeedStats()
    cc = country.upper()
    c = store.get_country(cc)
    if c is None:
        raise ValueError(f"unknown or inactive country {cc}")
    currency = c.currency
    fx = store.get_fx_rate(currency)
    if fx is None or fx <= 0:
        raise ValueError(f"no fx rate USD->{currency}")
    decimals = store.get_currency_decimals(currency)
    rules = store.list_markup_rules()
    cats = _Categories(store.feed_categories(locale))
    lineage: dict[UUID | None, list] = {}
    base = web_base_url.rstrip("/")
    zero_shipping = format_price(Decimal(0), currency, decimals)

    for row in store.iter_feed_rows(cc, locale):
        item = _item(row, cc, locale, base, currency, fx, decimals, rules, cats, lineage, zero_shipping, store,
                     stats)
        if item is not None:
            stats.items += 1
            yield item


def _item(row: FeedRow, cc: str, locale: str, base: str, currency: str, fx: Decimal, decimals: int, rules,
          cats: _Categories, lineage: dict, zero_shipping: str, store: Store, stats: FeedStats
          ) -> dict[str, Any] | None:
    o = row.offer
    if o.kind != "dropship":  # defence in depth: affiliate items belong to partners
        stats.skip("not_dropship")
        return None
    title = clean_text(row.title, MAX_TITLE)
    if not title:
        stats.skip("no_title")
        return None
    images = [u for u in row.image_urls if isinstance(u, str) and u.startswith(("http://", "https://"))]
    if not images:
        stats.skip("no_image")
        return None
    if o.category_id not in lineage:
        lineage[o.category_id] = store.category_lineage(o.category_id)
    try:
        q = quote(o.pricing_input(), currency=currency, fx_rate=fx, decimals=decimals, rules=rules,
                  category_lineage=lineage[o.category_id])
    except PricingError:
        stats.skip("unpriced")
        return None
    if q.price <= 0:
        stats.skip("unpriced")
        return None

    pid = str(o.product_id)
    img = f"{base}/img/{urlquote(pid)}"
    product_type, google_cat = cats.info(o.category_id)
    dmin, dmax = o.delivery_days_min, o.delivery_days_max
    shipping: dict[str, Any] = {"country": cc, "price": zero_shipping}
    if dmin is not None and dmax is not None and 0 <= dmin <= dmax:
        handling = min(HANDLING_DAYS, dmin)
        shipping.update(min_handling_time=handling, max_handling_time=handling,
                        min_transit_time=dmin - handling, max_transit_time=dmax - handling)
    item: dict[str, Any] = {
        "id": str(o.id),
        "title": title,
        "description": clean_text(row.description, MAX_DESCRIPTION) or title,
        "link": f"{base}/{locale}/p/{urlquote(pid)}?country={cc}",
        "image_link": f"{img}/0",
        "additional_image_link": [f"{img}/{n}" for n in range(1, min(len(images), 1 + MAX_ADDITIONAL_IMAGES))],
        "availability": "out_of_stock" if o.stock is not None and o.stock <= 0 else "in_stock",
        "price": format_price(q.price, currency, decimals),
        "brand": feed_brand(row.brand),
        "condition": "new",
        "shipping": shipping,
    }
    gtin = re.sub(r"\D", "", row.gtin or "")
    if len(gtin) in (8, 12, 13, 14):
        item["gtin"] = gtin
    else:
        item["identifier_exists"] = "no"
    if google_cat:
        item["google_product_category"] = google_cat
    if product_type:
        item["product_type"] = clean_text(product_type, 750)
    if row.text_locale and row.text_locale != locale:
        item["content_language"] = row.text_locale  # jsonl only: no translation in the requested locale
    return item


# ---------------------------------------------------------------------------
# Serialisers (each yields text chunks: header, one chunk per item, footer)


def _x(tag: str, value: Any) -> str:
    return f"<g:{tag}>{xml_escape(str(value))}</g:{tag}>"


def _xml_item(it: dict[str, Any]) -> str:
    parts = [_x("id", it["id"]), _x("title", it["title"]), _x("description", it["description"]),
             _x("link", it["link"]), _x("image_link", it["image_link"])]
    parts += [_x("additional_image_link", u) for u in it["additional_image_link"]]
    parts += [_x("availability", it["availability"]), _x("price", it["price"]), _x("brand", it["brand"])]
    parts.append(_x("gtin", it["gtin"]) if "gtin" in it else _x("identifier_exists", it["identifier_exists"]))
    parts.append(_x("condition", it["condition"]))
    if "google_product_category" in it:
        parts.append(_x("google_product_category", it["google_product_category"]))
    if "product_type" in it:
        parts.append(_x("product_type", it["product_type"]))
    ship = "".join(_x(k, v) for k, v in it["shipping"].items())
    parts.append(f"<g:shipping>{ship}</g:shipping>")
    return "<item>" + "".join(parts) + "</item>\n"


def _tsv_cell(v: Any) -> str:
    return re.sub(r"[\t\r\n]+", " ", "" if v is None else str(v))


def _tsv_item(it: dict[str, Any]) -> str:
    s = it["shipping"]
    row = {**it, "additional_image_link": ",".join(it["additional_image_link"]),
           "shipping": f"{s['country']}:::{s['price']}",
           "min_handling_time": s.get("min_handling_time"), "max_handling_time": s.get("max_handling_time")}
    return "\t".join(_tsv_cell(row.get(col)) for col in TSV_COLUMNS) + "\n"


def iter_feed_chunks(store: Store, fmt: str, country: str, locale: str, *, web_base_url: str,
                     stats: FeedStats | None = None) -> Iterator[str]:
    if fmt not in FORMATS:
        raise ValueError(f"unknown feed format {fmt!r}; expected one of {', '.join(FORMATS)}")
    items = iter_feed_items(store, country, locale, web_base_url=web_base_url, stats=stats)
    base = web_base_url.rstrip("/")
    if fmt == "google-xml":
        yield ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n'
               f"<title>{xml_escape(f'Zakka {country.upper()} ({locale})')}</title>\n"
               f"<link>{xml_escape(f'{base}/{locale}')}</link>\n"
               f"<description>{xml_escape(f'Zakka products delivered to {country.upper()}')}</description>\n")
        for it in items:
            yield _xml_item(it)
        yield "</channel>\n</rss>\n"
    elif fmt == "google-tsv":
        yield "\t".join(TSV_COLUMNS) + "\n"
        for it in items:
            yield _tsv_item(it)
    else:
        for it in items:
            yield json.dumps(it, ensure_ascii=False) + "\n"


def write_feed(store: Store, out: TextIO, fmt: str, country: str, locale: str, *, web_base_url: str
               ) -> FeedStats:
    stats = FeedStats()
    for chunk in iter_feed_chunks(store, fmt, country, locale, web_base_url=web_base_url, stats=stats):
        out.write(chunk)
    return stats
