"""Persistence layer.

``PostgresStore`` talks to the contract schema (supabase/migrations/0001_core.sql).
``MemoryStore`` implements the same interface in memory, seeded from
``fixtures/reference.json``; it backs tests, ``--dry-run`` (with ``echo`` so
every write is printed) and the API when DATABASE_URL is empty/unreachable.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Iterable, Protocol
from uuid import UUID

from .config import PHASE1_LOCALES
from .models import CategoryRef, TrackingInfo, Translation
from .pricing import MarkupRule, OfferPricingInput

MOCK_NS = UUID("6f1c2a52-6a8e-4c7e-9a7b-2b0d7d9e5a10")  # same namespace as the fixtures


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Country:
    code: str
    currency: str
    default_locale: str


@dataclass(frozen=True)
class SourceRef:
    id: UUID
    code: str
    kind: str
    name: str
    is_active: bool = True


@dataclass
class ProductWrite:
    brand: str | None
    gtin: str | None
    image_urls: list[str]
    attributes: dict[str, Any]
    rating: Decimal | None
    review_count: int
    category_id: UUID | None = None
    origin_key: str = ""  # "<source>:<external_id>" - only used for deterministic ids in MemoryStore


@dataclass
class OfferWrite:
    product_id: UUID
    source_id: UUID
    external_id: str
    url: str | None
    cost_usd: Decimal | None
    list_price_usd: Decimal | None
    shipping_usd: Decimal
    stock: int | None
    ships_from: str | None
    ships_to: list[str]
    delivery_days_min: int | None
    delivery_days_max: int | None
    commission_rate: Decimal | None
    last_synced_at: datetime
    is_active: bool = True


@dataclass
class OfferView:
    id: UUID
    product_id: UUID
    source_id: UUID
    source_code: str
    kind: str
    external_id: str
    url: str | None
    cost_usd: Decimal | None
    list_price_usd: Decimal | None
    shipping_usd: Decimal
    stock: int | None
    ships_from: str | None
    ships_to: list[str]
    delivery_days_min: int | None
    delivery_days_max: int | None
    is_active: bool
    category_id: UUID | None = None
    last_synced_at: datetime | None = None

    def pricing_input(self) -> OfferPricingInput:
        return OfferPricingInput(kind=self.kind, cost_usd=self.cost_usd, list_price_usd=self.list_price_usd,
                                 shipping_usd=self.shipping_usd, product_id=self.product_id,
                                 source_id=self.source_id)


@dataclass
class OrderView:
    id: UUID
    status: str
    currency: str
    shipping_address: dict | None = None


@dataclass
class OrderItemView:
    id: UUID
    offer_id: UUID
    product_id: UUID
    qty: int
    unit_price: Decimal
    unit_cost_usd: Decimal | None
    external_id: str
    source_id: UUID
    source_code: str
    source_kind: str
    cost_usd: Decimal | None
    shipping_usd: Decimal


@dataclass
class SupplierOrderView:
    id: UUID
    order_id: UUID
    source_id: UUID
    source_code: str
    external_order_id: str | None
    status: str
    cost_usd: Decimal | None


class Store(Protocol):
    name: str
    supports_display_price: bool

    # reference
    def get_country(self, code: str) -> Country | None: ...
    def get_currency_decimals(self, code: str) -> int: ...
    def get_fx_rate(self, quote: str) -> Decimal | None: ...
    def list_markup_rules(self) -> list[MarkupRule]: ...
    def list_categories(self) -> list[CategoryRef]: ...
    def category_lineage(self, category_id: UUID | None) -> list[UUID]: ...
    def active_locales(self) -> list[str]: ...
    def get_source(self, code: str) -> SourceRef | None: ...
    def ensure_source(self, code: str, kind: str, name: str) -> SourceRef: ...
    # catalog
    def find_product_for_offer(self, source_id: UUID, external_id: str) -> UUID | None: ...
    def find_product_by_gtin(self, gtin: str) -> UUID | None: ...
    def get_product_category(self, product_id: UUID) -> UUID | None: ...
    def insert_product(self, p: ProductWrite) -> UUID: ...
    def update_product(self, product_id: UUID, p: ProductWrite) -> None: ...
    def get_translation(self, product_id: UUID, locale: str) -> Translation | None: ...
    def translation_locales(self, product_id: UUID) -> set[str]: ...
    def upsert_translation(self, product_id: UUID, locale: str, t: Translation) -> None: ...
    def upsert_offer(self, o: OfferWrite) -> UUID: ...
    def deactivate_stale_offers(self, source_id: UUID, synced_before: datetime) -> int: ...
    def set_display_price(self, offer_id: UUID, value: Decimal) -> None: ...
    def get_offer(self, offer_id: UUID) -> OfferView | None: ...
    def list_offers(self, source_id: UUID | None = None, active_only: bool = True) -> list[OfferView]: ...
    # orders
    def get_order(self, order_id: UUID) -> OrderView | None: ...
    def get_order_items(self, order_id: UUID) -> list[OrderItemView]: ...
    def set_order_status(self, order_id: UUID, status: str) -> None: ...
    def set_order_item_unit_cost(self, item_id: UUID, unit_cost_usd: Decimal | None) -> None: ...
    def list_supplier_orders(self, order_id: UUID | None = None, statuses: Iterable[str] | None = None
                             ) -> list[SupplierOrderView]: ...
    def create_supplier_order(self, order_id: UUID, source_id: UUID, external_order_id: str | None,
                              status: str, cost_usd: Decimal | None) -> UUID: ...
    def update_supplier_order(self, supplier_order_id: UUID, *, status: str,
                              external_order_id: str | None = None, cost_usd: Decimal | None = None) -> None: ...
    def upsert_shipment(self, supplier_order_id: UUID, t: TrackingInfo) -> str | None:
        """Insert/update; returns the shipment's previous status (None if it is new)."""
    def commit(self) -> None: ...


# ---------------------------------------------------------------------------
# Reference fixtures


def load_reference() -> dict[str, Any]:
    from .connectors.base import load_fixture

    return load_fixture("reference")


def _rule_from_row(r: dict) -> MarkupRule:
    return MarkupRule(id=r["id"], scope=r["scope"], scope_id=r.get("scope_id"),
                      percent=Decimal(str(r.get("percent", 0))), fixed_usd=Decimal(str(r.get("fixed_usd", 0))),
                      round_to=Decimal(str(r.get("round_to", "0.99"))), priority=int(r.get("priority", 0)),
                      is_active=bool(r.get("is_active", True)))


# ---------------------------------------------------------------------------
# In-memory store


class MemoryStore:
    """Dict-backed Store. ``echo`` (e.g. ``print``) receives a line per write."""

    name = "memory"
    supports_display_price = True

    def __init__(self, reference: dict[str, Any] | None = None, echo: Callable[[str], None] | None = None):
        ref = reference if reference is not None else load_reference()
        self.echo = echo
        self.locales = list(ref.get("locales") or PHASE1_LOCALES)
        self.currencies = {c["code"]: int(c["decimals"]) for c in ref.get("currencies", [])}
        self.fx = {f["quote"]: Decimal(str(f["rate"])) for f in ref.get("fx_rates", [])}
        self.countries = {c["code"]: Country(c["code"], c["currency"], c["default_locale"])
                          for c in ref.get("countries", [])}
        self.categories = {UUID(c["id"]): CategoryRef(id=UUID(c["id"]), slug=c["slug"],
                                                      parent_id=UUID(c["parent_id"]) if c.get("parent_id") else None,
                                                      name=c.get("name"))
                           for c in ref.get("categories", [])}
        self.sources = {s["code"]: SourceRef(UUID(s["id"]), s["code"], s["kind"], s["name"])
                        for s in ref.get("sources", [])}
        self.rules = [_rule_from_row(r) for r in ref.get("markup_rules", [])]
        self.products: dict[UUID, dict] = {}
        self.translations: dict[tuple[UUID, str], Translation] = {}
        self.offers: dict[UUID, dict] = {}
        self.display_prices: dict[UUID, Decimal] = {}
        self.orders: dict[UUID, dict] = {}
        self.order_items: dict[UUID, list[dict]] = {}
        self.supplier_orders: dict[UUID, dict] = {}
        self.shipments: dict[UUID, dict] = {}

    def _log(self, msg: str) -> None:
        if self.echo:
            self.echo(msg)

    # reference -----------------------------------------------------------
    def get_country(self, code):
        return self.countries.get(code.upper())

    def get_currency_decimals(self, code):
        return self.currencies.get(code.upper(), 2)

    def get_fx_rate(self, quote):
        return Decimal(1) if quote.upper() == "USD" else self.fx.get(quote.upper())

    def list_markup_rules(self):
        return [r for r in self.rules if r.is_active]

    def list_categories(self):
        return list(self.categories.values())

    def category_lineage(self, category_id):
        out, seen = [], set()
        while category_id and category_id not in seen and category_id in self.categories:
            seen.add(category_id)
            out.append(category_id)
            category_id = self.categories[category_id].parent_id
        return out

    def active_locales(self):
        return list(self.locales)

    def get_source(self, code):
        return self.sources.get(code)

    def ensure_source(self, code, kind, name):
        if code not in self.sources:
            self.sources[code] = SourceRef(uuid.uuid5(MOCK_NS, f"source:{code}"), code, kind, name)
            self._log(f"INSERT source {code} ({kind})")
        return self.sources[code]

    # catalog ---------------------------------------------------------------
    def find_product_for_offer(self, source_id, external_id):
        for o in self.offers.values():
            if o["source_id"] == source_id and o["external_id"] == external_id:
                return o["product_id"]
        return None

    def find_product_by_gtin(self, gtin):
        for pid, p in self.products.items():
            if p.get("gtin") == gtin:
                return pid
        return None

    def get_product_category(self, product_id):
        p = self.products.get(product_id)
        return p.get("category_id") if p else None

    def insert_product(self, p):
        # Deterministic ids keep mock offer/product ids stable across restarts.
        key = p.gtin or p.origin_key or str(uuid.uuid4())
        pid = uuid.uuid5(MOCK_NS, f"product:{key}")
        while pid in self.products:
            pid = uuid.uuid5(MOCK_NS, f"product:{key}:{len(self.products)}")
        self.products[pid] = {**_product_fields(p), "is_active": True, "updated_at": utcnow()}
        self._log(f"INSERT product {pid} brand={p.brand!r} gtin={p.gtin} category={p.category_id}")
        return pid

    def update_product(self, product_id, p):
        cur = self.products[product_id]
        data = _product_fields(p)
        if data.get("category_id") is None:
            data["category_id"] = cur.get("category_id")
        cur.update(data, updated_at=utcnow())
        self._log(f"UPDATE product {product_id}")

    def get_translation(self, product_id, locale):
        return self.translations.get((product_id, locale))

    def translation_locales(self, product_id):
        return {loc for (pid, loc) in self.translations if pid == product_id}

    def upsert_translation(self, product_id, locale, t):
        self.translations[(product_id, locale)] = t
        self._log(f"UPSERT product_translation {product_id} [{locale}] {t.title[:60]!r}")

    def upsert_offer(self, o):
        oid = uuid.uuid5(MOCK_NS, f"offer:{o.source_id}:{o.external_id}")
        self.offers[oid] = {**o.__dict__, "id": oid}
        self._log(
            f"UPSERT offer {oid} ext={o.external_id} cost_usd={o.cost_usd} list_price_usd={o.list_price_usd} "
            f"shipping_usd={o.shipping_usd} ships_from={o.ships_from} to={len(o.ships_to)} countries "
            f"days={o.delivery_days_min}-{o.delivery_days_max} active={o.is_active}"
        )
        return oid

    def deactivate_stale_offers(self, source_id, synced_before):
        n = 0
        for o in self.offers.values():
            if o["source_id"] == source_id and o["is_active"] and (
                    o["last_synced_at"] is None or o["last_synced_at"] < synced_before):
                o["is_active"] = False
                n += 1
        if n:
            self._log(f"UPDATE offers SET is_active=false: {n} stale offer(s) for source {source_id}")
        return n

    def set_display_price(self, offer_id, value):
        self.display_prices[offer_id] = value
        self._log(f"SET offer {offer_id} display_price_usd={value}")

    def _offer_view(self, o: dict) -> OfferView:
        src = next(s for s in self.sources.values() if s.id == o["source_id"])
        return OfferView(id=o["id"], product_id=o["product_id"], source_id=o["source_id"], source_code=src.code,
                         kind=src.kind, external_id=o["external_id"], url=o["url"], cost_usd=o["cost_usd"],
                         list_price_usd=o["list_price_usd"], shipping_usd=o["shipping_usd"], stock=o["stock"],
                         ships_from=o["ships_from"], ships_to=list(o["ships_to"]),
                         delivery_days_min=o["delivery_days_min"], delivery_days_max=o["delivery_days_max"],
                         is_active=o["is_active"], category_id=self.get_product_category(o["product_id"]),
                         last_synced_at=o["last_synced_at"])

    def get_offer(self, offer_id):
        o = self.offers.get(offer_id)
        return self._offer_view(o) if o else None

    def list_offers(self, source_id=None, active_only=True):
        return [self._offer_view(o) for o in self.offers.values()
                if (source_id is None or o["source_id"] == source_id) and (o["is_active"] or not active_only)]

    def find_offer(self, source_code: str, external_id: str) -> OfferView | None:
        src = self.sources.get(source_code)
        if not src:
            return None
        oid = uuid.uuid5(MOCK_NS, f"offer:{src.id}:{external_id}")
        return self.get_offer(oid)

    # orders ------------------------------------------------------------------
    def add_order(self, order_id: UUID, status: str, currency: str, items: list[dict],
                  shipping_address: dict | None = None) -> None:
        """Test/demo helper: items = [{offer_id, qty, unit_price, unit_cost_usd?}]."""
        self.orders[order_id] = {"id": order_id, "status": status, "currency": currency,
                                 "shipping_address": shipping_address}
        rows = []
        for it in items:
            offer = self.offers[it["offer_id"]]
            rows.append({"id": uuid.uuid4(), "order_id": order_id, "offer_id": it["offer_id"],
                         "product_id": offer["product_id"], "qty": int(it["qty"]),
                         "unit_price": Decimal(str(it["unit_price"])),
                         "unit_cost_usd": it.get("unit_cost_usd")})
        self.order_items[order_id] = rows

    def get_order(self, order_id):
        o = self.orders.get(order_id)
        return OrderView(o["id"], o["status"], o["currency"], o.get("shipping_address")) if o else None

    def get_order_items(self, order_id):
        out = []
        for it in self.order_items.get(order_id, []):
            ov = self.get_offer(it["offer_id"])
            out.append(OrderItemView(id=it["id"], offer_id=it["offer_id"], product_id=it["product_id"], qty=it["qty"],
                                     unit_price=it["unit_price"], unit_cost_usd=it["unit_cost_usd"],
                                     external_id=ov.external_id, source_id=ov.source_id, source_code=ov.source_code,
                                     source_kind=ov.kind, cost_usd=ov.cost_usd, shipping_usd=ov.shipping_usd))
        return out

    def set_order_status(self, order_id, status):
        self.orders[order_id]["status"] = status
        self._log(f"UPDATE order {order_id} status={status}")

    def set_order_item_unit_cost(self, item_id, unit_cost_usd):
        for rows in self.order_items.values():
            for row in rows:
                if row["id"] == item_id:
                    row["unit_cost_usd"] = unit_cost_usd
                    self._log(f"UPDATE order_item {item_id} unit_cost_usd={unit_cost_usd}")
                    return

    def _so_view(self, s: dict) -> SupplierOrderView:
        src = next(x for x in self.sources.values() if x.id == s["source_id"])
        return SupplierOrderView(s["id"], s["order_id"], s["source_id"], src.code, s["external_order_id"],
                                 s["status"], s["cost_usd"])

    def list_supplier_orders(self, order_id=None, statuses=None):
        st = set(statuses) if statuses is not None else None
        return [self._so_view(s) for s in self.supplier_orders.values()
                if (order_id is None or s["order_id"] == order_id) and (st is None or s["status"] in st)]

    def create_supplier_order(self, order_id, source_id, external_order_id, status, cost_usd):
        sid = uuid.uuid4()
        self.supplier_orders[sid] = {"id": sid, "order_id": order_id, "source_id": source_id,
                                     "external_order_id": external_order_id, "status": status, "cost_usd": cost_usd}
        self._log(f"INSERT supplier_order {sid} order={order_id} ext={external_order_id} status={status}")
        return sid

    def update_supplier_order(self, supplier_order_id, *, status, external_order_id=None, cost_usd=None):
        s = self.supplier_orders[supplier_order_id]
        s["status"] = status
        if external_order_id is not None:
            s["external_order_id"] = external_order_id
        if cost_usd is not None:
            s["cost_usd"] = cost_usd
        self._log(f"UPDATE supplier_order {supplier_order_id} status={status}")

    def upsert_shipment(self, supplier_order_id, t):
        prev = self.shipments.get(supplier_order_id)
        previous = prev["status"] if prev and prev["tracking_number"] == t.tracking_number else None
        self.shipments[supplier_order_id] = {**t.model_dump(), "supplier_order_id": supplier_order_id,
                                             "updated_at": utcnow()}
        self._log(f"UPSERT shipment so={supplier_order_id} {t.carrier} {t.tracking_number} {t.status}")
        return previous

    def commit(self):
        pass


# ---------------------------------------------------------------------------
# Postgres store


class PostgresStore:
    """psycopg 3 implementation against the contract schema."""

    name = "postgres"

    def __init__(self, dsn: str, connect_timeout: int = 3):
        import psycopg
        from psycopg.rows import dict_row

        self.conn = psycopg.connect(dsn, connect_timeout=connect_timeout, row_factory=dict_row)
        # display_price_usd is not in 0001_core.sql (contract request); write it only if Agent 1 adds it.
        self.supports_display_price = self._has_column("offers", "display_price_usd")
        self._has_shipping_address = self._has_column("orders", "shipping_address")

    def _has_column(self, table: str, column: str) -> bool:
        row = self._one("select 1 as ok from information_schema.columns where table_schema = current_schema() "
                        "and table_name = %s and column_name = %s", (table, column))
        return bool(row)

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def _exec(self, sql: str, params: tuple = ()) -> int:
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()

    # reference -----------------------------------------------------------
    def get_country(self, code):
        r = self._one("select code, currency, default_locale from countries where code = %s and is_active",
                      (code.upper(),))
        return Country(r["code"].strip(), r["currency"].strip(), r["default_locale"]) if r else None

    def get_currency_decimals(self, code):
        r = self._one("select decimals from currencies where code = %s", (code.upper(),))
        return int(r["decimals"]) if r else 2

    def get_fx_rate(self, quote):
        if quote.upper() == "USD":
            return Decimal(1)
        r = self._one("select rate from fx_rates where base = 'USD' and quote = %s", (quote.upper(),))
        return Decimal(r["rate"]) if r else None

    def list_markup_rules(self):
        return [_rule_from_row(r) for r in self._all("select * from markup_rules where is_active")]

    def list_categories(self):
        rows = self._all(
            "select c.id, c.slug, c.parent_id, ct.name from categories c "
            "left join category_translations ct on ct.category_id = c.id and ct.locale = 'en' order by c.sort")
        return [CategoryRef(id=r["id"], slug=r["slug"], parent_id=r["parent_id"], name=r["name"]) for r in rows]

    def category_lineage(self, category_id):
        if not category_id:
            return []
        rows = self._all(
            "with recursive up(id, parent_id, depth) as ("
            " select id, parent_id, 0 from categories where id = %s"
            " union all select c.id, c.parent_id, up.depth + 1 from categories c join up on c.id = up.parent_id"
            " where up.depth < 20) select id from up order by depth", (category_id,))
        return [r["id"] for r in rows]

    def active_locales(self):
        rows = self._all("select code from locales where is_active order by code")
        return [r["code"] for r in rows] or list(PHASE1_LOCALES)

    def get_source(self, code):
        r = self._one("select id, code, kind, name, is_active from sources where code = %s", (code,))
        return SourceRef(r["id"], r["code"], r["kind"], r["name"], r["is_active"]) if r else None

    def ensure_source(self, code, kind, name):
        self._exec("insert into sources (kind, code, name) values (%s, %s, %s) on conflict (code) do nothing",
                   (kind, code, name))
        return self.get_source(code)

    # catalog ---------------------------------------------------------------
    def find_product_for_offer(self, source_id, external_id):
        r = self._one("select product_id from offers where source_id = %s and external_id = %s",
                      (source_id, external_id))
        return r["product_id"] if r else None

    def find_product_by_gtin(self, gtin):
        r = self._one("select id from products where gtin = %s order by created_at limit 1", (gtin,))
        return r["id"] if r else None

    def get_product_category(self, product_id):
        r = self._one("select category_id from products where id = %s", (product_id,))
        return r["category_id"] if r else None

    def insert_product(self, p):
        from psycopg.types.json import Jsonb

        r = self._one(
            "insert into products (category_id, brand, gtin, image_urls, attributes, rating, review_count) "
            "values (%s, %s, %s, %s, %s, %s, %s) returning id",
            (p.category_id, p.brand, p.gtin, p.image_urls, Jsonb(_jsonable(p.attributes)), p.rating, p.review_count))
        return r["id"]

    def update_product(self, product_id, p):
        from psycopg.types.json import Jsonb

        self._exec(
            "update products set category_id = coalesce(category_id, %s), brand = coalesce(%s, brand), "
            "gtin = coalesce(gtin, %s), image_urls = %s, attributes = attributes || %s, rating = %s, "
            "review_count = %s, updated_at = now() where id = %s",
            (p.category_id, p.brand, p.gtin, p.image_urls, Jsonb(_jsonable(p.attributes)), p.rating,
             p.review_count, product_id))

    def get_translation(self, product_id, locale):
        r = self._one("select title, description, bullet_points from product_translations "
                      "where product_id = %s and locale = %s", (product_id, locale))
        return Translation(title=r["title"], description=r["description"],
                           bullet_points=list(r["bullet_points"] or [])) if r else None

    def translation_locales(self, product_id):
        return {r["locale"] for r in self._all("select locale from product_translations where product_id = %s",
                                               (product_id,))}

    def upsert_translation(self, product_id, locale, t):
        self._exec(
            "insert into product_translations (product_id, locale, title, description, bullet_points) "
            "values (%s, %s, %s, %s, %s) on conflict (product_id, locale) do update set "
            "title = excluded.title, description = excluded.description, bullet_points = excluded.bullet_points",
            (product_id, locale, t.title, t.description, t.bullet_points))

    def upsert_offer(self, o):
        r = self._one(
            "insert into offers (product_id, source_id, external_id, url, cost_usd, list_price_usd, shipping_usd,"
            " stock, ships_from, ships_to, delivery_days_min, delivery_days_max, commission_rate,"
            " last_synced_at, is_active) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "on conflict (source_id, external_id) do update set url = excluded.url, cost_usd = excluded.cost_usd,"
            " list_price_usd = excluded.list_price_usd, shipping_usd = excluded.shipping_usd,"
            " stock = excluded.stock, ships_from = excluded.ships_from, ships_to = excluded.ships_to,"
            " delivery_days_min = excluded.delivery_days_min, delivery_days_max = excluded.delivery_days_max,"
            " commission_rate = excluded.commission_rate, last_synced_at = excluded.last_synced_at,"
            " is_active = excluded.is_active returning id",
            (o.product_id, o.source_id, o.external_id, o.url, o.cost_usd, o.list_price_usd, o.shipping_usd,
             o.stock, o.ships_from, o.ships_to, o.delivery_days_min, o.delivery_days_max, o.commission_rate,
             o.last_synced_at, o.is_active))
        return r["id"]

    def deactivate_stale_offers(self, source_id, synced_before):
        return self._exec("update offers set is_active = false where source_id = %s and is_active and "
                          "(last_synced_at is null or last_synced_at < %s)", (source_id, synced_before))

    def set_display_price(self, offer_id, value):
        if self.supports_display_price:
            self._exec("update offers set display_price_usd = %s where id = %s", (value, offer_id))

    _OFFER_SQL = (
        "select o.*, s.code as source_code, s.kind, p.category_id from offers o "
        "join sources s on s.id = o.source_id join products p on p.id = o.product_id ")

    def _offer_view(self, r: dict) -> OfferView:
        return OfferView(
            id=r["id"], product_id=r["product_id"], source_id=r["source_id"], source_code=r["source_code"],
            kind=r["kind"], external_id=r["external_id"], url=r["url"], cost_usd=r["cost_usd"],
            list_price_usd=r["list_price_usd"], shipping_usd=r["shipping_usd"] or Decimal(0), stock=r["stock"],
            ships_from=(r["ships_from"] or "").strip() or None, ships_to=list(r["ships_to"] or []),
            delivery_days_min=r["delivery_days_min"], delivery_days_max=r["delivery_days_max"],
            is_active=r["is_active"], category_id=r["category_id"], last_synced_at=r["last_synced_at"])

    def get_offer(self, offer_id):
        r = self._one(self._OFFER_SQL + "where o.id = %s", (offer_id,))
        return self._offer_view(r) if r else None

    def list_offers(self, source_id=None, active_only=True):
        sql, params = self._OFFER_SQL + "where true", []
        if source_id:
            sql += " and o.source_id = %s"
            params.append(source_id)
        if active_only:
            sql += " and o.is_active"
        return [self._offer_view(r) for r in self._all(sql, tuple(params))]

    # orders ------------------------------------------------------------------
    def get_order(self, order_id):
        cols = "id, status, currency" + (", shipping_address" if self._has_shipping_address else "")
        r = self._one(f"select {cols} from orders where id = %s", (order_id,))
        if not r:
            return None
        return OrderView(r["id"], r["status"], r["currency"].strip(), r.get("shipping_address"))

    def get_order_items(self, order_id):
        rows = self._all(
            "select oi.id, oi.offer_id, oi.product_id, oi.qty, oi.unit_price, oi.unit_cost_usd, o.external_id,"
            " o.source_id, s.code as source_code, s.kind as source_kind, o.cost_usd, o.shipping_usd "
            "from order_items oi join offers o on o.id = oi.offer_id join sources s on s.id = o.source_id "
            "where oi.order_id = %s order by oi.id", (order_id,))
        return [OrderItemView(**{**r, "shipping_usd": r["shipping_usd"] or Decimal(0)}) for r in rows]

    def set_order_status(self, order_id, status):
        self._exec("update orders set status = %s where id = %s", (status, order_id))

    def set_order_item_unit_cost(self, item_id, unit_cost_usd):
        self._exec("update order_items set unit_cost_usd = %s where id = %s", (unit_cost_usd, item_id))

    def list_supplier_orders(self, order_id=None, statuses=None):
        sql = ("select so.id, so.order_id, so.source_id, s.code as source_code, so.external_order_id, so.status,"
               " so.cost_usd from supplier_orders so join sources s on s.id = so.source_id where true")
        params: list = []
        if order_id:
            sql += " and so.order_id = %s"
            params.append(order_id)
        if statuses is not None:
            sql += " and so.status = any(%s)"
            params.append(list(statuses))
        return [SupplierOrderView(**r) for r in self._all(sql + " order by so.created_at", tuple(params))]

    def create_supplier_order(self, order_id, source_id, external_order_id, status, cost_usd):
        r = self._one("insert into supplier_orders (order_id, source_id, external_order_id, status, cost_usd) "
                      "values (%s, %s, %s, %s, %s) returning id",
                      (order_id, source_id, external_order_id, status, cost_usd))
        return r["id"]

    def update_supplier_order(self, supplier_order_id, *, status, external_order_id=None, cost_usd=None):
        self._exec("update supplier_orders set status = %s, external_order_id = coalesce(%s, external_order_id),"
                   " cost_usd = coalesce(%s, cost_usd), updated_at = now() where id = %s",
                   (status, external_order_id, cost_usd, supplier_order_id))

    def upsert_shipment(self, supplier_order_id, t):
        # No unique key on shipments in 0001; match on (supplier_order_id, tracking_number).
        prev = self._one("select status from shipments where supplier_order_id = %s and tracking_number "
                         "is not distinct from %s order by updated_at desc limit 1",
                         (supplier_order_id, t.tracking_number))
        n = self._exec(
            "update shipments set carrier = %s, tracking_url = %s, status = %s, last_event = %s, updated_at = now() "
            "where supplier_order_id = %s and tracking_number is not distinct from %s",
            (t.carrier, t.tracking_url, t.status, t.last_event, supplier_order_id, t.tracking_number))
        if n == 0:
            self._exec("insert into shipments (supplier_order_id, carrier, tracking_number, tracking_url, status,"
                       " last_event) values (%s, %s, %s, %s, %s, %s)",
                       (supplier_order_id, t.carrier, t.tracking_number, t.tracking_url, t.status, t.last_event))
        return prev["status"] if prev else None


def _product_fields(p: ProductWrite) -> dict:
    d = dict(p.__dict__)
    d.pop("origin_key", None)
    return d


def _jsonable(obj: Any) -> Any:
    return json.loads(json.dumps(obj, default=str))


def open_store(dsn: str | None) -> Store:
    """Postgres when reachable, else raise (callers decide whether to fall back)."""
    if not dsn:
        raise ConnectionError("DATABASE_URL is empty")
    return PostgresStore(dsn)
