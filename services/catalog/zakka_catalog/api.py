"""Catalog HTTP API (docs/CONTRACT.md "Catalog HTTP API"), default port 4020.

Contract endpoints:
  GET  /offers/{offer_id}/price?country=XX
       -> { price, currency, price_usd, delivery_days_min, delivery_days_max }
  POST /orders/{order_id}/forward
Additions (non-breaking):
  GET  /health
  POST /prices            batch pricing, for search indexing / carts (read-only, open)
  POST /tracking/poll     poll supplier tracking into shipments
  POST /offers/{id}/refresh   just-in-time re-price + stock check (checkout, product page)
  POST /signals               engagement (hot tier), search impressions (warm tier), locale views
  GET  /live/search           live affiliate search (cached 1h, per-partner daily quotas)
  POST /live/{source}/{external_id}/materialize   store an affiliate item a customer saw/clicked

Auth: state-changing routes (forward, tracking/poll) require
``Authorization: Bearer $CATALOG_API_TOKEN`` (constant-time compare). If
CATALOG_API_TOKEN is empty they are open only in mock mode (no live dropship
connector configured, so nothing real can be ordered) and every call logs a
warning; with a live dropship connector and no token they return 503.
Price routes are always open.
"""

from __future__ import annotations

import hmac
import logging
from decimal import Decimal
from typing import Literal, Mapping
from uuid import UUID

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from .connectors import Connector, all_connectors
from .models import Address
from .notify import ConciergeNotifier
from .orders import OrderNotForwardable, OrderNotFound, forward_order, poll_tracking
from .pricing import PricingError, quote
from .store import Store

log = logging.getLogger(__name__)


def _num(d: Decimal) -> float | int:
    return int(d) if d == d.to_integral_value() and d.as_tuple().exponent >= 0 else float(d)


class PriceOut(BaseModel):
    offer_id: str
    price: int | float  # int for 0-decimal currencies, so JSON shows 2192 not 2192.0
    currency: str
    price_usd: float
    delivery_days_min: int | None
    delivery_days_max: int | None
    kind: str
    ships_to_country: bool


class BatchPriceIn(BaseModel):
    country: str = Field(min_length=2, max_length=2)
    offer_ids: list[UUID] = Field(max_length=500)


OrderStatus = Literal["pending_payment", "paid", "forwarded", "shipped", "delivered", "cancelled", "refunded"]


class SnapshotOrder(BaseModel):
    """Subset of the concierge's Order we trust; other fields are ignored."""

    id: UUID
    status: OrderStatus
    currency: str = Field(min_length=3, max_length=3)
    shipping_address: Address | None = None


class SnapshotItem(BaseModel):
    offer_id: UUID
    qty: int = Field(gt=0, le=1000)
    unit_price: Decimal = Field(ge=0)


class ViewedIn(BaseModel):
    product_id: UUID
    locale: str = Field(min_length=2, max_length=5)


class SignalsIn(BaseModel):
    engaged_offer_ids: list[UUID] = Field(default_factory=list, max_length=1000)
    impression_product_ids: list[UUID] = Field(default_factory=list, max_length=5000)
    viewed: list[ViewedIn] = Field(default_factory=list, max_length=200)


class ForwardIn(BaseModel):
    shipping_address: Address | None = None
    order: SnapshotOrder | None = None  # used only when the store has no shared DB (memory mode)
    items: list[SnapshotItem] | None = Field(default=None, max_length=200)


def adopt_order_snapshot(store: Store, order_id: UUID, body: ForwardIn) -> bool:
    """Persist a posted order into a memory store if it doesn't know the order yet.

    Only ids, status, currency, quantities and unit prices are taken from the body;
    product ids and unit costs come from our own offers. Returns True if adopted.
    """
    if not getattr(store, "accepts_order_snapshots", False) or body.order is None:
        return False
    if body.order.id != order_id:
        raise HTTPException(422, "order.id does not match the order id in the path")
    if store.get_order(order_id) is not None:
        return False  # already known: never overwrite stored state from the request
    if not body.items:
        raise HTTPException(422, "items are required to forward an order the catalog does not know")
    unknown = [str(i.offer_id) for i in body.items if store.get_offer(i.offer_id) is None]
    if unknown:
        raise HTTPException(422, f"unknown offer(s): {', '.join(unknown)}")
    address = body.shipping_address or body.order.shipping_address
    store.add_order(order_id, body.order.status, body.order.currency.upper(),
                    [{"offer_id": i.offer_id, "qty": i.qty, "unit_price": i.unit_price} for i in body.items],
                    address.model_dump() if address else None)
    log.info("adopted posted order snapshot %s (%d items) into the memory store", order_id, len(body.items))
    return True


def price_offer(store: Store, offer_id: UUID, country_code: str) -> PriceOut:
    country = store.get_country(country_code)
    if country is None:
        raise HTTPException(422, f"unknown or inactive country {country_code!r}")
    offer = store.get_offer(offer_id)
    if offer is None:
        raise HTTPException(404, "offer not found")
    if not offer.is_active:
        raise HTTPException(410, "offer is inactive")
    rate = store.get_fx_rate(country.currency)
    if rate is None:
        raise HTTPException(503, f"no fx rate for USD->{country.currency}")
    try:
        q = quote(offer.pricing_input(), currency=country.currency, fx_rate=rate,
                  decimals=store.get_currency_decimals(country.currency), rules=store.list_markup_rules(),
                  category_lineage=store.category_lineage(offer.category_id))
    except PricingError as exc:
        raise HTTPException(409, str(exc)) from exc
    return PriceOut(offer_id=str(offer.id), price=_num(q.price), currency=q.currency, price_usd=_num(q.price_usd),
                    delivery_days_min=offer.delivery_days_min, delivery_days_max=offer.delivery_days_max,
                    kind=offer.kind, ships_to_country=country.code in offer.ships_to)


def bearer_matches(authorization: str | None, expected: str) -> bool:
    scheme, _, given = (authorization or "").strip().partition(" ")
    if scheme.lower() != "bearer" or not given.strip():
        return False
    return hmac.compare_digest(given.strip().encode("utf-8"), expected.encode("utf-8"))


def create_app(store: Store | None = None, connectors: Mapping[str, Connector] | None = None,
               store_name: str | None = None, api_token: str | None = None,
               notifier: ConciergeNotifier | None = None, enricher=None, queue=None,
               live=None) -> FastAPI:
    """``api_token`` defaults to CATALOG_API_TOKEN; pass "" to force the no-token behaviour."""
    from .config import catalog_api_token

    if store is None:
        from .runtime import resolve_store

        store, store_name = resolve_store()
    connectors = dict(connectors) if connectors is not None else all_connectors()
    token = catalog_api_token() if api_token is None else api_token
    live_dropship = sorted(c for c, k in connectors.items() if k.kind == "dropship" and not k.mock)
    if not token:
        if live_dropship:
            log.warning("CATALOG_API_TOKEN is empty and live dropship connectors %s are configured: "
                        "state-changing routes are disabled (503)", live_dropship)
        else:
            log.warning("CATALOG_API_TOKEN is empty: state-changing routes are open (mock mode only)")
    app = FastAPI(title="Zakka Catalog", version="0.1.0")
    app.state.store = store
    if enricher is None:
        from .enrich import get_enricher

        enricher = get_enricher()
    if live is None:
        from .scale.live import LiveAffiliateSearch

        live = LiveAffiliateSearch(connectors)
    app.state.live = live

    def require_write_auth(authorization: str | None = Header(default=None)) -> None:
        if token:
            if not bearer_matches(authorization, token):
                raise HTTPException(401, "missing or invalid bearer token",
                                    headers={"WWW-Authenticate": "Bearer"})
            return
        if live_dropship:
            raise HTTPException(503, "CATALOG_API_TOKEN is not configured; state-changing routes are "
                                     "disabled while live supplier connectors are enabled")
        log.warning("unauthenticated state-changing request allowed: CATALOG_API_TOKEN is empty (mock mode)")

    write_auth = [Depends(require_write_auth)]

    @app.get("/health")
    def health():
        auth = "bearer" if token else ("disabled" if live_dropship else "open-mock-mode")
        return {"status": "ok", "store": store_name or getattr(store, "name", "unknown"), "write_auth": auth,
                "connectors": {c: ("mock" if k.mock else "live") for c, k in connectors.items()}}

    @app.get("/offers/{offer_id}/price", response_model=PriceOut)
    def get_price(offer_id: UUID, country: str = Query(..., min_length=2, max_length=2)):
        return price_offer(store, offer_id, country.upper())

    @app.post("/prices")
    def batch_prices(body: BatchPriceIn):
        out, errors = [], {}
        for oid in body.offer_ids:
            try:
                out.append(price_offer(store, oid, body.country.upper()))
            except HTTPException as exc:
                errors[str(oid)] = exc.detail
        return {"prices": out, "errors": errors}

    @app.post("/orders/{order_id}/forward", dependencies=write_auth)
    def forward(order_id: UUID, body: ForwardIn | None = Body(default=None)):
        if body is not None:
            adopt_order_snapshot(store, order_id, body)
        try:
            res = forward_order(store, order_id, connectors, body.shipping_address if body else None)
        except OrderNotFound:
            raise HTTPException(404, "order not found") from None
        except OrderNotForwardable as exc:
            raise HTTPException(409, str(exc)) from None
        return res.as_dict()

    @app.post("/offers/{offer_id}/refresh", dependencies=write_auth)
    def refresh(offer_id: UUID, country: str | None = Query(None, min_length=2, max_length=2), force: bool = False,
                max_age_minutes: int = Query(60, ge=0, le=24 * 60)):
        from datetime import timedelta

        from .jit import refresh_offer

        try:
            result = refresh_offer(store, connectors, offer_id, enricher, force=force,
                                   max_age=timedelta(minutes=max_age_minutes))
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        if country and result.get("is_active"):
            result["price"] = price_offer(store, offer_id, country.upper()).model_dump()
        return result

    @app.post("/signals", dependencies=write_auth)
    def signals(body: SignalsIn):
        from .jit import record_signals

        return record_signals(store, enricher, engaged_offer_ids=body.engaged_offer_ids,
                              impression_product_ids=body.impression_product_ids,
                              viewed=[v.model_dump() for v in body.viewed], queue=queue)

    @app.get("/live", dependencies=write_auth)
    def live_hits(q: str = Query(..., min_length=1, max_length=200),
                  country: str | None = Query(None, min_length=2, max_length=2),
                  locale: str = Query("en", min_length=2, max_length=5), limit: int = Query(20, ge=1, le=50)):
        source_ids = {code: str(src.id) for code in live.connectors if (src := store.get_source(code))}
        out = live.hits(q, country, fx_rate=store.get_fx_rate, source_ids=source_ids, limit=limit)
        out["locale"] = locale  # live items carry the partner's language; translated once materialized
        return out

    @app.post("/admin/reprice", dependencies=write_auth)
    def admin_reprice():
        """Recompute stored display_price_usd after markup rule / FX edits (the scheduler also
        detects such changes and reprices in streaming jobs)."""
        from .pricing import display_price_usd as dp

        rules, changed = store.list_markup_rules(), 0
        for o in store.list_offers(active_only=False):
            try:
                price = dp(o.pricing_input(), rules=rules, category_lineage=store.category_lineage(o.category_id))
            except PricingError:
                continue
            store.set_display_price(o.id, price)
            changed += 1
        store.commit()
        return {"repriced": changed}

    @app.get("/live/search", dependencies=write_auth)
    def live_search(q: str = Query(..., min_length=1, max_length=200),
                    country: str | None = Query(None, min_length=2, max_length=2),
                    limit: int = Query(20, ge=1, le=50), sources: str | None = None):
        return live.search(q, country, limit=limit, sources=sources.split(",") if sources else None)

    @app.post("/live/{source}/{external_id}/materialize", dependencies=write_auth)
    def materialize(source: str, external_id: str):
        from .sync import ingest_items

        conn = connectors.get(source)
        if conn is None or conn.kind != "affiliate":
            raise HTTPException(404, "unknown affiliate source")
        item = live.cached_item(source, external_id) or conn.fetch_offer(external_id)
        if item is None:
            raise HTTPException(404, "item not found at source")
        rep = ingest_items(store, conn, [item], enricher)
        if not rep.offers:
            raise HTTPException(422, "; ".join(rep.skipped) or "item rejected")
        offer_id = UUID(rep.offers[0].offer_id)
        store.record_engagement([offer_id])
        store.commit()
        return {"offer_id": str(offer_id), "product_id": rep.offers[0].product_id}

    @app.post("/tracking/poll", dependencies=write_auth)
    def tracking_poll():
        return {"updates": [u.__dict__ for u in poll_tracking(store, connectors, notifier)]}

    return app


def run(host: str = "0.0.0.0", port: int | None = None) -> None:  # pragma: no cover - manual entry point
    import uvicorn

    from .config import catalog_port

    uvicorn.run(create_app(), host=host, port=port or catalog_port())
