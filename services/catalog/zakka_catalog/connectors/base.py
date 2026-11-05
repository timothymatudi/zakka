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
from abc import ABC, abstractmethod
from decimal import Decimal
from pathlib import Path
from typing import Any, ClassVar, Mapping

import httpx

from ..models import (
    ProductPage,
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

    def fetch_offer(self, external_id: str) -> SourceProduct | None:
        """Fresh price/stock for one item (used before forwarding an order)."""
        if self.mock:
            return next((p for p in self._mock_all() if p.external_id == external_id), None)
        return self._live_offer(external_id)

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
