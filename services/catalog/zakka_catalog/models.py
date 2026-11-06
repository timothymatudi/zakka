"""Shared pydantic models used by connectors, sync and order forwarding."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field, field_validator

SourceKind = Literal["dropship", "affiliate"]


class SourceProduct(BaseModel):
    """One product + offer as returned by a connector, before USD normalisation.

    Amounts (``cost``, ``list_price``, ``shipping``) are in ``currency``; sync
    converts them to USD with ``fx_rates``. Dropship connectors set ``cost``
    (what Zakka pays the supplier); affiliate connectors set ``list_price``
    (what the shopper pays the retailer) and ``url``.
    """

    external_id: str
    title: str
    description: str | None = None
    bullet_points: list[str] = Field(default_factory=list)
    locale: str = "en"
    brand: str | None = None
    gtin: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    category_hint: str | None = None  # the source's own category path, e.g. "Electronics > Audio"
    rating: Decimal | None = None
    review_count: int = 0
    url: str | None = None
    currency: str = "USD"
    cost: Decimal | None = None
    list_price: Decimal | None = None
    shipping: Decimal = Decimal("0")
    stock: int | None = None
    ships_from: str | None = None
    ships_to: list[str] = Field(default_factory=list)
    delivery_days_min: int | None = None
    delivery_days_max: int | None = None
    commission_rate: Decimal | None = None
    #: Partner/supplier-provided copy in other locales (used instead of AI translation).
    translations: dict[str, "Translation"] = Field(default_factory=dict)

    @field_validator("ships_from")
    @classmethod
    def _cc(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        if len(v) != 2:
            raise ValueError(f"ships_from must be ISO-3166 alpha-2, got {v!r}")
        return v

    @field_validator("ships_to")
    @classmethod
    def _cc_list(cls, v: list[str]) -> list[str]:
        out = sorted({c.strip().upper() for c in v if c and c.strip()})
        bad = [c for c in out if len(c) != 2]
        if bad:
            raise ValueError(f"ships_to must be ISO-3166 alpha-2 codes, got {bad}")
        return out

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str) -> str:
        return v.strip().upper()


class ProductPage(BaseModel):
    items: list[SourceProduct]
    page: int
    next_page: int | None = None


class UpdatePage(BaseModel):
    items: list[SourceProduct]
    next_cursor: str | None = None  # None = listing complete


class Address(BaseModel):
    """Matches orders.shipping_address (migration 0005); ``phone_e164`` is accepted as ``phone``."""

    name: str
    line1: str
    line2: str | None = None
    city: str
    region: str | None = None
    postal_code: str | None = None
    country_code: str
    phone: str | None = Field(default=None, validation_alias=AliasChoices("phone", "phone_e164"))
    email: str | None = None


class SupplierOrderLine(BaseModel):
    external_id: str  # offers.external_id at the supplier
    qty: int = Field(gt=0)
    variant_id: str | None = None


class SupplierOrderRequest(BaseModel):
    reference: str  # our order id; suppliers that support idempotency keys get it too
    address: Address | None = None
    lines: list[SupplierOrderLine]


class SupplierOrderResult(BaseModel):
    external_order_id: str
    status: str = "placed"
    cost_usd: Decimal | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


TrackingStatus = Literal["pending", "in_transit", "delivered", "exception", "cancelled"]


class TrackingInfo(BaseModel):
    status: TrackingStatus
    carrier: str | None = None
    tracking_number: str | None = None
    tracking_url: str | None = None
    last_event: str | None = None


class Translation(BaseModel):
    title: str
    description: str | None = None
    bullet_points: list[str] = Field(default_factory=list)


class CategoryRef(BaseModel):
    id: UUID
    slug: str
    parent_id: UUID | None = None
    name: str | None = None  # English name when known
    names: dict[str, str] = Field(default_factory=dict)  # locale -> name


SourceProduct.model_rebuild()
