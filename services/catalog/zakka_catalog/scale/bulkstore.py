"""Set-based storage for the scale pipeline (millions of offers).

One SQL implementation, two dialects:

* ``SqliteBulkStore``: a local file (bench, tests, offline dev). Same table and
  column names as Postgres.
* ``PostgresBulkStore``: production. Targets the contract schema plus migrations
  0005 to 0007 (offers.display_price_usd, list_price_local/list_currency/shipping_local,
  refresh_tier/next_refresh_at/content_hash, sync_checkpoints). Optional
  engagement columns (``offers.last_engaged_at``, ``products.last_impression_at``)
  are used when present; tiering falls back to affiliate_clicks/order_items otherwise.

All reads are by batch (``external_id = any(...)``/``IN (...)``); nothing loads a
whole source into memory. Writes use executemany inside one transaction per page.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence
from uuid import UUID

from ..models import CategoryRef
from ..pricing import MarkupRule, default_decimals
from ..store import MOCK_NS, load_categories, load_reference, _rule_from_row

TIERS = ("hot", "warm", "cold")
TIER_INTERVAL = {"hot": timedelta(hours=1), "warm": timedelta(days=1), "cold": timedelta(days=7)}
HOT_WINDOW = timedelta(days=7)
WARM_WINDOW = timedelta(days=30)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def offer_id_for(source_id: UUID | str, external_id: str) -> str:
    return str(uuid.uuid5(MOCK_NS, f"offer:{source_id}:{external_id}"))


def product_id_for(gtin: str | None, origin_key: str) -> str:
    return str(uuid.uuid5(MOCK_NS, f"product:{gtin or origin_key}"))


@dataclass(frozen=True)
class SourceInfo:
    id: str
    code: str
    kind: str
    name: str
    is_active: bool = True
    config: dict = field(default_factory=dict)


@dataclass(frozen=True)
class OfferIdx:
    id: str
    product_id: str
    content_hash: str | None
    refresh_tier: str
    category_id: str | None
    is_active: bool
    display_price_usd: Decimal | None = None


@dataclass
class Reference:
    """Small reference data held in memory (categories, rules, FX, locales)."""

    categories: list[CategoryRef]
    rules: list[MarkupRule]
    fx: dict[str, Decimal]
    decimals: dict[str, int]
    locales: list[str]

    def __post_init__(self):
        self._by_id = {str(c.id): c for c in self.categories}
        self._lineage: dict[str, list[str]] = {}
        self.slug_to_id = {c.slug: str(c.id) for c in self.categories}

    def lineage(self, category_id: str | None) -> list[str]:
        if not category_id:
            return []
        if category_id not in self._lineage:
            out, cur, seen = [], category_id, set()
            while cur and cur in self._by_id and cur not in seen:
                seen.add(cur)
                out.append(cur)
                p = self._by_id[cur].parent_id
                cur = str(p) if p else None
            self._lineage[category_id] = out
        return self._lineage[category_id]

    def fx_rate(self, currency: str) -> Decimal | None:
        return Decimal(1) if currency.upper() == "USD" else self.fx.get(currency.upper())

    def currency_decimals(self, currency: str) -> int:
        return self.decimals.get(currency.upper(), default_decimals(currency))


def fixture_reference() -> Reference:
    ref = load_reference()
    return Reference(
        categories=load_categories(),
        rules=[_rule_from_row(r) for r in ref.get("markup_rules", [])],
        fx={f["quote"]: Decimal(str(f["rate"])) for f in ref.get("fx_rates", [])},
        decimals={c["code"]: int(c["decimals"]) for c in ref.get("currencies", [])},
        locales=list(ref.get("locales") or []),
    )


OFFER_COLS = ("id", "product_id", "source_id", "external_id", "url", "cost_usd", "list_price_usd", "shipping_usd",
              "stock", "ships_from", "ships_to", "delivery_days_min", "delivery_days_max", "commission_rate",
              "last_synced_at", "is_active", "display_price_usd", "list_price_local", "list_currency",
              "shipping_local", "content_hash", "refresh_tier", "next_refresh_at")
# On conflict: everything except identity and tier (tier is owned by recompute_tiers).
OFFER_UPDATE_COLS = tuple(c for c in OFFER_COLS if c not in ("id", "product_id", "source_id", "external_id",
                                                              "refresh_tier"))
PRODUCT_COLS = ("id", "category_id", "brand", "gtin", "image_urls", "attributes", "rating", "review_count")


class SqlBulkStore:
    """Dialect-neutral SQL; subclasses supply connection + value adapters."""

    ph = "?"
    name = "sql"

    def __init__(self, reference: Reference):
        self.ref = reference

    # ---- dialect hooks ---------------------------------------------------------
    def _arr(self, v):
        return json.dumps(list(v or []))

    def _js(self, v):
        return json.dumps(v or {}, default=str)

    def _ts(self, v: datetime | None):
        return v.astimezone(timezone.utc).isoformat(timespec="microseconds") if v else None

    def _dec(self, v):
        return str(v) if v is not None else None

    def _read_arr(self, v) -> list:
        return json.loads(v) if isinstance(v, str) else list(v or [])

    def _read_js(self, v) -> dict:
        return json.loads(v) if isinstance(v, str) else dict(v or {})

    def _read_dec(self, v):
        return Decimal(str(v)) if v is not None else None

    def _in(self, values: Sequence, cast: str = "text") -> tuple[str, tuple]:
        return "(" + ",".join([self.ph] * len(values)) + ")", tuple(str(v) for v in values)

    @property
    def has_engagement_columns(self) -> bool:
        return True

    # connection primitives (implemented by subclasses)
    def execute(self, sql: str, params: Sequence = ()) -> Any: ...
    def executemany(self, sql: str, rows: Iterable[Sequence]) -> None: ...
    def query(self, sql: str, params: Sequence = ()) -> list[dict]: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...

    @contextmanager
    def transaction(self) -> Iterator[None]:
        try:
            yield
            self.commit()
        except BaseException:
            self.rollback()
            raise

    def _q(self, sql: str) -> str:
        return sql.replace("?", self.ph) if self.ph != "?" else sql

    # ---- sources & checkpoints ---------------------------------------------------
    def get_source(self, code: str) -> SourceInfo | None:
        rows = self.query(self._q("select id, code, kind, name, is_active, config from sources where code = ?"), (code,))
        if not rows:
            return None
        r = rows[0]
        return SourceInfo(str(r["id"]), r["code"], r["kind"], r["name"], bool(r["is_active"]), self._read_js(r["config"]))

    def ensure_source(self, code: str, kind: str, name: str) -> SourceInfo:
        existing = self.get_source(code)
        if existing:
            return existing
        sid = str(uuid.uuid5(MOCK_NS, f"source:{code}"))
        self.execute(self._q("insert into sources (id, kind, code, name, config) values (?, ?, ?, ?, ?) "
                             "on conflict (code) do nothing"), (sid, kind, code, name, self._js({})))
        self.commit()
        return self.get_source(code)

    def set_source_config(self, source_id: str, config: dict) -> None:
        self.execute(self._q("update sources set config = ? where id = ?"), (self._js(config), source_id))

    def get_checkpoint(self, source_id: str, scope: str) -> dict | None:
        rows = self.query(self._q("select cursor, started_at, stats from sync_checkpoints "
                                  "where source_id = ? and scope = ?"), (source_id, scope))
        if not rows:
            return None
        r = rows[0]
        return {"cursor": r["cursor"], "started_at": self._read_ts(r["started_at"]), "stats": self._read_js(r["stats"])}

    def save_checkpoint(self, source_id: str, scope: str, cursor: str | None, started_at: datetime | None,
                        stats: dict) -> None:
        self.execute(self._q(
            "insert into sync_checkpoints (source_id, scope, cursor, started_at, updated_at, stats) "
            "values (?, ?, ?, ?, ?, ?) on conflict (source_id, scope) do update set cursor = excluded.cursor, "
            "started_at = excluded.started_at, updated_at = excluded.updated_at, stats = excluded.stats"),
            (source_id, scope, cursor, self._ts(started_at), self._ts(utcnow()), self._js(stats)))

    def _read_ts(self, v) -> datetime | None:
        if v is None or isinstance(v, datetime):
            return v
        return datetime.fromisoformat(v)

    # ---- page reads -----------------------------------------------------------------
    def offer_index(self, source_id: str, external_ids: Sequence[str]) -> dict[str, OfferIdx]:
        if not external_ids:
            return {}
        frag, params = self._in(external_ids)
        rows = self.query(self._q(
            "select o.id, o.external_id, o.product_id, o.content_hash, o.refresh_tier, o.is_active, "
            "o.display_price_usd, p.category_id "
            "from offers o join products p on p.id = o.product_id "
            f"where o.source_id = ? and o.external_id in {frag}"), (source_id, *params))
        return {r["external_id"]: OfferIdx(str(r["id"]), str(r["product_id"]), r["content_hash"],
                                           r["refresh_tier"] or "cold",
                                           str(r["category_id"]) if r["category_id"] else None,
                                           bool(r["is_active"]), self._read_dec(r["display_price_usd"]))
                for r in rows}

    def products_by_gtin(self, gtins: Sequence[str]) -> dict[str, str]:
        gtins = sorted({g for g in gtins if g})
        if not gtins:
            return {}
        frag, params = self._in(gtins)
        rows = self.query(self._q(f"select id, gtin from products where gtin in {frag}"), params)
        return {r["gtin"]: str(r["id"]) for r in rows}

    def count_active_offers(self, source_id: str) -> int:
        return int(self.query(self._q("select count(*) as n from offers where source_id = ? and is_active"),
                              (source_id,))[0]["n"])

    # ---- page writes -------------------------------------------------------------------
    def upsert_products(self, rows: list[dict]) -> None:
        if not rows:
            return
        cols = ", ".join(PRODUCT_COLS)
        sql = self._q(
            f"insert into products ({cols}) values ({', '.join(['?'] * len(PRODUCT_COLS))}) "
            "on conflict (id) do update set category_id = coalesce(products.category_id, excluded.category_id), "
            "brand = excluded.brand, gtin = coalesce(products.gtin, excluded.gtin), "
            "image_urls = excluded.image_urls, attributes = excluded.attributes, rating = excluded.rating, "
            "review_count = excluded.review_count")
        self.executemany(sql, [(r["id"], r.get("category_id"), r.get("brand"), r.get("gtin"),
                                self._arr(r.get("image_urls")), self._js(r.get("attributes")),
                                self._dec(r.get("rating")), r.get("review_count") or 0) for r in rows])

    def upsert_translations(self, rows: list[tuple]) -> None:
        if not rows:
            return
        sql = self._q("insert into product_translations (product_id, locale, title, description, bullet_points) "
                      "values (?, ?, ?, ?, ?) on conflict (product_id, locale) do update set title = excluded.title, "
                      "description = excluded.description, bullet_points = excluded.bullet_points")
        self.executemany(sql, [(pid, loc, t, d, self._arr(b)) for pid, loc, t, d, b in rows])

    def upsert_offers(self, rows: list[dict]) -> None:
        if not rows:
            return
        cols = ", ".join(OFFER_COLS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in OFFER_UPDATE_COLS)
        sql = self._q(f"insert into offers ({cols}) values ({', '.join(['?'] * len(OFFER_COLS))}) "
                      f"on conflict (source_id, external_id) do update set {updates}")
        conv = self._offer_converters()
        self.executemany(sql, [tuple(f(r.get(c)) for c, f in conv) for r in rows])

    def _offer_converters(self):
        conv = getattr(self, "_conv", None)
        if conv is None:
            ident = lambda v: v  # noqa: E731
            special = {"ships_to": self._arr, "last_synced_at": self._ts, "next_refresh_at": self._ts,
                       "is_active": self._bool, "refresh_tier": lambda v: v or "cold"}
            for c in ("cost_usd", "list_price_usd", "shipping_usd", "commission_rate", "display_price_usd",
                      "list_price_local", "shipping_local"):
                special[c] = self._dec
            conv = self._conv = [(c, special.get(c, ident)) for c in OFFER_COLS]
        return conv

    def _bool(self, v):
        return 1 if v else 0

    def deactivate_stale(self, source_id: str, synced_before: datetime, chunk: int = 5000) -> list[str]:
        rows = self.query(self._q("select id, product_id from offers where source_id = ? and is_active and "
                                  "(last_synced_at is null or last_synced_at < ?)"),
                          (source_id, self._ts(synced_before)))
        ids = [str(r["id"]) for r in rows]
        for i in range(0, len(ids), chunk):
            frag, params = self._in(ids[i:i + chunk], "uuid")
            self.execute(self._q(f"update offers set is_active = {self._false()} where id in {frag}"), params)
        return sorted({str(r["product_id"]) for r in rows})

    def _false(self):
        return "0"

    def deactivate_offers(self, source_id: str, external_ids: Sequence[str]) -> int:
        if not external_ids:
            return 0
        frag, params = self._in(external_ids)
        return self.execute(self._q(f"update offers set is_active = {self._false()} "
                                    f"where source_id = ? and external_id in {frag}"), (source_id, *params))

    # ---- tiers ----------------------------------------------------------------------------
    def due_offers(self, source_id: str, now: datetime, limit: int) -> list[dict]:
        return self.query(self._q(
            "select id, external_id, refresh_tier, product_id from offers where source_id = ? and is_active "
            "and refresh_tier in ('hot', 'warm') and (next_refresh_at is null or next_refresh_at <= ?) "
            "order by next_refresh_at limit ?"), (source_id, self._ts(now), limit))

    def record_engagement(self, offer_ids: Sequence[str], at: datetime | None = None) -> None:
        if offer_ids and self.has_engagement_columns:
            frag, params = self._in(list(offer_ids), "uuid")
            self.execute(self._q(f"update offers set last_engaged_at = ? where id in {frag}"),
                         (self._ts(at or utcnow()), *params))

    def record_impressions(self, product_ids: Sequence[str], at: datetime | None = None) -> None:
        if product_ids and self.has_engagement_columns:
            frag, params = self._in(list(product_ids), "uuid")
            self.execute(self._q(f"update products set last_impression_at = ? where id in {frag}"),
                         (self._ts(at or utcnow()), *params))

    def recompute_tiers(self, now: datetime) -> dict[str, int]:
        """Set-based tiering. Promoted offers become due immediately; demoted ones keep their date."""
        hot_since, warm_since = self._ts(now - HOT_WINDOW), self._ts(now - WARM_WINDOW)
        new_tier = (
            "case when o.last_engaged_at >= ? then 'hot' "
            "when exists (select 1 from products p where p.id = o.product_id and p.last_impression_at >= ?) "
            "then 'warm' else 'cold' end")
        params = (hot_since, warm_since)
        changed = self.query(self._q(
            f"select o.id, o.product_id, o.refresh_tier as old, {new_tier} as new from offers o "
            f"where o.is_active and o.refresh_tier <> {new_tier}"), params + params)
        promoted = [r for r in changed if _rank(r["new"]) > _rank(r["old"])]
        promoted_ids = {str(r["id"]) for r in promoted}
        for tier in TIERS:
            for is_promotion in (True, False):
                ids = [str(r["id"]) for r in changed if r["new"] == tier and (str(r["id"]) in promoted_ids) == is_promotion]
                for i in range(0, len(ids), 5000):
                    frag, p = self._in(ids[i:i + 5000], "uuid")
                    if is_promotion:  # promoted: refresh now
                        self.execute(self._q(f"update offers set refresh_tier = ?, next_refresh_at = ? where id in {frag}"),
                                     (tier, self._ts(now), *p))
                    else:             # demoted: keep the scheduled date
                        self.execute(self._q(f"update offers set refresh_tier = ? where id in {frag}"), (tier, *p))
        return {"changed": len(changed), "promoted": len(promoted),
                "promoted_product_ids": sorted({str(r["product_id"]) for r in promoted})}

    def set_next_refresh(self, offer_ids: Sequence[str], when: datetime) -> None:
        if offer_ids:
            frag, params = self._in(list(offer_ids), "uuid")
            self.execute(self._q(f"update offers set next_refresh_at = ? where id in {frag}"), (self._ts(when), *params))

    def tier_counts(self) -> dict[str, int]:
        rows = self.query("select refresh_tier, count(*) as n from offers where is_active group by refresh_tier")
        return {r["refresh_tier"]: int(r["n"]) for r in rows}

    # ---- repricing (markup rule / FX changes) -------------------------------------------------
    def offers_for_reprice(self, source_id: str, after_id: str | None, limit: int) -> list[dict]:
        """Keyset page of offers with what pricing needs (no OFFSET: stays fast at millions)."""
        rows = self.query(self._q(
            "select o.id, o.product_id, o.cost_usd, o.shipping_usd, o.list_price_usd, o.list_price_local, "
            "o.list_currency, o.shipping_local, o.display_price_usd, p.category_id from offers o "
            "join products p on p.id = o.product_id where o.source_id = ? "
            + ("and o.id > ? " if after_id else "") + "order by o.id limit ?"),
            (source_id, after_id, limit) if after_id else (source_id, limit))
        for r in rows:
            for k in ("cost_usd", "shipping_usd", "list_price_usd", "list_price_local", "shipping_local",
                      "display_price_usd"):
                r[k] = self._read_dec(r[k])
            r["id"], r["product_id"] = str(r["id"]), str(r["product_id"])
            r["category_id"] = str(r["category_id"]) if r["category_id"] else None
        return rows

    def update_prices(self, rows: list[tuple]) -> None:
        """rows: (list_price_usd, shipping_usd, display_price_usd, offer_id)."""
        if rows:
            self.executemany(self._q("update offers set list_price_usd = ?, shipping_usd = ?, display_price_usd = ? "
                                     "where id = ?"),
                             [(self._dec(a), self._dec(b), self._dec(c), d) for a, b, c, d in rows])

    def list_sources(self) -> list[SourceInfo]:
        return [SourceInfo(str(r["id"]), r["code"], r["kind"], r["name"], bool(r["is_active"]),
                           self._read_js(r["config"]))
                for r in self.query("select id, code, kind, name, is_active, config from sources")]

    # ---- single product (job handlers) --------------------------------------------------------
    def get_product(self, product_id: str) -> dict | None:
        rows = self.query(self._q("select * from products where id = ?"), (product_id,))
        if not rows:
            return None
        r = dict(rows[0])
        r["id"] = str(r["id"])
        r["image_urls"] = self._read_arr(r["image_urls"])
        r["attributes"] = self._read_js(r["attributes"])
        r["category_id"] = str(r["category_id"]) if r.get("category_id") else None
        return r

    def get_translations(self, product_id: str) -> dict[str, dict]:
        rows = self.query(self._q("select locale, title, description, bullet_points from product_translations "
                                  "where product_id = ?"), (product_id,))
        return {r["locale"]: {"title": r["title"], "description": r["description"],
                              "bullet_points": self._read_arr(r["bullet_points"])} for r in rows}

    def set_product_category(self, product_id: str, category_id: str) -> None:
        self.execute(self._q("update products set category_id = coalesce(category_id, ?) where id = ?"),
                     (category_id, product_id))

    def offer_by_external(self, source_id: str, external_id: str) -> dict | None:
        rows = self.query(self._q("select * from offers where source_id = ? and external_id = ?"),
                          (source_id, external_id))
        return dict(rows[0]) if rows else None

    def offer_count(self, source_id: str | None = None, active_only: bool = False) -> int:
        sql, params = "select count(*) as n from offers where 1=1", []
        if source_id:
            sql += " and source_id = ?"
            params.append(source_id)
        if active_only:
            sql += " and is_active"
        return int(self.query(self._q(sql), tuple(params))[0]["n"])

    def product_count(self) -> int:
        return int(self.query("select count(*) as n from products")[0]["n"])


def _rank(tier: str) -> int:
    return {"hot": 3, "warm": 2}.get(tier, 1)


# --------------------------------------------------------------------------------------------
SQLITE_SCHEMA = """
create table if not exists sources (id text primary key, kind text not null, code text not null unique,
  name text not null, is_active integer not null default 1, config text not null default '{}');
create table if not exists products (id text primary key, category_id text, brand text, gtin text,
  image_urls text not null default '[]', attributes text not null default '{}', rating text,
  review_count integer not null default 0, last_impression_at text, is_active integer not null default 1);
create index if not exists products_gtin on products (gtin);
create table if not exists product_translations (product_id text not null, locale text not null,
  title text not null, description text, bullet_points text not null default '[]',
  primary key (product_id, locale));
create table if not exists offers (id text primary key, product_id text not null, source_id text not null,
  external_id text not null, url text, cost_usd text, list_price_usd text, shipping_usd text not null default '0',
  stock integer, ships_from text, ships_to text not null default '[]', delivery_days_min integer,
  delivery_days_max integer, commission_rate text, last_synced_at text, is_active integer not null default 1,
  display_price_usd text, list_price_local text, list_currency text, shipping_local text, content_hash text,
  refresh_tier text not null default 'cold', next_refresh_at text, last_engaged_at text,
  unique (source_id, external_id));
create index if not exists offers_sync on offers (source_id, last_synced_at);
create index if not exists offers_next_refresh on offers (refresh_tier, next_refresh_at);
create table if not exists sync_checkpoints (source_id text not null, scope text not null default 'full',
  cursor text, started_at text, updated_at text not null, stats text not null default '{}',
  primary key (source_id, scope));
"""


class SqliteBulkStore(SqlBulkStore):
    name = "sqlite"

    def __init__(self, path: str | Path = ":memory:", reference: Reference | None = None):
        super().__init__(reference or fixture_reference())
        self.path = str(path)
        self.conn = sqlite3.connect(self.path, timeout=30, isolation_level="DEFERRED", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("pragma journal_mode = wal")
        self.conn.execute("pragma synchronous = normal")
        self.conn.execute("pragma busy_timeout = 30000")
        self.conn.executescript(SQLITE_SCHEMA)
        self.conn.commit()

    def execute(self, sql, params=()):
        return self.conn.execute(sql, params).rowcount

    def executemany(self, sql, rows):
        self.conn.executemany(sql, rows)

    def query(self, sql, params=()):
        return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


class PostgresBulkStore(SqlBulkStore):
    """Production adapter. Reference data comes from the database."""

    name = "postgres"
    ph = "%s"

    def __init__(self, dsn: str, connect_timeout: int = 5):
        import psycopg
        from psycopg.rows import dict_row

        self.conn = psycopg.connect(dsn, connect_timeout=connect_timeout, row_factory=dict_row)
        super().__init__(self._load_reference())
        cols = {(r["table_name"], r["column_name"]) for r in self.query(
            "select table_name, column_name from information_schema.columns where table_schema = current_schema() "
            "and table_name in ('offers', 'products')")}
        self._engagement = ("offers", "last_engaged_at") in cols and ("products", "last_impression_at") in cols

    def _load_reference(self) -> Reference:
        from ..store import PostgresStore

        pg = PostgresStore.__new__(PostgresStore)
        pg.conn = self.conn
        currencies = self.query("select code, decimals from currencies")
        fx = self.query("select quote, rate from fx_rates where base = 'USD'")
        return Reference(categories=pg.list_categories(), rules=pg.list_markup_rules(),
                         fx={r["quote"].strip(): Decimal(r["rate"]) for r in fx},
                         decimals={r["code"].strip(): int(r["decimals"]) for r in currencies},
                         locales=pg.active_locales())

    @property
    def has_engagement_columns(self) -> bool:
        return self._engagement

    def _arr(self, v):
        return list(v or [])

    def _js(self, v):
        from psycopg.types.json import Jsonb

        return Jsonb(json.loads(json.dumps(v or {}, default=str)))

    def _ts(self, v):
        return v

    def _dec(self, v):
        return Decimal(str(v)) if v is not None else None

    def _bool(self, v):
        return bool(v)

    def _false(self):
        return "false"

    def _in(self, values, cast: str = "text"):
        return f"(select unnest(%s::{cast}[]))", (list(map(str, values)),)

    def execute(self, sql, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount

    def executemany(self, sql, rows):
        with self.conn.cursor() as cur:
            cur.executemany(sql, list(rows))

    def query(self, sql, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def recompute_tiers(self, now: datetime) -> dict[str, int]:
        if self._engagement:
            return super().recompute_tiers(now)
        # Fallback until engagement columns exist: hot = clicked or ordered in the last 7 days.
        rows = self.query(
            "with hot as (select offer_id from affiliate_clicks where clicked_at >= %(h)s "
            "  union select oi.offer_id from order_items oi join orders o on o.id = oi.order_id "
            "  where o.created_at >= %(h)s) "
            "update offers set refresh_tier = case when id in (select offer_id from hot) then 'hot' else 'cold' end, "
            "next_refresh_at = case when id in (select offer_id from hot) and refresh_tier <> 'hot' then %(now)s "
            "else next_refresh_at end "
            "where is_active and refresh_tier <> case when id in (select offer_id from hot) then 'hot' else 'cold' end "
            "returning id, product_id, refresh_tier", {"h": now - HOT_WINDOW, "now": now})
        promoted = [r for r in rows if r["refresh_tier"] == "hot"]
        return {"changed": len(rows), "promoted": len(promoted),
                "promoted_product_ids": sorted({str(r["product_id"]) for r in promoted})}


# --------------------------------------------------------------------------------------------
LITE_SCHEMA = """
create table if not exists sources (id text primary key, kind text not null, code text not null unique,
  name text not null, is_active integer not null default 1, config text not null default '{}');
create table if not exists sync_checkpoints (source_id text not null, scope text not null default 'full',
  cursor text, started_at text, updated_at text not null, stats text not null default '{}',
  primary key (source_id, scope));
create table if not exists offers_lite (external_id text primary key, id text not null, product_id text not null,
  category_id text, content_hash text, is_active integer not null, display_price_usd text, last_synced_at text,
  refresh_tier text not null default 'cold') without rowid;
"""


class LiteBenchStore(SqliteBulkStore):
    """Benchmark-only store for one source on a small disk: keeps just the offer index that
    incremental sync needs (external_id, ids, category, content hash, price, active, synced-at).
    Product content and translations are counted, not stored. Not for production use."""

    name = "sqlite-lite"

    def __init__(self, path, reference: Reference | None = None):
        SqlBulkStore.__init__(self, reference or fixture_reference())
        self.path = str(path)
        self.conn = sqlite3.connect(self.path, timeout=30, isolation_level="DEFERRED", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("pragma journal_mode = wal")
        self.conn.execute("pragma synchronous = normal")
        self.conn.executescript(LITE_SCHEMA)
        self.conn.commit()
        self.products_written = 0
        self.translations_written = 0

    def offer_index(self, source_id, external_ids):
        if not external_ids:
            return {}
        frag, params = self._in(external_ids)
        rows = self.query(f"select * from offers_lite where external_id in {frag}", params)
        return {r["external_id"]: OfferIdx(r["id"], r["product_id"], r["content_hash"], r["refresh_tier"],
                                           r["category_id"], bool(r["is_active"]), self._read_dec(r["display_price_usd"]))
                for r in rows}

    def products_by_gtin(self, gtins):
        return {}  # product ids are deterministic (uuid5 of GTIN), so no lookup is needed here

    def count_active_offers(self, source_id):
        return int(self.query("select count(*) as n from offers_lite where is_active")[0]["n"])

    def upsert_products(self, rows):
        self.products_written += len(rows)
        self._cats = {r["id"]: r.get("category_id") for r in rows}

    def upsert_translations(self, rows):
        self.translations_written += len(rows)

    def upsert_offers(self, rows):
        cats = getattr(self, "_cats", {})
        self.executemany(
            "insert into offers_lite values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (external_id) do update set "
            "content_hash = excluded.content_hash, is_active = excluded.is_active, "
            "display_price_usd = excluded.display_price_usd, last_synced_at = excluded.last_synced_at",
            [(r["external_id"], r["id"], r["product_id"], cats.get(r["product_id"]), r["content_hash"],
              1 if r["is_active"] else 0, self._dec(r["display_price_usd"]), self._ts(r["last_synced_at"]),
              r["refresh_tier"] or "cold") for r in rows])
        self._cats = {}

    def deactivate_stale(self, source_id, synced_before, chunk=5000):
        rows = self.query("select product_id from offers_lite where is_active and last_synced_at < ?",
                          (self._ts(synced_before),))
        self.execute("update offers_lite set is_active = 0 where is_active and last_synced_at < ?",
                     (self._ts(synced_before),))
        return sorted({r["product_id"] for r in rows})

    def offer_count(self, source_id=None, active_only=False):
        return int(self.query("select count(*) as n from offers_lite" + (" where is_active" if active_only else ""))[0]["n"])

    def product_count(self):
        return self.products_written

    def tier_counts(self):
        return {r["refresh_tier"]: int(r["n"]) for r in self.query(
            "select refresh_tier, count(*) as n from offers_lite where is_active group by refresh_tier")}
