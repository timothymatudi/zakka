"""Affiliate partners are searched live, never bulk-ingested.

Their APIs are query-based with usage limits, so search calls ``LiveAffiliateSearch``
on demand:

* results are cached briefly (default 1h) per (source, query, country), in memory
  and bounded (LRU);
* each source has a daily call quota (``Connector.daily_quota``). When it's used up,
  the cache still answers but no new calls are made;
* nothing is written to the catalogue until a customer actually sees or clicks an
  item. Then ``materialize`` stores just that offer (so clicks and orders can
  reference it) and the tier logic keeps it fresh.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Callable, Mapping

from ..connectors import Connector, NotConfirmedError
from ..models import SourceProduct
from ..sync import SyncItemError, customer_copy

log = logging.getLogger(__name__)


class QuotaExceeded(RuntimeError):
    pass


@dataclass
class QuotaTracker:
    """Per-source daily call budget (UTC day). In-process; see README for a shared store."""

    limits: dict[str, int | None] = field(default_factory=dict)
    _day: date | None = None
    _used: dict[str, int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def _roll(self) -> None:
        today = datetime.now(timezone.utc).date()
        if self._day != today:
            self._day, self._used = today, {}

    def consume(self, code: str, n: int = 1) -> None:
        with self._lock:
            self._roll()
            limit = self.limits.get(code)
            used = self._used.get(code, 0)
            if limit is not None and used + n > limit:
                raise QuotaExceeded(f"{code}: daily quota {limit} reached")
            self._used[code] = used + n

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            self._roll()
            return {c: {"used": self._used.get(c, 0), "quota": self.limits.get(c)}
                    for c in sorted(set(self.limits) | set(self._used))}


class LiveAffiliateSearch:
    def __init__(self, connectors: Mapping[str, Connector], *, ttl_seconds: float = 3600,
                 quota: QuotaTracker | None = None, max_entries: int = 5000, clock: Callable[[], float] = time.time):
        self.connectors = {c: k for c, k in connectors.items() if k.kind == "affiliate"}
        self.ttl, self.clock, self.max_entries = ttl_seconds, clock, max_entries
        self.quota = quota or QuotaTracker({c: k.daily_quota for c, k in self.connectors.items()})
        self._cache: OrderedDict[tuple, tuple[float, list[SourceProduct]]] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def _norm(query: str) -> str:
        return " ".join(query.lower().split())

    def _get(self, key):
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > self.clock():
                self._cache.move_to_end(key)
                return hit[1]
            if hit:
                del self._cache[key]
            return None

    def _put(self, key, items):
        with self._lock:
            self._cache[key] = (self.clock() + self.ttl, items)
            self._cache.move_to_end(key)
            while len(self._cache) > self.max_entries:
                self._cache.popitem(last=False)

    def search(self, query: str, country: str | None = None, *, limit: int = 20,
               sources: list[str] | None = None) -> dict:
        q = self._norm(query)
        found, status = self._collect(q, country, limit, sources)
        items = [self._result(code, p) for code, p in found]
        return {"query": q, "country": country, "items": items[: limit * max(1, len(self.connectors))],
                "sources": status, "quota": self.quota.snapshot()}

    def hits(self, query: str, country: str | None, *, fx_rate: Callable[[str], object],
             source_ids: Mapping[str, str], limit: int = 20, sources: list[str] | None = None) -> dict:
        """Search-document shaped results: one hit per product (same GTIN across partners is
        merged), offers with display_price_usd and the partner's own-currency price. Ids are
        the deterministic ids ``materialize`` will store, so a click maps to the same offer."""
        from decimal import ROUND_HALF_UP, Decimal

        from .bulkstore import offer_id_for, product_id_for

        q = self._norm(query)
        found, status = self._collect(q, country, limit, sources)
        hits: dict[str, dict] = {}
        for code, p in found:
            rate = fx_rate(p.currency)
            if not rate or p.list_price is None or code not in source_ids:
                continue
            usd = lambda v: (Decimal(v) / Decimal(rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)  # noqa: E731
            pid = product_id_for(p.gtin, f"{code}:{p.external_id}")
            hit = hits.setdefault(pid, {"id": pid, "title": p.title, "gtin": p.gtin, "brand": p.brand,
                                        "image": p.image_urls[0] if p.image_urls else None,
                                        "rating": float(p.rating) if p.rating is not None else None,
                                        "review_count": p.review_count, "offers": []})
            hit["offers"].append({
                "offer_id": offer_id_for(source_ids[code], p.external_id), "source_code": code, "kind": "affiliate",
                "display_price_usd": float(usd(p.list_price) + usd(p.shipping)),
                "delivery_days_min": p.delivery_days_min, "delivery_days_max": p.delivery_days_max,
                "ships_from": p.ships_from, "ships_to": p.ships_to, "url": p.url,
                "list_price_local": float(p.list_price), "list_currency": p.currency,
                "shipping_local": float(p.shipping)})
        out = sorted(hits.values(), key=lambda h: min(o["display_price_usd"] for o in h["offers"]))
        return {"hits": out[:limit], "found": len(out), "sources": status}

    def _collect(self, q: str, country: str | None, limit: int, sources: list[str] | None):
        items, status = [], {}
        for code, conn in self.connectors.items():
            if sources and code not in sources:
                continue
            if not getattr(conn, "supports_live_search", True):
                continue  # feed-only network: its products come from the feed import
            key = (code, q, (country or "").upper())
            found = self._get(key)
            if found is not None:
                status[code] = "cache"
            else:
                try:
                    self.quota.consume(code)
                    found = []
                    for raw in conn.fetch_live(q, country, limit):
                        try:
                            found.append(customer_copy(raw))
                        except SyncItemError:
                            continue
                    self._put(key, found)
                    status[code] = "live"
                except QuotaExceeded:
                    status[code], found = "quota_exceeded", []
                except NotConfirmedError:
                    status[code], found = "not_configured", []
                except Exception as exc:
                    log.warning("live search %s failed: %s", code, exc)
                    status[code], found = "error", []
            items.extend((code, p) for p in found)
        return items, status

    def cached_item(self, code: str, external_id: str) -> SourceProduct | None:
        with self._lock:
            for (c, _, _), (exp, items) in self._cache.items():
                if c == code and exp > self.clock():
                    for p in items:
                        if p.external_id == external_id:
                            return p
        return None

    @staticmethod
    def _result(code: str, p: SourceProduct) -> dict:
        return {"source_code": code, "kind": "affiliate", "external_id": p.external_id, "title": p.title,
                "image": p.image_urls[0] if p.image_urls else None, "url": p.url, "currency": p.currency,
                "list_price": str(p.list_price) if p.list_price is not None else None,
                "shipping": str(p.shipping), "ships_from": p.ships_from, "ships_to": p.ships_to,
                "delivery_days_min": p.delivery_days_min, "delivery_days_max": p.delivery_days_max,
                "rating": str(p.rating) if p.rating is not None else None}

