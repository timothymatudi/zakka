"""CJ Dropshipping (dropship) - official CJ Open API 2.0.

Docs: https://developers.cjdropshipping.com/  (API 2.0)

Everything below marked TODO(confirm) must be checked against the docs before
live use; mock mode needs no keys.
"""

from __future__ import annotations

import time
from decimal import Decimal

from ..models import ProductPage, SourceProduct, SupplierOrderRequest, SupplierOrderResult, TrackingInfo
from .base import Connector, ConnectorError

BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1"  # TODO(confirm) base path/version


class CJConnector(Connector):
    code = "cj"
    name = "CJ Dropshipping"
    kind = "dropship"
    env_keys = ("CJ_API_EMAIL", "CJ_API_KEY")
    docs_url = "https://developers.cjdropshipping.com/"

    _token: str | None = None
    _token_exp: float = 0.0

    # -- auth ----------------------------------------------------------------
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp:
            return self._token
        # TODO(confirm): CJ has changed the getAccessToken body over time
        # ({"email","password"} vs {"apiKey"}). Check "Authentication" in the docs.
        resp = self.http.post(f"{BASE_URL}/authentication/getAccessToken",
                              json={"email": self.key("CJ_API_EMAIL"), "password": self.key("CJ_API_KEY")})
        body = self._ok(resp)
        self._token = body["data"]["accessToken"]
        self._token_exp = time.time() + 12 * 3600  # TODO(confirm) use accessTokenExpiryDate
        return self._token

    def _ok(self, resp) -> dict:
        resp.raise_for_status()
        body = resp.json()
        if body.get("result") is False or body.get("code") not in (None, 200):
            raise ConnectorError(f"[cj] API error {body.get('code')}: {body.get('message')}")
        return body

    def _get(self, path: str, **params) -> dict:
        resp = self.http.get(f"{BASE_URL}{path}", params=params,
                             headers={"CJ-Access-Token": self._access_token()})
        return self._ok(resp)

    # -- products --------------------------------------------------------------
    def _parse(self, raw: dict) -> SourceProduct:
        # TODO(confirm): field names from GET /product/list. Shipping cost and
        # delivery days per destination come from the freight calculation
        # endpoint (logistic/freightCalculate) and are not in the list payload.
        return SourceProduct(
            external_id=str(raw.get("vid") or raw["pid"]),
            title=raw.get("productNameEn") or raw.get("productName") or "",
            image_urls=[u for u in [raw.get("productImage")] if u],
            category_hint=raw.get("categoryName"),
            currency="USD",
            cost=Decimal(str(raw.get("sellPrice"))) if raw.get("sellPrice") is not None else None,
            attributes={"sku": raw.get("productSku"), "pid": raw.get("pid")},
        )

    def _live_products(self, page: int) -> ProductPage:
        body = self._get("/product/list", pageNum=page, pageSize=self.page_size)
        data = body.get("data") or {}
        items = [self._parse(r) for r in data.get("list", [])]
        total = int(data.get("total") or 0)
        return ProductPage(items=items, page=page,
                           next_page=page + 1 if page * self.page_size < total else None)

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        body = self._get("/product/query", pid=external_id)  # TODO(confirm) pid vs vid lookup
        return self._parse(body["data"]) if body.get("data") else None

    # -- orders ------------------------------------------------------------------
    def _live_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        a = request.address
        # TODO(confirm): payload of shopping/order/createOrderV2 (logisticName,
        # fromCountryCode and payment confirmation step are account-specific).
        payload = {
            "orderNumber": request.reference,
            "shippingCountryCode": a.country_code,
            "shippingProvince": a.region or "",
            "shippingCity": a.city,
            "shippingAddress": " ".join(x for x in [a.line1, a.line2] if x),
            "shippingZip": a.postal_code or "",
            "shippingCustomerName": a.name,
            "shippingPhone": a.phone or "",
            "products": [{"vid": line.variant_id or line.external_id, "quantity": line.qty}
                         for line in request.lines],
        }
        resp = self.http.post(f"{BASE_URL}/shopping/order/createOrderV2", json=payload,
                              headers={"CJ-Access-Token": self._access_token()})
        data = self._ok(resp).get("data") or {}
        cost = data.get("orderAmount")
        return SupplierOrderResult(external_order_id=str(data.get("orderId")), status="placed",
                                   cost_usd=Decimal(str(cost)) if cost is not None else None, raw=data)

    def _live_track(self, external_order_id: str) -> TrackingInfo:
        # TODO(confirm): getOrderDetail field names and status vocabulary.
        data = self._get("/shopping/order/getOrderDetail", orderId=external_order_id).get("data") or {}
        status_map = {"SHIPPED": "in_transit", "DELIVERED": "delivered", "CANCELLED": "cancelled"}
        return TrackingInfo(
            status=status_map.get(str(data.get("orderStatus", "")).upper(), "pending"),
            carrier=data.get("logisticName"),
            tracking_number=data.get("trackNumber"),
            last_event=data.get("orderStatus"),
        )
