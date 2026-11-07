"""Printful (print-on-demand dropship) - official REST API v1.

Docs: https://developers.printful.com/docs/ (checked 2026-11)

* Auth: private token as ``Authorization: Bearer <PRINTFUL_API_TOKEN>``. Private tokens
  expire and cannot be refreshed, so replace them before their expiry date. An
  *account*-level token also needs a store: set ``PRINTFUL_STORE_ID`` (sent as
  ``X-PF-Store-Id``). Store-level tokens need nothing else.
* Rate limit: 120 requests per minute (429 with ``Retry-After`` above that).
* Products synced are the store's sync products (designs set up in the Printful
  dashboard); ``external_id`` is the sync-variant id, which is what an order line uses.
* Order ``external_id``: at most 32 characters of letters, digits, ``-`` and ``_``,
  unique per store. Orders can be read back by it (``/orders/@<external_id>``), which
  makes retries safe.
"""

from __future__ import annotations

import re
from decimal import Decimal

import httpx

from ..models import ProductPage, SourceProduct, SupplierOrderRequest, SupplierOrderResult, TrackingInfo
from .base import Connector, ConnectorError

BASE_URL = "https://api.printful.com"


def order_external_id(reference: str) -> str:
    """Our order id (a uuid) as a Printful external_id: dashes dropped, 32 characters max."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", reference.replace("-", ""))
    return cleaned[:32] or "zakka"


class PrintfulConnector(Connector):
    code = "printful"
    name = "Printful"
    kind = "dropship"
    env_keys = ("PRINTFUL_API_TOKEN",)
    docs_url = "https://developers.printful.com/docs/"
    rate_limit_per_sec = 2.0  # 120 requests per minute

    def _headers(self) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self.key('PRINTFUL_API_TOKEN')}"}
        if self.key("PRINTFUL_STORE_ID"):
            headers["X-PF-Store-Id"] = self.key("PRINTFUL_STORE_ID")
        return headers

    def _check(self, resp: httpx.Response) -> dict:
        if resp.status_code == 429:
            raise ConnectorError(f"[printful] rate limited, retry after {resp.headers.get('Retry-After', '?')}s")
        if resp.status_code >= 400:
            raise ConnectorError(f"[printful] HTTP {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    def _get(self, path: str, **params) -> dict:
        return self._check(self.http.get(f"{BASE_URL}{path}", params=params, headers=self._headers()))

    def _variant_to_product(self, sync_product: dict, variant: dict) -> SourceProduct:
        # Cost = Printful's base price for the catalog variant (GET /products/variant/{id} -> variant.price).
        # The sync variant's retail_price is the store's own price, not what Zakka pays.
        catalog_variant_id = (variant.get("product") or {}).get("variant_id")
        cost = None
        if catalog_variant_id:
            v = self._get(f"/products/variant/{catalog_variant_id}").get("result", {}).get("variant", {})
            cost = Decimal(str(v["price"])) if v.get("price") is not None else None
        files = variant.get("files") or []
        previews = [f.get("preview_url") for f in files if f.get("preview_url")]
        return SourceProduct(
            external_id=str(variant["id"]),
            title=variant.get("name") or sync_product.get("name", ""),
            image_urls=previews or [u for u in [sync_product.get("thumbnail_url")] if u],
            currency=variant.get("currency") or "USD",
            cost=cost,
            attributes={"sync_product_id": sync_product.get("id"), "sku": variant.get("sku"),
                        "catalog_variant_id": catalog_variant_id},
        )

    def _live_products(self, page: int) -> ProductPage:
        offset = (page - 1) * self.page_size
        body = self._get("/store/products", offset=offset, limit=self.page_size)
        items: list[SourceProduct] = []
        for sp in body.get("result", []):
            detail = self._get(f"/store/products/{sp['id']}").get("result", {})
            for v in detail.get("sync_variants", []):
                items.append(self._variant_to_product(detail.get("sync_product", sp), v))
        total = int((body.get("paging") or {}).get("total") or 0)
        return ProductPage(items=items, page=page,
                           next_page=page + 1 if offset + self.page_size < total else None)

    def _live_detail(self, external_id: str) -> SourceProduct | None:
        # The listing already reads each sync product's full detail (variants, files).
        return None

    def _existing_order(self, external_id: str) -> dict | None:
        resp = self.http.get(f"{BASE_URL}/orders/@{external_id}", headers=self._headers())
        if resp.status_code == 404:
            return None
        return self._check(resp).get("result") or None

    def _live_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        a = request.address
        external_id = order_external_id(request.reference)
        existing = self._existing_order(external_id)
        if existing:  # a retry after a timeout: never submit (and pay for) the same order twice
            total = (existing.get("costs") or {}).get("total")
            return SupplierOrderResult(external_order_id=str(existing["id"]), status="placed",
                                       cost_usd=Decimal(str(total)) if total is not None else None,
                                       raw={"status": existing.get("status"), "reused": True})
        payload = {
            "external_id": external_id,
            "recipient": {
                "name": a.name, "address1": a.line1, "address2": a.line2 or "",
                "city": a.city, "state_code": a.region or "", "country_code": a.country_code,
                "zip": a.postal_code or "", "phone": a.phone or "", "email": a.email or "",
            },
            "items": [{"sync_variant_id": int(line.external_id), "quantity": line.qty}
                      for line in request.lines],
        }
        # confirm=true submits for fulfilment immediately (charged to the Printful wallet/card).
        resp = self.http.post(f"{BASE_URL}/orders", params={"confirm": "true"}, json=payload,
                              headers=self._headers())
        result = self._check(resp).get("result", {})
        total = (result.get("costs") or {}).get("total")
        return SupplierOrderResult(external_order_id=str(result["id"]), status="placed",
                                   cost_usd=Decimal(str(total)) if total is not None else None,
                                   raw={"status": result.get("status")})

    def _live_track(self, external_order_id: str) -> TrackingInfo:
        result = self._get(f"/orders/{external_order_id}").get("result", {})
        shipments = result.get("shipments") or []
        status = str(result.get("status", "")).lower()
        if status in ("canceled", "failed"):
            return TrackingInfo(status="cancelled", last_event=status)
        if not shipments:
            return TrackingInfo(status="exception" if status == "onhold" else "pending", last_event=status or None)
        s = shipments[-1]
        # Printful's shipment object has no delivery confirmation (only shipped_at), so a shipped
        # order stays "in_transit"; delivery comes from the carrier's tracking page.
        return TrackingInfo(
            status="in_transit",
            carrier=s.get("carrier"), tracking_number=s.get("tracking_number"),
            tracking_url=s.get("tracking_url"), last_event=status or None,
        )
