"""Shared dev catalog: the single source of mock/dev data for every service.

``export_dev_catalog`` runs a mock sync of all sources into a MemoryStore and writes
``packages/fixtures/dev-catalog.json`` (read by services/search and others). All ids
are deterministic (uuid5): sources from their code, offers from source + external_id,
products from GTIN (or source + external_id), categories from slug. So the same
offer id is accepted by ``POST /orders/{id}/forward`` when the catalog API runs on
its in-memory store, which is rebuilt the same way at startup.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from .config import REPO_ROOT
from .connectors import all_connectors
from .enrich import MockEnricher
from .store import MemoryStore
from .sync import sync_many

log = logging.getLogger(__name__)

DEFAULT_DEV_CATALOG = REPO_ROOT / "packages" / "fixtures" / "dev-catalog.json"


def _num(v: Decimal | None) -> float | int | None:
    if v is None:
        return None
    return int(v) if v == v.to_integral_value() else float(v)


def popularity(rating: Decimal | None, review_count: int) -> float:
    """0..1: review volume (log scale, saturating at 100k) weighted by rating."""
    volume = min(1.0, math.log10(1 + max(review_count, 0)) / 5)
    return round(volume * (float(rating) / 5 if rating is not None else 0.6), 4)


def build_dev_store() -> MemoryStore:
    store = MemoryStore()
    reports = sync_many(store, all_connectors(force_mock=True).values(), MockEnricher())
    failed = [r.source for r in reports if r.error]
    if failed:
        raise RuntimeError(f"mock sync failed for {failed}")
    return store


def dev_catalog(store: MemoryStore) -> dict[str, Any]:
    products = []
    for pid, p in store.products.items():
        products.append({
            "id": str(pid),
            "category_id": str(p["category_id"]) if p.get("category_id") else None,
            "brand": p.get("brand"),
            "gtin": p.get("gtin"),
            "image_urls": list(p.get("image_urls") or []),
            "rating": _num(p.get("rating")),
            "review_count": p.get("review_count", 0),
            "popularity": popularity(p.get("rating"), p.get("review_count", 0)),
            "attributes": json.loads(json.dumps(
                {k: v for k, v in (p.get("attributes") or {}).items() if not k.startswith("_")},
                default=lambda v: _num(v) if isinstance(v, Decimal) else str(v))),
            "translations": {
                loc: {"title": t.title, "description": t.description, "bullet_points": list(t.bullet_points)}
                for (tpid, loc), t in store.translations.items() if tpid == pid
            },
        })
    offers = []
    for o in store.list_offers(active_only=False):
        offers.append({
            "id": str(o.id), "product_id": str(o.product_id), "source_code": o.source_code, "kind": o.kind,
            "external_id": o.external_id, "url": o.url,
            "display_price_usd": _num(store.display_prices.get(o.id)),
            "list_price_local": _num(o.list_price_local), "list_currency": o.list_currency,
            "shipping_usd": _num(o.shipping_usd), "shipping_local": _num(o.shipping_local),
            "ships_from": o.ships_from, "ships_to": list(o.ships_to),
            "delivery_days_min": o.delivery_days_min, "delivery_days_max": o.delivery_days_max,
            "is_active": o.is_active,
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": [{"id": str(c.id), "slug": c.slug, "parent_id": str(c.parent_id) if c.parent_id else None,
                        "names": dict(c.names) or ({"en": c.name} if c.name else {})}
                       for c in store.list_categories()],
        "sources": [{"id": str(s.id), "code": s.code, "kind": s.kind} for s in store.sources.values()],
        "products": products,
        "offers": offers,
        "fx_rates": {q: _num(r) for q, r in sorted({"USD": Decimal(1), **store.fx}.items())},
        "currencies": dict(sorted(store.currencies.items())),
    }


def export_dev_catalog(out: Path = DEFAULT_DEV_CATALOG) -> dict[str, Any]:
    data = dev_catalog(build_dev_store())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def check_against_dev_catalog(store: MemoryStore, path: Path = DEFAULT_DEV_CATALOG) -> list[str]:
    """Offer ids in the shared dev catalog that this store doesn't know (should be none)."""
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.warning("cannot read %s: %s", path, exc)
        return []
    known = {str(o) for o in store.offers}
    missing = [o["id"] for o in data.get("offers", []) if o["id"] not in known]
    if missing:
        log.warning("%d offer id(s) in %s are unknown to the catalog store - re-run "
                    "`python -m zakka_catalog export-dev`", len(missing), path)
    return missing
