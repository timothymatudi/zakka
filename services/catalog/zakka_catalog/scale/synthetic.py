"""Synthetic dropship supplier for benchmarks and scale tests.

Items are *computed* from their index (nothing is stored), so a 1,000,000-item
catalogue costs no memory. ``generation`` simulates time passing: in generation g>0,
every ``changed_every``-th item has a new price and title. The delta listing
(``since`` set) returns only those items, the way a supplier's "updated since" API would.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from ..models import ProductPage, SourceProduct, UpdatePage
from ..connectors.base import Connector

_ADJ = ("Classic", "Compact", "Premium", "Eco", "Smart", "Portable", "Deluxe", "Mini", "Pro", "Soft")
_NOUN = [  # (title noun, source category path) - paths map onto the seed category tree
    ("Wireless Earbuds", "Electronics > Audio & Headphones"), ("Phone Case", "Electronics > Mobile Phones"),
    ("Desk Lamp", "Home Decor > Lighting"), ("Yoga Mat", "Sports & Outdoors > Fitness Equipment"),
    ("Cotton T-Shirt", "Men's Fashion > T-Shirts & Polos"), ("Wrap Dress", "Women's Fashion > Dresses"),
    ("Running Sneakers", "Shoes > Sneakers"), ("Steel Water Bottle", "Home & Kitchen > Food Storage"),
    ("Frying Pan", "Home & Kitchen > Cookware"), ("Building Blocks", "Toys & Games > Building Toys"),
    ("Face Serum", "Beauty > Skincare"), ("Backpack", "Bags & Luggage > Backpacks"),
    ("Dog Leash", "Pet Supplies > Dogs"), ("Notebook Set", "Office & School > Notebooks & Paper"),
    ("Car Phone Holder", "Automotive > Interior Accessories"), ("Garden Hose", "Garden & Outdoor > Gardening Tools"),
]
_FROM = ("CN", "CN", "CN", "US", "DE", "AE", "SA", "KE", "NG", "IN", "EG")
_TO = (["US", "GB", "DE", "FR", "ES"], ["AE", "SA", "KW", "EG"], ["KE", "NG", "TZ", "UG", "ZA"], ["IN", "PK", "ID"])


class SimulatedKill(BaseException):
    """Like SIGKILL: not an Exception, so no handler 'cleans up' - the run just stops."""


class SyntheticSupplier(Connector):
    code = "synthetic"
    name = "Synthetic Supplier"
    kind = "dropship"
    env_keys = ()
    docs_url = "(generated)"
    supports_delta = True
    rate_limit_per_sec = 1e9
    bulk_size = 200

    def __init__(self, n: int, *, generation: int = 0, changed_every: int = 100, fail_at_cursor: str | None = None,
                 kill_at_cursor: str | None = None, fail_times: int = 1):
        super().__init__(env={})
        self.n, self.generation, self.changed_every = n, generation, changed_every
        self.fail_at_cursor, self.kill_at_cursor, self.fail_times = fail_at_cursor, kill_at_cursor, fail_times
        self.calls = 0
        self.cursors_seen: list[str | None] = []

    @property
    def mock(self) -> bool:  # generated data, but exercises the "live" code paths
        return False

    def ext(self, i: int) -> str:
        return f"SYN{i:08d}"

    def _changed(self, i: int) -> bool:
        return self.generation > 0 and i % self.changed_every == 0

    def item(self, i: int, *, detail: bool = False) -> SourceProduct:
        noun, path = _NOUN[i % len(_NOUN)]
        gen = self.generation if self._changed(i) else 0
        cost = Decimal(300 + (i * 37) % 4700) / 100 + Decimal(gen)
        images = [f"https://img.synthetic.example/{i}/main.jpg"]
        if detail:
            images += [f"https://img.synthetic.example/{i}/side.jpg", f"https://img.synthetic.example/{i}/main.jpg",
                       f"https://img.synthetic.example/{i}/box.jpg"]
        return SourceProduct(
            external_id=self.ext(i),
            title=f"{_ADJ[(i // 7) % len(_ADJ)]} {noun} {i % 997}" + (f" (v{gen})" if gen else ""),
            description=f"{noun} model {i}." + (" Full detail with care and sizing guide." if detail else ""),
            bullet_points=["Quality checked"] + (["Two-year warranty"] if detail else []),
            gtin=f"29{i:011d}" if i % 3 == 0 else None,
            image_urls=images, category_hint=path,
            attributes={"model": i, **({"variants": [{"size": s} for s in ("S", "M", "L")]} if detail else {})},
            rating=Decimal(30 + i % 20) / 10, review_count=(i * 13) % 5000,
            cost=cost, shipping=Decimal((i % 5) * 50) / 100, stock=0 if i % 250 == 7 else 10 + i % 90,
            ships_from=_FROM[i % len(_FROM)], ships_to=_TO[i % len(_TO)],
            delivery_days_min=2 + i % 6, delivery_days_max=8 + i % 12,
        )

    def _index(self, external_id: str) -> int | None:
        try:
            i = int(external_id[3:])
        except ValueError:
            return None
        return i if external_id.startswith("SYN") and 0 <= i < self.n else None

    # -- listing --------------------------------------------------------------------
    def fetch_updates(self, cursor: str | None, since: datetime | None, limit: int) -> UpdatePage:
        self.calls += 1
        self.cursors_seen.append(cursor)
        if cursor is not None and cursor == self.kill_at_cursor:
            raise SimulatedKill(f"killed at cursor {cursor}")
        if cursor is not None and cursor == self.fail_at_cursor and self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError(f"supplier timeout at cursor {cursor}")
        start = int(cursor or 0)
        if since is None:  # full listing
            end = min(self.n, start + limit)
            items = [self.item(i) for i in range(start, end)]
            return UpdatePage(items=items, next_cursor=str(end) if end < self.n else None)
        if self.generation == 0:  # nothing changed since
            return UpdatePage(items=[], next_cursor=None)
        k = self.changed_every
        first = -(-start // k) * k
        idx = list(range(first, self.n, k))[:limit]
        nxt = idx[-1] + 1 if idx and idx[-1] + k < self.n else None
        return UpdatePage(items=[self.item(i) for i in idx], next_cursor=str(nxt) if nxt is not None else None)

    def fetch_products(self, page: int = 1) -> ProductPage:
        p = self.fetch_updates(str((page - 1) * self.page_size), None, self.page_size)
        return ProductPage(items=p.items, page=page, next_page=page + 1 if p.next_cursor else None)

    def fetch_offers(self, external_ids: list[str]) -> list[SourceProduct]:
        self.calls += 1
        return [self.item(i) for i in (self._index(e) for e in external_ids) if i is not None]

    def fetch_offer(self, external_id: str) -> SourceProduct | None:
        found = self.fetch_offers([external_id])
        return found[0] if found else None

    def fetch_detail(self, external_id: str) -> SourceProduct | None:
        self.calls += 1
        i = self._index(external_id)
        return self.item(i, detail=True) if i is not None else None

    def _live_products(self, page: int) -> ProductPage:  # pragma: no cover - fetch_products overridden
        return self.fetch_products(page)
