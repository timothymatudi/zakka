"""Regional market leaders where Zakka had no local store: Latin America, Southeast Asia, Japan, Korea.

All are affiliate sources (official affiliate programs only; never scraping).

What was confirmed in 2026-11, and what was not:

* Rakuten Ichiba (Japan): Rakuten Web Service Item Search API ``IchibaItem/Search/20220601`` with
  ``applicationId`` and ``affiliateId`` (the response then carries ``affiliateUrl``); ``hits`` max 30,
  ``formatVersion=2``. TODO(confirm): the newer ``openapi.rakuten.co.jp`` host also needs an
  ``accessKey``; the docs site was down when this was written, so it is sent both as a query parameter
  and as a header until confirmed.
* Coupang (Korea): Coupang Partners Open API ``products/search`` with HMAC-SHA256 ``CEA`` authorization
  (Coupang's own sample code). TODO(confirm): response field names against your Partners dashboard.
* Shopee (Southeast Asia, Brazil, Taiwan): Shopee Affiliate Open API (GraphQL ``productOfferV2``), one
  host per country, ``SHA256 Credential/Timestamp/Signature`` authorization. Shopee documents it only
  inside the affiliate dashboard, so TODO(confirm) the signature and fields after approval.
* Lazada (Southeast Asia): affiliates get product datafeeds (CSV) from the affiliate dashboard, and its
  terms forbid crawling. Set ``LAZADA_FEED_URLS`` to your feed links. TODO(confirm) the feed columns.
* Mercado Libre (Latin America): the public developer docs no longer document keyword search (the
  search resource is now seller-scoped), and the affiliate program builds links in its portal. Live
  mode raises ``NotConfirmedError`` until the affiliate program provides a product API or feed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

from ..models import ProductPage, SourceProduct
from .base import Connector, ConnectorError, NotConfirmedError, NotSupportedError
from .networks import DEFAULT_COMMISSION, _AffiliateBase, _csv_list, _dec, _first, _read_csv


# ---- Rakuten Ichiba (Japan) ------------------------------------------------------------------------------

class RakutenIchibaConnector(_AffiliateBase):
    code = "rakuten_ichiba"
    name = "Rakuten Ichiba"
    env_keys = ("RAKUTEN_APP_ID", "RAKUTEN_AFFILIATE_ID")
    docs_url = "https://webservice.rakuten.co.jp/documentation/ichiba-item-search"
    seed_env = "RAKUTEN_ICHIBA_SEED_QUERIES"
    page_size = 30  # hits maximum
    rate_limit_per_sec = 1.0  # Rakuten Web Service: about 1 request per second per application
    API = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601"

    def _search(self, keyword: str, hits: int, page: int = 1) -> list[SourceProduct]:
        params: dict[str, Any] = {
            "applicationId": self.key("RAKUTEN_APP_ID"), "affiliateId": self.key("RAKUTEN_AFFILIATE_ID"),
            "keyword": keyword, "hits": min(hits, 30), "page": page, "format": "json", "formatVersion": 2,
            "availability": 1,
        }
        headers = {}
        if self.key("RAKUTEN_ACCESS_KEY"):
            params["accessKey"] = self.key("RAKUTEN_ACCESS_KEY")
            headers["accessKey"] = self.key("RAKUTEN_ACCESS_KEY")
        body = self._check(self.http.get(self.API, params=params, headers=headers)).json()
        if body.get("error"):
            raise ConnectorError(f"[rakuten_ichiba] {body.get('error')}: {body.get('error_description')}")
        return [p for p in (self._parse(i) for i in body.get("Items") or []) if p]

    def _parse(self, raw: dict) -> SourceProduct | None:
        item = raw.get("Item", raw)  # formatVersion 1 wraps each item in {"Item": {...}}
        price, url = _dec(item.get("itemPrice")), item.get("affiliateUrl") or item.get("itemUrl")
        if price is None or not url or not item.get("itemCode"):
            return None
        images = [i if isinstance(i, str) else i.get("imageUrl") for i in item.get("mediumImageUrls") or []]
        rate = _dec(item.get("affiliateRate"))
        return SourceProduct(
            external_id=str(item["itemCode"]),
            title=item.get("itemName") or "",
            description=item.get("itemCaption") or None,
            locale="ja",
            image_urls=[u.split("?")[0] for u in images if u][:6],
            category_hint=str(item.get("genreId")) if item.get("genreId") else None,
            currency="JPY",
            list_price=price,
            shipping=Decimal("0"),  # postageFlag 0 = shipping included; otherwise unknown until checkout
            ships_from="JP", ships_to=["JP"],
            delivery_days_min=1, delivery_days_max=5,
            url=url,
            commission_rate=(rate / 100) if rate is not None else DEFAULT_COMMISSION,
            rating=_dec(item.get("reviewAverage")), review_count=int(item.get("reviewCount") or 0),
            attributes={"merchant": item.get("shopName"), "postage_included": item.get("postageFlag") == 0},
        )

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        if country and country.upper() != "JP":
            return []
        return self._search(query, limit)[:limit]

    def _live_products(self, page: int) -> ProductPage:
        queries = self.seed_queries()
        if page < 1 or page > len(queries):
            return ProductPage(items=[], page=page, next_page=None)
        return ProductPage(items=self._search(queries[page - 1], self.page_size), page=page,
                           next_page=page + 1 if page < len(queries) else None)


# ---- Coupang (Korea) ------------------------------------------------------------------------------------

def coupang_authorization(access_key: str, secret_key: str, method: str, path: str, query: str,
                          now: datetime | None = None) -> str:
    """Coupang Partners HMAC: sign ``signed-date + method + path + query`` with the secret key."""
    signed = (now or datetime.now(timezone.utc)).strftime("%y%m%dT%H%M%SZ")
    message = f"{signed}{method}{path}{query}"
    signature = hmac.new(secret_key.encode(), message.encode(), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={access_key}, signed-date={signed}, signature={signature}"


class CoupangConnector(_AffiliateBase):
    code = "coupang"
    name = "Coupang"
    env_keys = ("COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY")
    docs_url = "https://partners.coupang.com/ (Partners API, HMAC signature guide at developers.coupang.com)"
    seed_env = "COUPANG_SEED_QUERIES"
    page_size = 10  # products/search limit maximum
    rate_limit_per_sec = 0.1  # TODO(confirm) Partners search allows only a few calls per minute
    HOST = "https://api-gateway.coupang.com"
    PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search"

    def _search(self, keyword: str, limit: int) -> list[SourceProduct]:
        query = urlencode({"keyword": keyword, "limit": min(limit, 10)})
        auth = coupang_authorization(self.key("COUPANG_ACCESS_KEY"), self.key("COUPANG_SECRET_KEY"), "GET", self.PATH, query)
        body = self._check(self.http.get(f"{self.HOST}{self.PATH}?{query}",
                                         headers={"Authorization": auth, "Content-Type": "application/json"})).json()
        if str(body.get("rCode", "0")) != "0":
            raise ConnectorError(f"[coupang] {body.get('rCode')}: {body.get('rMessage')}")
        data = body.get("data") or {}
        rows = data.get("productData") if isinstance(data, dict) else data
        return [p for p in (self._parse(r) for r in rows or []) if p]

    def _parse(self, raw: dict) -> SourceProduct | None:
        price, url = _dec(raw.get("productPrice")), raw.get("productUrl")
        if price is None or not url or not raw.get("productId"):
            return None
        rocket = bool(raw.get("isRocket"))
        return SourceProduct(
            external_id=str(raw["productId"]),
            title=raw.get("productName") or "",
            locale="ko",
            image_urls=[u for u in [raw.get("productImage")] if u],
            category_hint=raw.get("categoryName") or None,
            currency="KRW",
            list_price=price,
            shipping=Decimal("0") if raw.get("isFreeShipping") or rocket else Decimal("3000"),
            ships_from="KR", ships_to=["KR"],
            delivery_days_min=1, delivery_days_max=1 if rocket else 3,  # Rocket delivery is next day
            url=url, commission_rate=Decimal("0.03"),
            attributes={"merchant": "Coupang", "rocket": rocket},
        )

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        if country and country.upper() != "KR":
            return []
        return self._search(query, limit)

    def _live_products(self, page: int) -> ProductPage:
        queries = self.seed_queries()
        if page < 1 or page > len(queries):
            return ProductPage(items=[], page=page, next_page=None)
        return ProductPage(items=self._search(queries[page - 1], self.page_size), page=page,
                           next_page=page + 1 if page < len(queries) else None)


# ---- Shopee (Southeast Asia, Brazil, Taiwan) ------------------------------------------------------------

SHOPEE_HOSTS = {
    "MY": "https://open-api.affiliate.shopee.com.my/graphql", "SG": "https://open-api.affiliate.shopee.sg/graphql",
    "TH": "https://open-api.affiliate.shopee.co.th/graphql", "VN": "https://open-api.affiliate.shopee.vn/graphql",
    "ID": "https://open-api.affiliate.shopee.co.id/graphql", "PH": "https://open-api.affiliate.shopee.ph/graphql",
    "BR": "https://open-api.affiliate.shopee.com.br/graphql", "TW": "https://open-api.affiliate.shopee.tw/graphql",
}
SHOPEE_CURRENCY = {"MY": "MYR", "SG": "SGD", "TH": "THB", "VN": "VND", "ID": "IDR", "PH": "PHP", "BR": "BRL", "TW": "TWD"}

SHOPEE_QUERY = ("query($keyword:String,$limit:Int,$page:Int){productOfferV2(keyword:$keyword,limit:$limit,page:$page)"
                "{nodes{itemId productName priceMin priceMax imageUrl offerLink productLink commissionRate "
                "shopName ratingStar sales}pageInfo{page limit hasNextPage}}}")


def shopee_authorization(app_id: str, secret: str, payload: str, timestamp: int) -> str:
    signature = hashlib.sha256(f"{app_id}{timestamp}{payload}{secret}".encode()).hexdigest()
    return f"SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}"


class ShopeeConnector(_AffiliateBase):
    code = "shopee"
    name = "Shopee"
    env_keys = ("SHOPEE_APP_ID", "SHOPEE_SECRET")
    docs_url = "https://affiliate.shopee.com.my/open_api (inside the Shopee affiliate dashboard)"
    seed_env = "SHOPEE_SEED_QUERIES"
    page_size = 50
    rate_limit_per_sec = 0.5  # TODO(confirm) per-app limit

    def countries(self) -> list[str]:
        """Shopee affiliate accounts are per country; list the ones this app is approved for."""
        return [c.upper() for c in _csv_list(self.key("SHOPEE_COUNTRIES")) if c.upper() in SHOPEE_HOSTS] or ["MY"]

    def _search(self, country: str, keyword: str, limit: int, page: int = 1) -> list[SourceProduct]:
        payload = json.dumps({"query": SHOPEE_QUERY, "variables": {"keyword": keyword, "limit": min(limit, 50), "page": page}},
                             separators=(",", ":"))
        ts = int(time.time())
        resp = self._check(self.http.post(SHOPEE_HOSTS[country], content=payload.encode(), headers={
            "Authorization": shopee_authorization(self.key("SHOPEE_APP_ID"), self.key("SHOPEE_SECRET"), payload, ts),
            "Content-Type": "application/json"}))
        body = resp.json()
        if body.get("errors"):
            raise ConnectorError(f"[shopee] {body['errors'][0].get('message')}")
        nodes = ((body.get("data") or {}).get("productOfferV2") or {}).get("nodes") or []
        return [p for p in (self._parse(n, country) for n in nodes) if p]

    def _parse(self, raw: dict, country: str) -> SourceProduct | None:
        price, url = _dec(raw.get("priceMin") or raw.get("price")), raw.get("offerLink") or raw.get("productLink")
        if price is None or not url or not raw.get("itemId"):
            return None
        return SourceProduct(
            external_id=f"{country}:{raw['itemId']}",
            title=raw.get("productName") or "",
            image_urls=[u for u in [raw.get("imageUrl")] if u],
            currency=SHOPEE_CURRENCY[country],
            list_price=price,
            ships_from=country, ships_to=[country],
            delivery_days_min=2, delivery_days_max=7,
            url=url, commission_rate=_dec(raw.get("commissionRate")) or DEFAULT_COMMISSION,
            rating=_dec(raw.get("ratingStar")), review_count=int(raw.get("sales") or 0),
            attributes={"merchant": raw.get("shopName")},
        )

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        cc = (country or "").upper()
        if cc not in self.countries():
            return []
        return self._search(cc, query, limit)

    def _live_products(self, page: int) -> ProductPage:
        combos = [(c, q) for c in self.countries() for q in self.seed_queries()]
        if page < 1 or page > len(combos):
            return ProductPage(items=[], page=page, next_page=None)
        c, q = combos[page - 1]
        return ProductPage(items=self._search(c, q, self.page_size), page=page,
                           next_page=page + 1 if page < len(combos) else None)


# ---- Lazada (Southeast Asia) -----------------------------------------------------------------------------

LAZADA_CURRENCY = {"MY": "MYR", "SG": "SGD", "TH": "THB", "VN": "VND", "ID": "IDR", "PH": "PHP"}


class LazadaConnector(_AffiliateBase):
    code = "lazada"
    name = "Lazada"
    env_keys = ("LAZADA_FEED_URLS",)
    docs_url = "https://adsense.lazada.com/ (affiliate dashboard > datafeeds)"
    supports_live_search = False
    supports_single_lookup = False
    rate_limit_per_sec = 0.5

    def feeds(self) -> list[tuple[str, str]]:
        """LAZADA_FEED_URLS = "MY=https://...,PH=https://..." (country=feed link, from the dashboard)."""
        out = []
        for part in _csv_list(self.key("LAZADA_FEED_URLS")):
            cc, _, url = part.partition("=")
            if url and cc.strip().upper() in LAZADA_CURRENCY:
                out.append((cc.strip().upper(), url.strip()))
        return out

    def _parse(self, row: dict[str, str], country: str) -> SourceProduct | None:
        # TODO(confirm) column names of the Lazada affiliate datafeed.
        price = _dec(_first(row, "sale_price", "discounted_price", "price", "Price"))
        url = _first(row, "promotion_link", "tracking_link", "deeplink", "product_url", "url")
        pid = _first(row, "sku_id", "product_id", "item_id", "id")
        if price is None or not url or not pid:
            return None
        return SourceProduct(
            external_id=f"{country}:{pid}",
            title=_first(row, "product_name", "title", "name"),
            brand=_first(row, "brand", "brand_name") or None,
            image_urls=[u for u in [_first(row, "image_url", "picture_url", "image")] if u],
            category_hint=_first(row, "category", "level_1_category", "category_name") or None,
            currency=LAZADA_CURRENCY[country],
            list_price=price,
            ships_from=country, ships_to=[country],
            delivery_days_min=2, delivery_days_max=7,
            url=url, commission_rate=_dec(_first(row, "commission_rate")) or DEFAULT_COMMISSION,
            attributes={"merchant": _first(row, "seller_name", "shop_name") or "Lazada"},
        )

    def _live_products(self, page: int) -> ProductPage:
        feeds = self.feeds()
        if page < 1 or page > len(feeds):
            return ProductPage(items=[], page=page, next_page=None)
        country, url = feeds[page - 1]
        rows = _read_csv(self._check(self.http.get(url)).content)
        return ProductPage(items=[p for p in (self._parse(r, country) for r in rows) if p], page=page,
                           next_page=page + 1 if page < len(feeds) else None)

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        raise NotSupportedError("lazada publishes affiliate datafeeds; it has no live search")

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        raise NotSupportedError("lazada has no single-item lookup; offers refresh with the feed import")


# ---- Mercado Libre (Latin America) -----------------------------------------------------------------------

class MercadoLibreConnector(_AffiliateBase):
    code = "mercadolibre"
    name = "Mercado Libre"
    env_keys = ("MERCADOLIBRE_AFFILIATE_ID",)
    docs_url = "https://developers.mercadolibre.com.ar/ (affiliate program: afiliados.mercadolibre.com)"

    def _live_products(self, page: int) -> ProductPage:
        raise NotConfirmedError(self.code, "affiliate product API or feed", self.docs_url)


REGIONAL_CONNECTORS: tuple[type[Connector], ...] = (
    MercadoLibreConnector, ShopeeConnector, LazadaConnector, RakutenIchibaConnector, CoupangConnector,
)
