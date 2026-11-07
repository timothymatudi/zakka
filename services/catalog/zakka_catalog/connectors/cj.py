"""CJ Dropshipping (dropship) - official CJ Open API 2.0.

Docs: https://developers.cjdropshipping.com/en/api/api2/api/auth.html (checked 2026-11)

* Auth: ``POST /authentication/getAccessToken`` with ``{"apiKey"}`` (the old
  email/password body is deprecated). Access tokens last 15 days, refresh tokens
  180 days. Getting a token is limited to once per 5 minutes, so the token is
  cached and renewed with ``/authentication/refreshAccessToken``.
* Every endpoint allows 1 request per second (QPS 1).
* Orders: ``createOrderV3`` needs ``logisticName`` and ``fromCountryCode``; the
  carrier is picked with ``/logistic/freightCalculate`` (cheapest option). The
  order is then paid from the CJ balance (``/shopping/pay/payBalanceV2``).
  ``getOrderDetail`` accepts our own order number, which makes retries safe.
* ``CJ_SANDBOX=1`` creates sandbox orders, which CJ pays with a simulated charge.
* ``CJ_FROM_COUNTRY`` (default ``CN``) is the warehouse country orders ship from.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation

import httpx

from ..models import ProductPage, SourceProduct, SupplierOrderRequest, SupplierOrderResult, TrackingInfo
from .base import Connector, ConnectorError

BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1"

#: getOrderDetail ``orderStatus`` -> our tracking status.
STATUS_MAP = {
    "CREATED": "pending", "IN_CART": "pending", "UNPAID": "pending", "PENDING": "pending",
    "PROCESSING": "pending", "UNSHIPPED": "pending",
    "SHIPPED": "in_transit", "DELIVERED": "delivered", "CANCELLED": "cancelled",
}
UNPAID = {"CREATED", "IN_CART", "UNPAID"}


def _money(value) -> Decimal | None:
    """CJ prices are numbers or strings; product-level ``sellPrice`` can be a range like "1.20 -- 3.40"."""
    if value is None or value == "":
        return None
    nums = re.findall(r"\d+(?:\.\d+)?", str(value))
    try:
        return min(Decimal(n) for n in nums) if nums else None
    except InvalidOperation:
        return None


def _expiry(value: str | None, fallback_seconds: float) -> float:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return time.time() + fallback_seconds


class CJConnector(Connector):
    code = "cj"
    name = "CJ Dropshipping"
    kind = "dropship"
    env_keys = ("CJ_API_KEY",)
    docs_url = "https://developers.cjdropshipping.com/"
    rate_limit_per_sec = 1.0  # QPS 1 on every endpoint
    page_size = 200  # product/list maximum

    _token: str | None = None
    _token_exp: float = 0.0
    _refresh: str | None = None
    _refresh_exp: float = 0.0

    # -- auth ----------------------------------------------------------------
    def _access_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_exp - 3600:
            return self._token
        if self._refresh and now < self._refresh_exp - 3600:
            try:
                return self._store_token(self._post_raw("/authentication/refreshAccessToken",
                                                        {"refreshToken": self._refresh}))
            except ConnectorError:
                pass  # fall back to a new token
        return self._store_token(self._post_raw("/authentication/getAccessToken", {"apiKey": self.key("CJ_API_KEY")}))

    def _store_token(self, body: dict) -> str:
        data = body.get("data") or {}
        if not data.get("accessToken"):
            raise ConnectorError("[cj] no accessToken in auth response")
        self._token = data["accessToken"]
        self._token_exp = _expiry(data.get("accessTokenExpiryDate"), 15 * 86400)
        self._refresh = data.get("refreshToken") or self._refresh
        self._refresh_exp = _expiry(data.get("refreshTokenExpiryDate"), 180 * 86400)
        return self._token

    # -- http ----------------------------------------------------------------
    def _ok(self, resp: httpx.Response) -> dict:
        try:
            body = resp.json()
        except ValueError:
            raise ConnectorError(f"[cj] HTTP {resp.status_code}: non-JSON response") from None
        if resp.status_code >= 400 or body.get("result") is False or body.get("code") not in (None, 200):
            raise ConnectorError(f"[cj] API error {body.get('code') or resp.status_code}: {body.get('message')}")
        return body

    def _post_raw(self, path: str, payload: dict) -> dict:
        return self._ok(self.http.post(f"{BASE_URL}{path}", json=payload))

    def _headers(self) -> dict[str, str]:
        return {"CJ-Access-Token": self._access_token()}

    def _get(self, path: str, **params) -> dict:
        return self._ok(self.http.get(f"{BASE_URL}{path}", params=params, headers=self._headers()))

    def _post(self, path: str, payload: dict) -> dict:
        return self._ok(self.http.post(f"{BASE_URL}{path}", json=payload, headers=self._headers()))

    # -- products --------------------------------------------------------------
    def _parse(self, raw: dict) -> SourceProduct:
        """An item of ``GET /product/list`` (documented fields)."""
        return SourceProduct(
            external_id=str(raw["pid"]),
            title=raw.get("productNameEn") or raw.get("productName") or "",
            image_urls=[u for u in [raw.get("productImage")] if u],
            category_hint=raw.get("categoryName"),
            currency="USD",
            cost=_money(raw.get("sellPrice")),
            attributes={"sku": raw.get("productSku"), "pid": raw.get("pid"),
                        "weight_g": raw.get("productWeight"), "free_shipping": raw.get("isFreeShipping")},
        )

    def _live_products(self, page: int) -> ProductPage:
        # product/list is marked "no further enhancements" (listV2 is capped at 6000 results per
        # query), but it is still the documented way to page through the whole catalogue.
        body = self._get("/product/list", pageNum=page, pageSize=self.page_size)
        data = body.get("data") or {}
        items = [self._parse(r) for r in data.get("list", []) if r.get("pid")]
        total = int(data.get("total") or 0)
        return ProductPage(items=items, page=page,
                           next_page=page + 1 if page * self.page_size < total else None)

    def _query(self, pid: str) -> dict | None:
        return self._get("/product/query", pid=pid).get("data") or None

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        """Product details (``GET /product/query``): gallery, description and variants."""
        data = self._query(external_id)
        if not data:
            return None
        variants = data.get("variants") or []
        images = list(dict.fromkeys([u for u in [data.get("bigImage"), *(data.get("productImageSet") or [])] if u]))
        prices = [p for p in (_money(v.get("variantSellPrice")) for v in variants) if p is not None]
        return SourceProduct(
            external_id=str(data.get("pid") or external_id),
            title=data.get("productNameEn") or data.get("productName") or "",
            description=data.get("description"),
            image_urls=images,
            category_hint=data.get("categoryName"),
            currency="USD",
            cost=min(prices) if prices else _money(data.get("sellPrice")),
            attributes={
                "sku": data.get("productSku"), "pid": data.get("pid"),
                "variants": [{"vid": v.get("vid"), "sku": v.get("variantSku"), "name": v.get("variantNameEn"),
                              "key": v.get("variantKey"), "price": str(_money(v.get("variantSellPrice")) or ""),
                              "image": v.get("variantImage")} for v in variants],
            },
        )

    # -- orders ------------------------------------------------------------------
    def _resolve_vid(self, external_id: str, variant_id: str | None) -> str:
        """Orders need a variant id. Our offers are products (pid); one-variant products resolve on their own."""
        if variant_id:
            return variant_id
        try:
            data = self._query(external_id)
        except ConnectorError:
            data = None
        variants = (data or {}).get("variants") or []
        if not variants:
            return external_id  # already a vid
        if len(variants) == 1:
            return str(variants[0]["vid"])
        raise ConnectorError(f"[cj] product {external_id} has {len(variants)} variants; the order line must name one")

    def _cheapest_logistic(self, start: str, end: str, zip_code: str | None, products: list[dict]) -> dict:
        body = self._post("/logistic/freightCalculate", {
            "startCountryCode": start, "endCountryCode": end, "zip": zip_code or "", "products": products})
        options = [o for o in (body.get("data") or []) if o.get("logisticName") and _money(o.get("logisticPrice")) is not None]
        if not options:
            raise ConnectorError(f"[cj] no shipping option from {start} to {end}")
        return min(options, key=lambda o: _money(o.get("logisticPrice")))

    def _existing_order(self, reference: str) -> dict | None:
        try:
            return self._get("/shopping/order/getOrderDetail", orderId=reference).get("data") or None
        except ConnectorError:
            return None

    def _pay(self, cj_order_id: str, shipment_order_id: str | None) -> None:
        if shipment_order_id:
            self._post("/shopping/pay/payBalanceV2", {"shipmentOrderId": shipment_order_id})
        else:
            self._post("/shopping/pay/payBalance", {"orderId": cj_order_id})

    def _live_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        reference = request.reference[:50]
        # Retry-safe: CJ rejects a second order with the same orderNumber, so look for it first.
        existing = self._existing_order(reference)
        if existing:
            cj_id = str(existing.get("orderId") or existing.get("cjOrderId"))
            if str(existing.get("orderStatus", "")).upper() in UNPAID:
                self._pay(cj_id, None)
            return SupplierOrderResult(external_order_id=cj_id, status="placed",
                                       cost_usd=_money(existing.get("orderAmount")),
                                       raw={"orderStatus": existing.get("orderStatus"), "reused": True})

        a = request.address
        start = (self.key("CJ_FROM_COUNTRY") or "CN").upper()
        products = [{"vid": self._resolve_vid(line.external_id, line.variant_id), "quantity": line.qty}
                    for line in request.lines]
        logistic = self._cheapest_logistic(start, a.country_code, a.postal_code, products)
        payload = {
            "orderNumber": reference,
            "shippingCountryCode": a.country_code,
            "shippingCountry": a.country_code,
            "shippingProvince": a.region or a.city,
            "shippingCity": a.city,
            "shippingAddress": a.line1,
            "shippingAddress2": a.line2 or "",
            "shippingZip": a.postal_code or "",
            "shippingCustomerName": a.name,
            "shippingPhone": a.phone or "",
            "email": a.email or "",
            "logisticName": logistic["logisticName"],
            "fromCountryCode": start,
            "products": products,
        }
        if self.key("CJ_SANDBOX") == "1":
            payload["isSandbox"] = 1
        data = self._post("/shopping/order/createOrderV3", payload).get("data") or {}
        cj_id = str(data.get("orderId") or "")
        if not cj_id:
            raise ConnectorError("[cj] createOrderV3 returned no orderId")
        self._pay(cj_id, data.get("shipmentOrderId"))
        return SupplierOrderResult(
            external_order_id=cj_id, status="placed", cost_usd=_money(data.get("orderAmount")),
            raw={"logisticName": logistic["logisticName"], "logisticAging": logistic.get("logisticAging"),
                 "orderStatus": data.get("orderStatus"), "sandbox": payload.get("isSandbox") == 1},
        )

    def _live_track(self, external_order_id: str) -> TrackingInfo:
        data = self._get("/shopping/order/getOrderDetail", orderId=external_order_id).get("data") or {}
        raw_status = str(data.get("orderStatus", "")).upper()
        return TrackingInfo(
            status=STATUS_MAP.get(raw_status, "pending"),
            carrier=data.get("logisticName") or data.get("trackingProvider"),
            tracking_number=data.get("trackNumber"),
            tracking_url=data.get("trackingUrl"),
            last_event=data.get("subStatus") or data.get("orderStatus"),
        )
