"""Catalog HTTP API (docs/CONTRACT.md "Catalog HTTP API"), default port 4020.

Contract endpoints:
  GET  /offers/{offer_id}/price?country=XX
       -> { price, currency, price_usd, delivery_days_min, delivery_days_max }
  POST /orders/{order_id}/forward
Additions (non-breaking):
  GET  /health
  POST /prices            batch pricing, for search indexing / carts (read-only, open)
  POST /tracking/poll     poll supplier tracking into shipments

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
from typing import Mapping
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
    price: float
    currency: str
    price_usd: float
    delivery_days_min: int | None
    delivery_days_max: int | None
    kind: str
    ships_to_country: bool


class BatchPriceIn(BaseModel):
    country: str = Field(min_length=2, max_length=2)
    offer_ids: list[UUID] = Field(max_length=500)


class ForwardIn(BaseModel):
    shipping_address: Address | None = None


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
               notifier: ConciergeNotifier | None = None) -> FastAPI:
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
        try:
            res = forward_order(store, order_id, connectors, body.shipping_address if body else None)
        except OrderNotFound:
            raise HTTPException(404, "order not found") from None
        except OrderNotForwardable as exc:
            raise HTTPException(409, str(exc)) from None
        return res.as_dict()

    @app.post("/tracking/poll", dependencies=write_auth)
    def tracking_poll():
        return {"updates": [u.__dict__ for u in poll_tracking(store, connectors, notifier)]}

    return app


def run(host: str = "0.0.0.0", port: int | None = None) -> None:  # pragma: no cover - manual entry point
    import uvicorn

    from .config import catalog_port

    uvicorn.run(create_app(), host=host, port=port or catalog_port())
