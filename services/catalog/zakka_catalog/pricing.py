"""Reference pricing implementation (docs/CONTRACT.md, "Pricing rule").

Search and web call the catalog's HTTP API instead of re-implementing this.

Dropship offer::

    price_usd = (cost_usd + shipping_usd) * (1 + percent/100) + fixed_usd
    price     = round_up(price_usd * fx_rate, round_to)          # local currency

Affiliate offer::

    price     = (list_price_usd + shipping_usd) * fx_rate         # no markup

Rule selection: only active rules; the first scope tier that has a matching rule
wins, in the order product > source > category > global. Within that tier the
highest ``priority`` wins (ties broken by rule id for determinism). For the
category tier the product's own category is checked first, then its ancestors
(nearest first), so a rule on "electronics" also covers "headphones" unless a
closer category has its own rule.

Rounding (``round_to`` in *local currency units*), always rounding **up**:

* ``round_to <= 0``          -> up to the currency's minor unit (no charm pricing)
* integer ``round_to`` (1, 5, 10, 100) -> up to the next multiple ("1" = whole units)
* fractional ``round_to`` (0.99, 0.95, 0.5, 9.99) -> charm endings: the smallest
  value ``>= amount`` of the form ``k*P + (round_to - P)`` with ``P = ceil(round_to)``.
  0.99 -> x.99; 0.5 -> x.50; 9.99 -> 9.99, 19.99, 29.99 ...

Currencies with few decimals: the charm offset (``round_to - P``, e.g. -0.01) is
truncated toward zero at the currency's precision. With 0-decimal currencies
(JPY, KRW, and KES/IDR if the DB marks them 0) a 0.99 rule therefore becomes
"whole units" and 9.99 becomes "multiples of 10" - never a fractional yen.
With 3-decimal currencies (KWD, BHD, OMR) 0.99 gives x.990.

All arithmetic uses ``Decimal``; floats are rejected at the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Iterable, Literal, Sequence
from uuid import UUID

Scope = Literal["global", "category", "source", "product"]
SCOPE_PRECEDENCE: tuple[Scope, ...] = ("product", "source", "category", "global")

CENT = Decimal("0.01")


class PricingError(ValueError):
    pass


def D(value: Decimal | int | str | None) -> Decimal | None:
    """Coerce to Decimal without going through binary floats."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # repr() gives the shortest round-tripping string, e.g. 0.1 -> "0.1"
        return Decimal(repr(value))
    return Decimal(str(value))


@dataclass(frozen=True)
class MarkupRule:
    id: UUID | str
    scope: Scope
    scope_id: UUID | str | None
    percent: Decimal = Decimal("0")
    fixed_usd: Decimal = Decimal("0")
    round_to: Decimal = Decimal("0.99")
    priority: int = 0
    is_active: bool = True

    def __post_init__(self) -> None:
        if self.scope not in SCOPE_PRECEDENCE:
            raise PricingError(f"unknown markup scope {self.scope!r}")
        if (self.scope == "global") != (self.scope_id is None):
            raise PricingError("global rules have no scope_id; other scopes require one")
        for f in ("percent", "fixed_usd", "round_to"):
            object.__setattr__(self, f, D(getattr(self, f)))


#: Used when no active rule matches at all (should not happen once Agent 1 seeds
#: a global rule). No markup, but still x.99 rounding so prices look normal.
FALLBACK_RULE = MarkupRule(id="fallback", scope="global", scope_id=None,
                           percent=Decimal("0"), fixed_usd=Decimal("0"), round_to=Decimal("0.99"))


def _best(rules: Iterable[MarkupRule]) -> MarkupRule | None:
    rules = list(rules)
    if not rules:
        return None
    return sorted(rules, key=lambda r: (-r.priority, str(r.id)))[0]


def select_markup_rule(
    rules: Iterable[MarkupRule],
    *,
    product_id: UUID | str | None,
    source_id: UUID | str | None,
    category_lineage: Sequence[UUID | str] = (),
) -> MarkupRule | None:
    """Pick the rule for an offer. ``category_lineage`` = own category, then ancestors."""
    active = [r for r in rules if r.is_active]

    def ids_equal(a: object, b: object) -> bool:
        return a is not None and b is not None and str(a) == str(b)

    for scope in SCOPE_PRECEDENCE:
        tier = [r for r in active if r.scope == scope]
        if not tier:
            continue
        if scope == "product":
            hit = _best(r for r in tier if ids_equal(r.scope_id, product_id))
        elif scope == "source":
            hit = _best(r for r in tier if ids_equal(r.scope_id, source_id))
        elif scope == "category":
            hit = None
            for cat in category_lineage:
                hit = _best(r for r in tier if ids_equal(r.scope_id, cat))
                if hit:
                    break
        else:
            hit = _best(tier)
        if hit:
            return hit
    return None


def markup_price_usd(cost_usd: Decimal, shipping_usd: Decimal, rule: MarkupRule) -> Decimal:
    """The contract formula, unrounded."""
    cost_usd, shipping_usd = D(cost_usd), D(shipping_usd or 0)
    if cost_usd is None:
        raise PricingError("dropship offer has no cost_usd")
    if cost_usd < 0 or shipping_usd < 0:
        raise PricingError("negative cost or shipping")
    return (cost_usd + shipping_usd) * (1 + rule.percent / 100) + rule.fixed_usd


def minor_unit(decimals: int) -> Decimal:
    if decimals < 0:
        raise PricingError("decimals must be >= 0")
    return Decimal(1).scaleb(-decimals)


def ceil_to(amount: Decimal, step: Decimal) -> Decimal:
    """Smallest multiple of ``step`` that is >= amount."""
    return (amount / step).to_integral_value(rounding=ROUND_CEILING) * step


def round_up(amount: Decimal, round_to: Decimal, decimals: int = 2) -> Decimal:
    """Round ``amount`` UP per ``round_to`` (see module docstring), at ``decimals`` precision."""
    amount, round_to = D(amount), D(round_to)
    if amount < 0:
        raise PricingError("cannot price a negative amount")
    q = minor_unit(decimals)
    if round_to is None or round_to <= 0:
        return ceil_to(amount, q).quantize(q)

    period = round_to.to_integral_value(rounding=ROUND_CEILING)  # P = ceil(r) >= 1
    # Offset is <= 0; truncate toward zero at currency precision (0.99 in JPY -> 0).
    offset = (round_to - period).quantize(q, rounding=ROUND_DOWN)
    if offset <= -period:  # defensive; cannot happen since r > 0
        offset = Decimal(0)
    k = ((amount - offset) / period).to_integral_value(rounding=ROUND_CEILING)
    result = k * period + offset
    if result <= 0:  # e.g. amount 0 with a charm rule -> first positive step
        result = period + offset
    return result.quantize(q)


def round_half_up(amount: Decimal, decimals: int) -> Decimal:
    return D(amount).quantize(minor_unit(decimals), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Offer-level API


@dataclass(frozen=True)
class OfferPricingInput:
    kind: Literal["dropship", "affiliate"]
    cost_usd: Decimal | None
    list_price_usd: Decimal | None
    shipping_usd: Decimal
    product_id: UUID | str | None = None
    source_id: UUID | str | None = None


@dataclass(frozen=True)
class PriceQuote:
    price: Decimal            # what the customer sees, local currency, rounded
    currency: str
    price_usd: Decimal        # price converted back to USD (== price when currency is USD)
    base_price_usd: Decimal   # unrounded formula output (dropship) / list+shipping (affiliate)
    fx_rate: Decimal
    rule_id: str | None       # None for affiliate offers

    def as_dict(self) -> dict:
        return {
            "price": self.price, "currency": self.currency, "price_usd": self.price_usd,
            "base_price_usd": self.base_price_usd, "fx_rate": self.fx_rate, "rule_id": self.rule_id,
        }


def quote(
    offer: OfferPricingInput,
    *,
    currency: str = "USD",
    fx_rate: Decimal | None = Decimal(1),
    decimals: int = 2,
    rules: Iterable[MarkupRule] = (),
    category_lineage: Sequence[UUID | str] = (),
) -> PriceQuote:
    """Price an offer for a currency. ``fx_rate`` is USD -> ``currency`` (fx_rates.rate)."""
    currency = currency.upper()
    rate = D(Decimal(1) if currency == "USD" else fx_rate)
    if rate is None or rate <= 0:
        raise PricingError(f"no usable fx rate for USD->{currency}")
    shipping = D(offer.shipping_usd or 0)
    q = minor_unit(decimals)

    if offer.kind == "affiliate":
        if offer.list_price_usd is None:
            raise PricingError("affiliate offer has no list_price_usd")
        base = D(offer.list_price_usd) + shipping
        if base < 0:
            raise PricingError("negative affiliate price")
        price = round_half_up(base * rate, decimals)
        rule_id = None
    elif offer.kind == "dropship":
        rule = select_markup_rule(rules, product_id=offer.product_id, source_id=offer.source_id,
                                  category_lineage=category_lineage) or FALLBACK_RULE
        base = markup_price_usd(offer.cost_usd, shipping, rule)
        price = round_up(base * rate, rule.round_to, decimals)
        rule_id = str(rule.id)
    else:
        raise PricingError(f"unknown offer kind {offer.kind!r}")

    price_usd = price if currency == "USD" else round_half_up(price / rate, 2)
    return PriceQuote(price=price.quantize(q), currency=currency, price_usd=price_usd,
                      base_price_usd=base, fx_rate=rate, rule_id=rule_id)


def display_price_usd(
    offer: OfferPricingInput,
    *,
    rules: Iterable[MarkupRule] = (),
    category_lineage: Sequence[UUID | str] = (),
) -> Decimal:
    """The USD price written to the search index (``display_price_usd``)."""
    return quote(offer, currency="USD", fx_rate=Decimal(1), decimals=2, rules=rules,
                 category_lineage=category_lineage).price
