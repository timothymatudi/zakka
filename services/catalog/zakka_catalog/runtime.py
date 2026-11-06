"""Wiring helpers: choose a store, build connectors, seed the offline demo store."""

from __future__ import annotations

import logging
import uuid
from typing import Callable

from .config import database_url
from .connectors import load_fixture
from .store import MemoryStore, PostgresStore, Store

log = logging.getLogger(__name__)


def try_postgres(dsn: str | None = None) -> tuple[PostgresStore | None, str]:
    dsn = database_url() if dsn is None else dsn
    if not dsn:
        return None, "DATABASE_URL is empty"
    try:
        return PostgresStore(dsn), "connected"
    except Exception as exc:  # psycopg.OperationalError and friends
        return None, f"database unreachable ({type(exc).__name__}: {str(exc).strip().splitlines()[0][:160]})"


def demo_store(echo: Callable[[str], None] | None = None) -> MemoryStore:
    """MemoryStore with every source synced from fixtures and the demo order loaded."""
    from .devdata import build_dev_store, check_against_dev_catalog

    store = build_dev_store()  # same deterministic ids as packages/fixtures/dev-catalog.json
    check_against_dev_catalog(store)
    for o in load_fixture("orders")["orders"]:
        items = []
        for it in o["items"]:
            offer = store.find_offer(it["source"], it["external_id"])
            if offer:
                items.append({"offer_id": offer.id, "qty": it["qty"], "unit_price": it["unit_price"]})
        store.add_order(uuid.UUID(o["id"]), o["status"], o["currency"], items, o.get("shipping_address"))
    store.echo = echo
    return store


def resolve_store(prefer_memory: bool = False) -> tuple[Store, str]:
    if not prefer_memory:
        pg, note = try_postgres()
        if pg:
            return pg, "postgres"
        log.warning("%s - using in-memory demo store seeded from fixtures", note)
    return demo_store(), "memory"
