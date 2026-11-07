"""Worldwide affiliate sources: eBay and four affiliate networks (Awin, Impact, Rakuten Advertising, Admitad).

Each network gives one connection to thousands of retailers in many countries. The network is the
``source``; the retailer's own name is kept in ``attributes["merchant"]`` (internal only: customers
see "Partner store", per the contract).

Commission rates differ per retailer and are agreed in each network. Feeds rarely include them, so
``DEFAULT_COMMISSION`` is an estimate used for ranking and reports until real rates are loaded.

Checked against the official docs in 2026-11:

* eBay Browse API (developer.ebay.com, OpenAPI spec ``browse_api.json``): application token from the
  client-credentials grant, ``GET /buy/browse/v1/item_summary/search`` (limit max 200, 10,000 results
  max), ``X-EBAY-C-MARKETPLACE-ID``, and ``X-EBAY-C-ENDUSERCTX`` carrying the eBay Partner Network
  campaign (``affiliateCampaignId``) so results include ``itemAffiliateWebUrl``.
* Awin (help.awin.com): one CSV feed list per publisher
  (``ui.awin.com/productdata-darwin-download/publisher/{id}/{feed key}/1/feedList``); each row has the
  feed's own download URL. The feed key is not the Publisher API key.
* Impact (integrations.impact.com): ``api.impact.com/Mediapartners/{AccountSID}/Catalogs`` and
  ``.../Catalogs/ItemSearch`` (Keyword, PageSize, Page); Basic auth with AccountSID and AuthToken.
* Rakuten Advertising: ``GET api.linksynergy.com/productsearch/1.0`` (keyword, max, pagenumber) with a
  Bearer token, XML response. TODO(confirm): XML element names below and the token renewal flow.
* Admitad (account.admitad.com developer docs): ``/advcampaigns/website/{w_id}/`` lists joined
  programs with ``feeds_info`` (csv/xml links). TODO(confirm): token endpoint ``/token/`` and the CSV
  column names of the feeds.
"""

from __future__ import annotations

import base64
import csv
import gzip
import io
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, ClassVar
from urllib.parse import quote

import httpx

from ..models import ProductPage, SourceProduct
from .base import Connector, ConnectorError, NotSupportedError

DEFAULT_COMMISSION = Decimal("0.04")
DEFAULT_SEED_QUERIES = ("smartphone", "headphones", "sneakers", "watch", "kitchen", "toys", "skincare",
                        "laptop", "dress", "tools", "furniture", "sports")


def _dec(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None


def _csv_list(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _days_until(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        when = datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except ValueError:
        return None
    return max(0, (when - datetime.now(timezone.utc).date()).days)


def _read_csv(content: bytes) -> list[dict[str, str]]:
    """CSV bytes (optionally gzipped), delimiter sniffed (Awin uses ',', Admitad often ';')."""
    if content[:2] == b"\x1f\x8b":
        content = gzip.decompress(content)
    text = content.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(io.StringIO(text), dialect=dialect)]


def _first(row: dict[str, str], *names: str) -> str:
    for n in names:
        if row.get(n):
            return row[n]
    return ""


class _AffiliateBase(Connector):
    kind = "affiliate"
    seed_env: ClassVar[str] = ""

    def seed_queries(self) -> list[str]:
        return _csv_list(self.key(self.seed_env)) if self.seed_env and self.key(self.seed_env) else list(DEFAULT_SEED_QUERIES)

    def _check(self, resp: httpx.Response) -> httpx.Response:
        if resp.status_code == 429:
            raise ConnectorError(f"[{self.code}] rate limited (retry after {resp.headers.get('Retry-After', '?')}s)")
        if resp.status_code >= 400:
            raise ConnectorError(f"[{self.code}] HTTP {resp.status_code}: {resp.text[:300]}")
        return resp


# ---- eBay ---------------------------------------------------------------------------------------------

#: Customer country -> eBay site. Countries without their own eBay site search EBAY_US with a
#: deliveryCountry filter, which returns listings that ship internationally to that country.
EBAY_SITES = {
    "US": "EBAY_US", "GB": "EBAY_GB", "DE": "EBAY_DE", "AU": "EBAY_AU", "CA": "EBAY_CA", "FR": "EBAY_FR",
    "IT": "EBAY_IT", "ES": "EBAY_ES", "AT": "EBAY_AT", "BE": "EBAY_BE", "CH": "EBAY_CH", "IE": "EBAY_IE",
    "NL": "EBAY_NL", "PL": "EBAY_PL", "HK": "EBAY_HK", "SG": "EBAY_SG", "MY": "EBAY_MY", "PH": "EBAY_PH",
}
EBAY_SITE_COUNTRY = {v: k for k, v in EBAY_SITES.items()}


class EbayConnector(_AffiliateBase):
    code = "ebay"
    name = "eBay"
    env_keys = ("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_CAMPAIGN_ID")
    docs_url = "https://developer.ebay.com/develop/api/buy/browse_api"
    seed_env = "EBAY_SEED_QUERIES"
    page_size = 200  # Browse API maximum
    rate_limit_per_sec = 2.0  # TODO(confirm) the daily Browse call limit on your eBay developer account
    API = "https://api.ebay.com"

    _token: str | None = None
    _token_exp: float = 0.0

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 120:
            return self._token
        basic = base64.b64encode(f"{self.key('EBAY_CLIENT_ID')}:{self.key('EBAY_CLIENT_SECRET')}".encode()).decode()
        resp = self._check(self.http.post(
            f"{self.API}/identity/v1/oauth2/token",
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"}))
        body = resp.json()
        self._token = body["access_token"]
        self._token_exp = time.time() + int(body.get("expires_in", 7200))
        return self._token

    def marketplaces(self) -> list[str]:
        return _csv_list(self.key("EBAY_MARKETPLACES")) or ["EBAY_US", "EBAY_GB", "EBAY_DE", "EBAY_AU", "EBAY_CA", "EBAY_FR"]

    def _headers(self, site: str, country: str | None) -> dict[str, str]:
        ctx = f"affiliateCampaignId={self.key('EBAY_CAMPAIGN_ID')}"
        if self.key("EBAY_REFERENCE_ID"):
            ctx += f",affiliateReferenceId={self.key('EBAY_REFERENCE_ID')}"
        if country:
            ctx += f",contextualLocation={quote(f'country={country}', safe='')}"
        return {"Authorization": f"Bearer {self._access_token()}", "X-EBAY-C-MARKETPLACE-ID": site,
                "X-EBAY-C-ENDUSERCTX": ctx}

    def _parse(self, raw: dict, site: str, country: str | None) -> SourceProduct | None:
        price = raw.get("price") or {}
        value = _dec(price.get("value"))
        url = raw.get("itemAffiliateWebUrl") or raw.get("itemWebUrl")
        if value is None or not url:
            return None
        ship = (raw.get("shippingOptions") or [{}])[0]
        images = [(raw.get("image") or {}).get("imageUrl")] + [i.get("imageUrl") for i in raw.get("additionalImages") or []]
        dmin, dmax = _days_until(ship.get("minEstimatedDeliveryDate")), _days_until(ship.get("maxEstimatedDeliveryDate"))
        dest = (country or EBAY_SITE_COUNTRY.get(site, "US")).upper()
        cats = raw.get("categories") or []
        return SourceProduct(
            external_id=str(raw["itemId"]),
            title=raw.get("title") or "",
            description=raw.get("shortDescription") or raw.get("description"),
            brand=raw.get("brand"),
            gtin=raw.get("gtin"),
            image_urls=[u for u in images if u],
            category_hint=" > ".join(c.get("categoryName", "") for c in cats if c.get("categoryName")) or None,
            currency=price.get("currency") or "USD",
            list_price=value,
            shipping=_dec((ship.get("shippingCost") or {}).get("value")) or Decimal("0"),
            ships_from=((raw.get("itemLocation") or {}).get("country") or dest)[:2].upper(),
            ships_to=[dest],
            delivery_days_min=dmin if dmin is not None else 3,
            delivery_days_max=dmax if dmax is not None else max(dmin or 0, 14),
            url=url,
            commission_rate=DEFAULT_COMMISSION,
            attributes={"marketplace": site, "condition": raw.get("condition"), "epid": raw.get("epid"),
                        "affiliate_link": bool(raw.get("itemAffiliateWebUrl"))},
        )

    def _search(self, site: str, q: str, country: str | None, limit: int, offset: int = 0) -> tuple[list[SourceProduct], int]:
        filters = ["buyingOptions:{FIXED_PRICE}", "conditions:{NEW}"]
        if country:
            filters.append(f"deliveryCountry:{country.upper()}")
        resp = self._check(self.http.get(
            f"{self.API}/buy/browse/v1/item_summary/search",
            params={"q": q, "limit": min(limit, 200), "offset": offset, "filter": ",".join(filters)},
            headers=self._headers(site, country)))
        body = resp.json()
        items = [p for p in (self._parse(r, site, country) for r in body.get("itemSummaries") or []) if p]
        return items, int(body.get("total") or 0)

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        cc = (country or "US").upper()
        site = EBAY_SITES.get(cc, "EBAY_US")
        return self._search(site, query, cc, limit)[0][:limit]

    def _live_products(self, page: int) -> ProductPage:
        """Catalogue import: one page per (site, seed query). eBay is search-based; it has no full export."""
        combos = [(s, q) for s in self.marketplaces() for q in self.seed_queries()]
        if page < 1 or page > len(combos):
            return ProductPage(items=[], page=page, next_page=None)
        site, q = combos[page - 1]
        items, _ = self._search(site, q, EBAY_SITE_COUNTRY.get(site), self.page_size)
        return ProductPage(items=items, page=page, next_page=page + 1 if page < len(combos) else None)

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        site = self.marketplaces()[0]
        resp = self.http.get(f"{self.API}/buy/browse/v1/item/{quote(external_id, safe='|')}",
                             headers=self._headers(site, EBAY_SITE_COUNTRY.get(site)))
        if resp.status_code == 404:
            return None
        return self._parse(self._check(resp).json(), site, EBAY_SITE_COUNTRY.get(site))


# ---- Awin -----------------------------------------------------------------------------------------------

class AwinConnector(_AffiliateBase):
    code = "awin"
    name = "Awin"
    env_keys = ("AWIN_PUBLISHER_ID", "AWIN_FEED_KEY")
    docs_url = "https://help.awin.com/developers/docs/downloading-a-list-of-your-product-feeds"
    supports_live_search = False
    supports_single_lookup = False
    rate_limit_per_sec = 0.5

    _feeds: list[dict[str, str]] | None = None

    def feeds(self) -> list[dict[str, str]]:
        """Feeds of advertisers we have joined (one CSV row each, with its own download URL)."""
        if self._feeds is None:
            url = (f"https://ui.awin.com/productdata-darwin-download/publisher/{self.key('AWIN_PUBLISHER_ID')}/"
                   f"{self.key('AWIN_FEED_KEY')}/1/feedList")
            rows = _read_csv(self._check(self.http.get(url)).content)
            self._feeds = [r for r in rows if r.get("URL") and r.get("Membership Status", "").lower() in ("active", "joined")]
        return self._feeds

    def _parse(self, row: dict[str, str], feed: dict[str, str]) -> SourceProduct | None:
        price, url = _dec(_first(row, "search_price", "store_price", "price")), _first(row, "aw_deep_link", "deep_link")
        pid = _first(row, "aw_product_id", "merchant_product_id", "id")
        if price is None or not url or not pid:
            return None
        region = (feed.get("Primary Region") or "GB").strip().upper()[:2]
        stock = _first(row, "in_stock", "stock_status").lower()
        return SourceProduct(
            external_id=f"{feed.get('Feed ID', '')}:{pid}",
            title=_first(row, "product_name", "title"),
            description=_first(row, "description", "product_short_description") or None,
            brand=_first(row, "brand_name", "brand") or None,
            gtin=_first(row, "ean", "upc", "product_GTIN") or None,
            image_urls=[u for u in (_first(row, "merchant_image_url", "aw_image_url", "large_image"),
                                    _first(row, "alternate_image")) if u],
            category_hint=_first(row, "merchant_category", "category_name") or None,
            currency=_first(row, "currency") or "GBP",
            list_price=price,
            shipping=_dec(_first(row, "delivery_cost")) or Decimal("0"),
            stock=0 if stock in ("0", "no", "false", "out of stock") else None,
            ships_from=region, ships_to=[region],
            delivery_days_min=2, delivery_days_max=7,  # feeds rarely state delivery times
            url=url, commission_rate=DEFAULT_COMMISSION,
            attributes={"merchant": feed.get("Advertiser Name") or _first(row, "merchant_name"),
                        "advertiser_id": feed.get("Advertiser ID"), "feed_id": feed.get("Feed ID")},
        )

    def _live_products(self, page: int) -> ProductPage:
        """One page per joined advertiser feed."""
        feeds = self.feeds()
        if page < 1 or page > len(feeds):
            return ProductPage(items=[], page=page, next_page=None)
        feed = feeds[page - 1]
        rows = _read_csv(self._check(self.http.get(feed["URL"])).content)
        items = [p for p in (self._parse(r, feed) for r in rows) if p]
        return ProductPage(items=items, page=page, next_page=page + 1 if page < len(feeds) else None)

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        raise NotSupportedError("awin publishes product feeds; it has no live search")

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        raise NotSupportedError("awin has no single-item lookup; offers refresh with the feed import")


# ---- Impact ----------------------------------------------------------------------------------------------

class ImpactConnector(_AffiliateBase):
    code = "impact"
    name = "Impact"
    env_keys = ("IMPACT_ACCOUNT_SID", "IMPACT_AUTH_TOKEN")
    docs_url = "https://integrations.impact.com/impact-publisher/reference/list-catalogs"
    page_size = 100
    rate_limit_per_sec = 1.0  # TODO(confirm) per-account limits in the Impact dashboard
    API = "https://api.impact.com"

    _catalogs: list[dict] | None = None

    def _get(self, path_or_url: str, **params) -> dict:
        url = path_or_url if path_or_url.startswith("http") else f"{self.API}{path_or_url}"
        resp = self.http.get(url, params=params or None, auth=(self.key("IMPACT_ACCOUNT_SID"), self.key("IMPACT_AUTH_TOKEN")),
                             headers={"Accept": "application/json"})
        return self._check(resp).json()

    def _base(self) -> str:
        return f"/Mediapartners/{self.key('IMPACT_ACCOUNT_SID')}"

    def countries(self) -> list[str]:
        return [c.upper() for c in _csv_list(self.key("IMPACT_COUNTRIES"))] or ["US"]

    def _parse(self, raw: dict, catalog: dict | None = None) -> SourceProduct | None:
        price = _dec(raw.get("CurrentPrice"))
        if price is None or not raw.get("Url"):
            return None
        stock = str(raw.get("StockAvailability") or "").lower()
        ships = self.countries()
        return SourceProduct(
            external_id=str(raw.get("CatalogItemId") or raw.get("Id")),
            title=raw.get("Name") or "",
            description=raw.get("Description") or None,
            brand=raw.get("Manufacturer") or None,
            gtin=raw.get("Gtin") or None,
            image_urls=[u for u in [raw.get("ImageUrl")] if u],
            category_hint=raw.get("Category") or None,
            currency=raw.get("Currency") or (catalog or {}).get("Currency") or "USD",
            list_price=price,
            shipping=_dec(raw.get("ShippingRate")) or Decimal("0"),
            stock=0 if "out" in stock else None,
            ships_from=ships[0], ships_to=ships,
            delivery_days_min=2, delivery_days_max=7,
            url=raw["Url"], commission_rate=DEFAULT_COMMISSION,
            attributes={"merchant": raw.get("CampaignName") or (catalog or {}).get("AdvertiserName"),
                        "catalog_id": (catalog or {}).get("Id") or raw.get("CatalogId")},
        )

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        body = self._get(f"{self._base()}/Catalogs/ItemSearch", Keyword=query, PageSize=min(limit, 100), Page=1)
        items = [p for p in (self._parse(r) for r in body.get("Items") or []) if p]
        return [p for p in items if not country or country.upper() in p.ships_to][:limit]

    def catalogs(self) -> list[dict]:
        if self._catalogs is None:
            self._catalogs = self._get(f"{self._base()}/Catalogs").get("Catalogs") or []
        return self._catalogs

    def _live_products(self, page: int) -> ProductPage:
        """One page per catalog (all of its item pages, following @nextpageuri)."""
        cats = self.catalogs()
        if page < 1 or page > len(cats):
            return ProductPage(items=[], page=page, next_page=None)
        cat = cats[page - 1]
        url: str | None = cat.get("ItemsUri") or f"{self._base()}/Catalogs/{cat['Id']}/Items"
        items: list[SourceProduct] = []
        for _ in range(200):  # safety cap: 200 pages per catalog per run
            if not url:
                break
            body = self._get(url if url.startswith("http") else f"{self.API}{url}")
            items.extend(p for p in (self._parse(r, cat) for r in body.get("Items") or []) if p)
            url = body.get("@nextpageuri") or None
        return ProductPage(items=items, page=page, next_page=page + 1 if page < len(cats) else None)


# ---- Rakuten Advertising -------------------------------------------------------------------------------

class RakutenAdvertisingConnector(_AffiliateBase):
    code = "rakuten"
    name = "Rakuten Advertising"
    env_keys = ("RAKUTEN_ADV_TOKEN",)
    docs_url = "https://developers.rakutenadvertising.com/documentation/en-US/affiliate_apis"
    seed_env = "RAKUTEN_SEED_QUERIES"
    page_size = 100
    rate_limit_per_sec = 1.0  # 100 calls per minute per the publisher help centre
    API = "https://api.linksynergy.com"

    def countries(self) -> list[str]:
        return [c.upper() for c in _csv_list(self.key("RAKUTEN_COUNTRIES"))] or ["US"]

    def _query(self, keyword: str, max_results: int, page: int = 1) -> list[SourceProduct]:
        params: dict[str, Any] = {"keyword": keyword, "max": min(max_results, 100), "pagenumber": page}
        if self.key("RAKUTEN_ADV_MIDS"):
            params["mid"] = self.key("RAKUTEN_ADV_MIDS")
        resp = self._check(self.http.get(f"{self.API}/productsearch/1.0", params=params,
                                         headers={"Authorization": f"Bearer {self.key('RAKUTEN_ADV_TOKEN')}",
                                                  "Accept": "application/xml"}))
        try:
            root = ET.fromstring(resp.content)
        except ET.ParseError as exc:
            raise ConnectorError(f"[rakuten] bad XML: {exc}") from None
        return [p for p in (self._parse(item) for item in root.iter("item")) if p]

    def _parse(self, item: ET.Element) -> SourceProduct | None:
        # TODO(confirm) element names against the Product Search API reference.
        text = lambda path: (item.findtext(path) or "").strip()  # noqa: E731
        price_el = item.find("saleprice") if item.find("saleprice") is not None and text("saleprice") else item.find("price")
        price = _dec(price_el.text if price_el is not None else None)
        url, ext = text("linkurl"), text("linkid") or text("sku")
        if price is None or not url or not ext:
            return None
        ships = self.countries()
        return SourceProduct(
            external_id=f"{text('mid')}:{ext}",
            title=text("productname"),
            description=text("description/long") or text("description/short") or None,
            gtin=text("upccode") or None,
            image_urls=[u for u in [text("imageurl")] if u],
            category_hint=" > ".join(x for x in (text("category/primary"), text("category/secondary")) if x) or None,
            currency=(price_el.get("currency") if price_el is not None else None) or "USD",
            list_price=price,
            ships_from=ships[0], ships_to=ships,
            delivery_days_min=2, delivery_days_max=7,
            url=url, commission_rate=DEFAULT_COMMISSION,
            attributes={"merchant": text("merchantname"), "mid": text("mid")},
        )

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        items = self._query(query, limit)
        return [p for p in items if not country or country.upper() in p.ships_to][:limit]

    def _live_products(self, page: int) -> ProductPage:
        queries = self.seed_queries()
        if page < 1 or page > len(queries):
            return ProductPage(items=[], page=page, next_page=None)
        return ProductPage(items=self._query(queries[page - 1], self.page_size), page=page,
                           next_page=page + 1 if page < len(queries) else None)


# ---- Admitad ----------------------------------------------------------------------------------------------

class AdmitadConnector(_AffiliateBase):
    code = "admitad"
    name = "Admitad"
    env_keys = ("ADMITAD_CLIENT_ID", "ADMITAD_CLIENT_SECRET", "ADMITAD_WEBSITE_ID")
    docs_url = "https://account.admitad.com/en/developers/doc/api_en/methods/advcampaigns/advcampaigns-website-list/"
    supports_live_search = False
    supports_single_lookup = False
    rate_limit_per_sec = 0.5
    API = "https://api.admitad.com"

    _token: str | None = None
    _token_exp: float = 0.0
    _feeds: list[dict] | None = None

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 120:
            return self._token
        # TODO(confirm) against Admitad's token docs: client-credentials grant with Basic auth.
        resp = self._check(self.http.post(
            f"{self.API}/token/", auth=(self.key("ADMITAD_CLIENT_ID"), self.key("ADMITAD_CLIENT_SECRET")),
            data={"grant_type": "client_credentials", "client_id": self.key("ADMITAD_CLIENT_ID"),
                  "scope": "advcampaigns_for_website"}))
        body = resp.json()
        if not body.get("access_token"):
            raise ConnectorError("[admitad] no access_token in token response")
        self._token = body["access_token"]
        self._token_exp = time.time() + int(body.get("expires_in", 3600))
        return self._token

    def feeds(self) -> list[dict]:
        """Product feeds of the programs we have joined on our ad space (website)."""
        if self._feeds is None:
            out: list[dict] = []
            offset = 0
            while True:
                resp = self._check(self.http.get(
                    f"{self.API}/advcampaigns/website/{self.key('ADMITAD_WEBSITE_ID')}/",
                    params={"connection_status": "active", "limit": 100, "offset": offset},
                    headers={"Authorization": f"Bearer {self._access_token()}"}))
                body = resp.json()
                results = body.get("results") or []
                for c in results:
                    if not c.get("show_products_links"):
                        continue
                    regions = [r.get("region") for r in c.get("regions") or [] if isinstance(r, dict) and r.get("region")]
                    links = [f.get("csv_link") for f in c.get("feeds_info") or [] if f.get("csv_link")]
                    if not links and c.get("products_csv_link"):
                        links = [c["products_csv_link"]]
                    for link in links:
                        out.append({"campaign_id": c.get("id"), "merchant": c.get("name"), "url": link,
                                    "regions": [r.upper()[:2] for r in regions if r] or ["US"],
                                    "currency": c.get("currency")})
                offset += len(results)
                if not results or offset >= int((body.get("_meta") or {}).get("count") or 0):
                    break
            self._feeds = out
        return self._feeds

    def _parse(self, row: dict[str, str], feed: dict) -> SourceProduct | None:
        # TODO(confirm) feed column names (they follow the YML offer fields).
        price, url, pid = _dec(_first(row, "price", "Price")), _first(row, "url", "URL"), _first(row, "id", "ID", "offer_id")
        if price is None or not url or not pid:
            return None
        regions = feed["regions"]
        available = _first(row, "available").lower()
        return SourceProduct(
            external_id=f"{feed['campaign_id']}:{pid}",
            title=_first(row, "name", "model", "title"),
            description=_first(row, "description") or None,
            brand=_first(row, "vendor", "brand") or None,
            gtin=_first(row, "barcode", "ean") or None,
            image_urls=[u for u in _first(row, "picture", "image").split(",") if u.strip()][:6],
            category_hint=_first(row, "category", "categoryName", "categoryId") or None,
            currency=_first(row, "currencyId", "currency") or feed.get("currency") or "USD",
            list_price=price,
            stock=0 if available in ("false", "0", "no") else None,
            ships_from=regions[0], ships_to=regions,
            delivery_days_min=2, delivery_days_max=10,
            url=url, commission_rate=DEFAULT_COMMISSION,
            attributes={"merchant": feed.get("merchant"), "campaign_id": feed.get("campaign_id")},
        )

    def _live_products(self, page: int) -> ProductPage:
        feeds = self.feeds()
        if page < 1 or page > len(feeds):
            return ProductPage(items=[], page=page, next_page=None)
        feed = feeds[page - 1]
        rows = _read_csv(self._check(self.http.get(feed["url"])).content)
        items = [p for p in (self._parse(r, feed) for r in rows) if p]
        return ProductPage(items=items, page=page, next_page=page + 1 if page < len(feeds) else None)

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        raise NotSupportedError("admitad publishes product feeds; it has no live search")

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        raise NotSupportedError("admitad has no single-item lookup; offers refresh with the feed import")


NETWORK_CONNECTORS: tuple[type[Connector], ...] = (
    EbayConnector, AwinConnector, ImpactConnector, RakutenAdvertisingConnector, AdmitadConnector,
)

__all__ = [c.__name__ for c in NETWORK_CONNECTORS] + ["NETWORK_CONNECTORS", "EBAY_SITES", "DEFAULT_COMMISSION"]
