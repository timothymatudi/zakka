"""AliExpress Open Platform: Dropshipping (aliexpress_ds) and Portals affiliate (aliexpress_aff).

Docs: https://openservice.aliexpress.com/doc/doc.htm  (Dropshipping and Affiliate solutions)

Both use the same gateway and request signing (HMAC-SHA256 over the sorted
parameters, app secret as key, upper-case hex). Business methods referenced
below (aliexpress.ds.* / aliexpress.affiliate.*) are TODO(confirm) by name and
field mapping against the current docs.

Credentials:
* Dropshipping: ALIEXPRESS_DS_APP_KEY + ALIEXPRESS_DS_APP_SECRET + the seller's
  OAuth access token ALIEXPRESS_DS_ACCESS_TOKEN (sent as ``session``).
  TODO(confirm): token lifetime/refresh flow (/auth/token/refresh).
* Portals affiliate: ALIEXPRESS_AFF_APP_KEY + ALIEXPRESS_AFF_APP_SECRET (signing)
  + ALIEXPRESS_AFF_TRACKING_ID.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from decimal import Decimal
from typing import Mapping

from ..models import ProductPage, SourceProduct
from .base import Connector, ConnectorError, NotConfirmedError

GATEWAY = "https://api-sg.aliexpress.com/sync"  # TODO(confirm) gateway host for your region
DOCS = "https://openservice.aliexpress.com/doc/doc.htm"


def sign_params(params: Mapping[str, str], app_secret: str, api_path: str | None = None) -> str:
    """AliExpress Open Platform signature (TOP-style, sha256).

    TODO(confirm): for "system" APIs (e.g. /auth/token/create) the API path is
    prefixed to the string to sign; business APIs on /sync are not prefixed.
    """
    base = "".join(f"{k}{params[k]}" for k in sorted(params) if k != "sign")
    if api_path:
        base = api_path + base
    return hmac.new(app_secret.encode(), base.encode(), hashlib.sha256).hexdigest().upper()


class _AliExpressBase(Connector):
    docs_url = DOCS
    rate_limit_per_sec = 5.0  # TODO(confirm) app-level QPS limit in the open platform console

    def _call(self, method: str, app_key: str, app_secret: str, session: str | None = None,
              **biz: str) -> dict:
        params = {"app_key": app_key, "method": method, "sign_method": "sha256",
                  "timestamp": str(int(time.time() * 1000)), **{k: str(v) for k, v in biz.items()}}
        if session:
            params["session"] = session
        params["sign"] = sign_params(params, app_secret)
        resp = self.http.post(GATEWAY, data=params)
        resp.raise_for_status()
        body = resp.json()
        if "error_response" in body:
            raise ConnectorError(f"[{self.code}] {body['error_response']}")
        return body


class AliExpressDropshipConnector(_AliExpressBase):
    code = "aliexpress_ds"
    name = "AliExpress Dropshipping"
    kind = "dropship"
    env_keys = ("ALIEXPRESS_DS_APP_KEY", "ALIEXPRESS_DS_APP_SECRET", "ALIEXPRESS_DS_ACCESS_TOKEN")

    def _session(self) -> str:
        return self.key("ALIEXPRESS_DS_ACCESS_TOKEN")

    def _live_products(self, page: int) -> ProductPage:
        # TODO(confirm): aliexpress.ds.recommend.feed.get (feed_name, page_no, page_size,
        # target_currency, target_language, ship_to_country) and its response shape.
        body = self._call("aliexpress.ds.recommend.feed.get", self.key("ALIEXPRESS_DS_APP_KEY"),
                          self.key("ALIEXPRESS_DS_APP_SECRET"), self._session(),
                          page_no=page, page_size=self.page_size, target_currency="USD")
        raise NotConfirmedError(self.code, f"response mapping (got keys {list(body)[:3]})", DOCS)


class AliExpressAffiliateConnector(_AliExpressBase):
    code = "aliexpress_aff"
    name = "AliExpress Portals"
    kind = "affiliate"
    env_keys = ("ALIEXPRESS_AFF_APP_KEY", "ALIEXPRESS_AFF_APP_SECRET", "ALIEXPRESS_AFF_TRACKING_ID")

    def _live_products(self, page: int) -> ProductPage:
        # TODO(confirm): method params and the response envelope
        # (aliexpress_affiliate_product_query_response.resp_result.result.products.product).
        # Products still need ships_to / delivery days, which this method does not return;
        # until a source for those is confirmed, items without ships_to are skipped by sync.
        tracking_id = self.key("ALIEXPRESS_AFF_TRACKING_ID")
        body = self._call("aliexpress.affiliate.product.query", self.key("ALIEXPRESS_AFF_APP_KEY"),
                          self.key("ALIEXPRESS_AFF_APP_SECRET"), page_no=page, page_size=self.page_size,
                          target_currency="USD", tracking_id=tracking_id)
        result = (((body.get("aliexpress_affiliate_product_query_response") or {}).get("resp_result") or {})
                  .get("result") or {})
        raw_items = (result.get("products") or {}).get("product") or []
        items = [self.parse_product(r, tracking_id) for r in raw_items]
        total = int(result.get("total_record_count") or 0)
        return ProductPage(items=items, page=page,
                           next_page=page + 1 if page * self.page_size < total else None)

    @staticmethod
    def parse_product(raw: dict, tracking_id: str) -> SourceProduct:
        """TODO(confirm) field names of aliexpress.affiliate.product.query results."""
        return SourceProduct(
            external_id=str(raw["product_id"]),
            title=raw.get("product_title", ""),
            image_urls=[u for u in [raw.get("product_main_image_url")] if u],
            url=raw.get("promotion_link"),
            currency=raw.get("target_sale_price_currency", "USD"),
            list_price=Decimal(str(raw["target_sale_price"])) if raw.get("target_sale_price") else None,
            commission_rate=(Decimal(str(raw["commission_rate"]).rstrip("%")) / 100
                             if raw.get("commission_rate") else None),
            attributes={"tracking_id": tracking_id},
        )
