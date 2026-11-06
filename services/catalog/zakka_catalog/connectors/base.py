"""Common connector interface + mock-mode plumbing.

Every connector:

* declares the env keys it needs (names from ``.env.example`` only);
* runs in MOCK mode when any of those keys is empty, serving
  ``zakka_catalog/fixtures/<code>.json`` - no network at all;
* in LIVE mode talks only to the partner's *official* API / feed. Where an
  endpoint or auth detail is not confirmed against the official docs, the code
  is marked ``TODO(confirm)`` with a link, or raises :class:`NotConfirmedError`
  instead of guessing.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime
from abc import ABC, abstractmethod
from decimal import Decimal
from pathlib import Path
from typing import Any, ClassVar, Mapping

import httpx

from ..models import (
    ProductPage,
    UpdatePage,
    SourceKind,
    SourceProduct,
    SupplierOrderRequest,
    SupplierOrderResult,
    TrackingInfo,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


class ConnectorError(RuntimeError):
    pass


class NotSupportedError(ConnectorError):
    """Operation does not exist for this kind of source (e.g. place_order on an affiliate)."""


class NotConfirmedError(ConnectorError):
    """Live API details have not been confirmed against the official docs yet."""

    def __init__(self, code: str, what: str, docs_url: str):
        super().__init__(
            f"[{code}] live {what} is not implemented: confirm the official API at {docs_url} "
            f"and fill in the adapter (mock mode works without keys)."
        )
        self.docs_url = docs_url


def load_fixture(code: str) -> dict[str, Any]:
    path = FIXTURES_DIR / f"{code}.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh, parse_float=Decimal)


class Connector(ABC):
    code: ClassVar[str]
    name: ClassVar[str]
    kind: ClassVar[SourceKind]
    env_keys: ClassVar[tuple[str, ...]]
    docs_url: ClassVar[str]
    page_size: int = 50
    #: Max live requests per second (scheduler throttles to this). TODO(confirm) per partner docs.
    rate_limit_per_sec: ClassVar[float] = 1.0
    #: Daily API call budget, None = unknown/unlimited. TODO(confirm) per partner agreement.
    daily_quota: ClassVar[int | None] = None
    #: True when the source offers an "updated since"/delta listing (incremental sync).
    supports_delta: ClassVar[bool] = False
    #: Items per bulk offer lookup (fetch_offers).
    bulk_size: ClassVar[int] = 50

    def __init__(
        self,
        env: Mapping[str, str] | None = None,
        *,
        http: httpx.Client | None = None,
        force_mock: bool | None = None,
        page_size: int | None = None,
    ):
        self.env = dict(os.environ if env is None else env)
        self._http = http
        self._force_mock = force_mock
        if page_size:
            self.page_size = page_size
        self._fixture: dict[str, Any] | None = None

    # -- mode ---------------------------------------------------------------
    def key(self, name: str) -> str:
        return (self.env.get(name) or "").strip()

    @property
    def missing_keys(self) -> list[str]:
        return [k for k in self.env_keys if not self.key(k)]

    @property
    def mock(self) -> bool:
        if self._force_mock is not None:
            return self._force_mock
        return bool(self.missing_keys)

    @property
    def http(self) -> httpx.Client:
        if self.mock:
            raise ConnectorError(f"[{self.code}] no network in mock mode")
        if self._http is None:
            self._http = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))
        return self._http

    # -- public interface ---------------------------------------------------
    def fetch_products(self, page: int = 1) -> ProductPage:
        if self.mock:
            return self._mock_products(page)
        return self._live_products(page)

    def fetch_updates(self, cursor: str | None, since: datetime | None, limit: int) -> UpdatePage:
        """Cursor-paginated listing. ``since`` asks for items changed after that time
        (delta); connectors without a delta API ignore it and the caller must not pass it.
        Default: page-number cursor over ``fetch_products``."""
        if since is not None and not self.supports_delta:
            raise NotSupportedError(f"{self.code} has no delta listing")
        page_no = int(cursor or 1)
        page = self.fetch_products(page_no)
        return UpdatePage(items=page.items, next_cursor=str(page.next_page) if page.next_page else None)

    def fetch_offers(self, external_ids: list[str]) -> list[SourceProduct]:
        """Fresh price/stock for several items; items that no longer exist are omitted."""
        out = []
        for ext in external_ids:
            p = self.fetch_offer(ext)
            if p is not None:
                out.append(p)
        return out

    def fetch_live(self, query: str, country: str | None, limit: int = 20) -> list[SourceProduct]:
        """Affiliate partners: on-demand search (their APIs are query-based with quotas;
        catalogues are never bulk-downloaded)."""
        if self.kind != "affiliate":
            raise NotSupportedError(f"{self.code} is a supplier; its catalogue is imported, not searched live")
        if self.mock:
            return self._mock_live(query, country, limit)
        return self._live_search(query, country, limit)

    def _live_search(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        raise NotConfirmedError(self.code, "live search", self.docs_url)

    def _mock_live(self, query: str, country: str | None, limit: int) -> list[SourceProduct]:
        terms = [t for t in re.split(r"\W+", query.lower()) if t]
        out = []
        for p in self._mock_all():
            hay = " ".join([p.title, p.description or "", p.category_hint or "", p.brand or ""]).lower()
            if terms and all(t in hay for t in terms) and (not country or country.upper() in p.ships_to):
                out.append(p)
        return out[:limit]

    def fetch_offer(self, external_id: str) -> SourceProduct | None:
        """Fresh price/stock for one item (used before forwarding an order)."""
        if self.mock:
            return next((p for p in self._mock_all() if p.external_id == external_id), None)
        return self._live_offer(external_id)

    def fetch_detail(self, external_id: str) -> SourceProduct | None:
        """Full product detail: every image (main + gallery, in order), full description,
        bullet points, attributes/specs/variants, brand, GTIN, rating and review count.
        Returns None when the source has no richer detail than its listing."""
        if self.mock:
            return self._mock_detail(external_id)
        return self._live_detail(external_id)

    def place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        if self.kind != "dropship":
            raise NotSupportedError(f"{self.code} is an affiliate source; orders happen at the retailer")
        if self.mock:
            return self._mock_place_order(request)
        if request.address is None:
            raise ConnectorError(f"[{self.code}] a shipping address is required to place a live order")
        return self._live_place_order(request)

    def track(self, external_order_id: str) -> TrackingInfo:
        if self.kind != "dropship":
            raise NotSupportedError(f"{self.code} is an affiliate source; no shipment tracking")
        if self.mock:
            return self._mock_track(external_order_id)
        return self._live_track(external_order_id)

    # -- live hooks (override per connector) ---------------------------------
    @abstractmethod
    def _live_products(self, page: int) -> ProductPage: ...

    def _live_offer(self, external_id: str) -> SourceProduct | None:
        raise NotConfirmedError(self.code, "single-offer lookup", self.docs_url)

    def _live_detail(self, external_id: str) -> SourceProduct | None:
        """Default: the single-item lookup, if the connector has one; otherwise no detail."""
        try:
            return self._live_offer(external_id)
        except NotConfirmedError:
            return None

    def _live_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        raise NotConfirmedError(self.code, "order placement", self.docs_url)

    def _live_track(self, external_order_id: str) -> TrackingInfo:
        raise NotConfirmedError(self.code, "tracking", self.docs_url)

    # -- mock implementation ---------------------------------------------------
    @property
    def fixture(self) -> dict[str, Any]:
        if self._fixture is None:
            self._fixture = load_fixture(self.code)
        return self._fixture

    def _mock_all(self) -> list[SourceProduct]:
        default_currency = self.fixture.get("currency", "USD")
        out = []
        for raw in self.fixture["products"]:
            data = {"currency": default_currency, **raw}
            out.append(SourceProduct.model_validate(data))
        return out

    def _mock_detail(self, external_id: str) -> SourceProduct | None:
        default_currency = self.fixture.get("currency", "USD")
        raw = next((r for r in self.fixture["products"] if r["external_id"] == external_id), None)
        if raw is None:
            return None
        detail = raw.get("detail") or {}
        data = {"currency": default_currency, **raw}
        data["image_urls"] = list(raw.get("image_urls", [])) + list(detail.get("gallery", []))
        data["attributes"] = {**raw.get("attributes", {}), **detail.get("attributes", {})}
        for key in ("description", "bullet_points", "brand", "gtin", "rating", "review_count"):
            if detail.get(key):
                data[key] = detail[key]
        return SourceProduct.model_validate(data)

    def _mock_products(self, page: int) -> ProductPage:
        if page < 1:
            raise ValueError("page starts at 1")
        items = self._mock_all()
        start = (page - 1) * self.page_size
        chunk = items[start:start + self.page_size]
        has_more = start + self.page_size < len(items)
        return ProductPage(items=chunk, page=page, next_page=page + 1 if has_more else None)

    def _mock_ref(self, seed: str) -> str:
        return hashlib.sha256(f"{self.code}:{seed}".encode()).hexdigest()[:10].upper()

    def _mock_place_order(self, request: SupplierOrderRequest) -> SupplierOrderResult:
        by_id = {p.external_id: p for p in self._mock_all()}
        cost = Decimal(0)
        for line in request.lines:
            p = by_id.get(line.external_id)
            if p is None:
                raise ConnectorError(f"[{self.code}] unknown product {line.external_id}")
            if p.stock is not None and p.stock < line.qty:
                raise ConnectorError(f"[{self.code}] insufficient stock for {line.external_id}")
            if p.currency != "USD":
                raise ConnectorError(f"[{self.code}] mock fixtures for dropship must be priced in USD")
            cost += ((p.cost or Decimal(0)) + p.shipping) * line.qty
        return SupplierOrderResult(
            external_order_id=f"{self.code.upper()}-MOCK-{self._mock_ref(request.reference)}",
            status="placed", cost_usd=cost, raw={"mock": True},
        )

    def _mock_track(self, external_order_id: str) -> TrackingInfo:
        t = self.fixture.get("tracking", {})
        number = f"{t.get('prefix', 'ZK')}{self._mock_ref(external_order_id)}"
        url_tpl = t.get("url_template")
        return TrackingInfo(
            status=t.get("status", "in_transit"),
            carrier=t.get("carrier", "Mock Post"),
            tracking_number=number,
            tracking_url=url_tpl.format(number=number) if url_tpl else None,
            last_event=t.get("last_event", "Departed origin facility"),
        )

    def describe(self) -> dict[str, Any]:
        return {"code": self.code, "kind": self.kind, "mock": self.mock,
                "missing_keys": self.missing_keys, "docs": self.docs_url}
