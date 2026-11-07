"""Just-in-time checks and engagement signals (used by the HTTP API).

* ``refresh_offer``: re-price and stock-check one offer right before checkout, or when
  a product page opens and the offer was last synced more than ``max_age`` ago.
* ``record_signals``: views, clicks and orders mark offers hot. Search impressions mark
  products warm. A first view in a locale without a translation queues an AI
  translation (lazy cost control).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Mapping
from uuid import UUID

from .connectors import Connector
from .enrich import Enricher
from .models import SourceProduct
from .store import Store, utcnow
from .sync import ingest_items

MAX_AGE = timedelta(hours=1)


def refresh_offer(store: Store, connectors: Mapping[str, Connector], offer_id: UUID, enricher: Enricher, *,
                  max_age: timedelta = MAX_AGE, force: bool = False) -> dict:
    offer = store.get_offer(offer_id)
    if offer is None:
        raise LookupError("offer not found")
    age = (utcnow() - offer.last_synced_at) if offer.last_synced_at else None
    store.record_engagement([offer.id])
    if not force and age is not None and age < max_age:
        store.commit()
        return {"refreshed": False, "reason": "fresh", "age_seconds": int(age.total_seconds()),
                "is_active": offer.is_active}
    connector = connectors.get(offer.source_code)
    if connector is None:
        raise LookupError(f"no connector for {offer.source_code}")
    if not connector.mock and not getattr(connector, "supports_single_lookup", True):
        store.commit()
        return {"refreshed": False, "reason": "source has no single-item lookup; refreshed by its feed import",
                "is_active": offer.is_active}
    item = connector.fetch_offer(offer.external_id)
    if item is None:
        store.deactivate_offer(offer.id)
        store.commit()
        return {"refreshed": True, "is_active": False, "reason": "gone at source"}
    ingest_items(store, connector, [item], enricher)
    fresh = store.get_offer(offer.id)
    store.commit()
    return {"refreshed": True, "is_active": fresh.is_active, "reason": "stale" if age else "never synced"}


def record_signals(store: Store, enricher: Enricher, *, engaged_offer_ids=(), impression_product_ids=(),
                   viewed=(), queue=None) -> dict:
    store.record_engagement([UUID(str(i)) for i in engaged_offer_ids])
    store.record_impressions([UUID(str(i)) for i in impression_product_ids])
    queued, translated = 0, 0
    for v in viewed:
        pid, locale = UUID(str(v["product_id"])), v["locale"]
        if locale in store.translation_locales(pid):
            continue
        if queue is not None:
            queued += 1 if queue.enqueue("translate", {"product_id": str(pid), "locales": [locale]},
                                         dedupe_key=f"translate:{pid}:{locale}", priority=6) else 0
            continue
        src = store.get_translation(pid, "en") or next(
            (store.get_translation(pid, loc) for loc in store.translation_locales(pid)), None)
        if src is None:
            continue
        sp = SourceProduct(external_id=str(pid), title=src.title, description=src.description,
                           bullet_points=src.bullet_points)
        result = enricher.enrich(sp, store.list_categories(), [locale])
        if locale in result.translations:
            store.upsert_translation(pid, locale, result.translations[locale])
            translated += 1
    store.commit()
    return {"engaged": len(engaged_offer_ids), "impressions": len(impression_product_ids),
            "translations_queued": queued, "translated_now": translated}
