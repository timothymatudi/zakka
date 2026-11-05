"""Printful (print-on-demand dropship) - official REST API.

Docs: https://developers.printful.com/docs/
Auth: private token as ``Authorization: Bearer <PRINTFUL_API_TOKEN>``.

Products synced are the *store's* sync products (designs already set up in the
Printful dashboard); ``external_id`` is the sync-variant id, which is also what
an order line references.
"""

from __future__ import annotations

from decimal import Decimal

from ..models import ProductPage, SourceProduct, SupplierOrderRequest, SupplierOrderResult, TrackingInfo
from .base import Connector, ConnectorError

BASE_URL = "https://api.printful.com"


class PrintfulConnector(Connector):
    code = "printful"
    name = "Printful"
    kind = "dropship"
    env_keys = ("PRINTFUL_API_TOKEN",)
    docs_url = "https://developers.printful.com/docs/"

    def _headers(self) -> dict[str, str]:
        # TODO(confirm): account-level tokens also need X-PF-Store-Id for store endpoints.
        return {"Authorization": f"Bearer {self.key('PRINTFUL_API_TOKEN')}"}

    def _get(self, path: str, **params) -> dict:
        resp = self.http.get(f"{BASE_URL}{path}", params=params, headers=self._headers())
        resp.raise_for_status()
        return resp.json()

    def _variant_to_product(self, sync_product: dict, variant: dict) -> SourceProduct:
        # Cost = Printful's base price for the catalog variant. TODO(confirm): the
        # sync variant payload exposes retail_price; the wholesale cost comes from
        # GET /products/variant/{catalog_variant_id} ("price"). Shipping and
        # delivery estimates come from POST /shipping/rates per destination.
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
            attributes={"sync_product_id": sync_product.get("id"), "sku": variant.get("sku")},
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

    def _live_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        a = request.address
        payload = {
            "external_id": request.reference[:32],  # TODO(confirm) max length / allowed chars
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
        if resp.status_code >= 400:
            raise ConnectorError(f"[printful] order failed {resp.status_code}: {resp.text[:300]}")
        result = resp.json().get("result", {})
        total = (result.get("costs") or {}).get("total")
        return SupplierOrderResult(external_order_id=str(result["id"]), status="placed",
                                   cost_usd=Decimal(str(total)) if total is not None else None,
                                   raw={"status": result.get("status")})

    def _live_track(self, external_order_id: str) -> TrackingInfo:
        result = self._get(f"/orders/{external_order_id}").get("result", {})
        shipments = result.get("shipments") or []
        status = str(result.get("status", "")).lower()
        if not shipments:
            return TrackingInfo(status="cancelled" if status in ("canceled", "failed") else "pending",
                                last_event=status or None)
        s = shipments[-1]
        # TODO(confirm): delivery confirmation field on shipments (carrier events may be needed).
        delivered = bool(s.get("delivered_at"))
        return TrackingInfo(
            status="delivered" if delivered else "in_transit",
            carrier=s.get("carrier"), tracking_number=s.get("tracking_number"),
            tracking_url=s.get("tracking_url"), last_event=status or None,
        )
