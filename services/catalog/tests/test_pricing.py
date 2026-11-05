from decimal import Decimal as D
from uuid import uuid4

import pytest

from zakka_catalog.pricing import (
    FALLBACK_RULE,
    MarkupRule,
    OfferPricingInput,
    PricingError,
    display_price_usd,
    markup_price_usd,
    quote,
    round_up,
    select_markup_rule,
)

PROD, SRC, CAT, PARENT, GRAND = (uuid4() for _ in range(5))


def rule(scope, scope_id=None, percent="0", fixed="0", round_to="0.99", priority=0, active=True, id=None):
    return MarkupRule(id=id or uuid4(), scope=scope, scope_id=scope_id, percent=D(percent), fixed_usd=D(fixed),
                      round_to=D(round_to), priority=priority, is_active=active)


def dropship(cost="10", ship="2"):
    return OfferPricingInput(kind="dropship", cost_usd=D(cost), list_price_usd=None, shipping_usd=D(ship),
                             product_id=PROD, source_id=SRC)


# --- formula ---------------------------------------------------------------

def test_formula_matches_contract():
    r = rule("global", percent="35", fixed="1.00")
    assert markup_price_usd(D("10"), D("2"), r) == D("17.20")  # (10+2)*1.35+1


def test_formula_rejects_missing_or_negative_cost():
    r = rule("global")
    with pytest.raises(PricingError):
        markup_price_usd(None, D(0), r)
    with pytest.raises(PricingError):
        markup_price_usd(D("-1"), D(0), r)


def test_float_inputs_are_coerced_exactly():
    r = MarkupRule(id="x", scope="global", scope_id=None, percent=12.5, fixed_usd=0.1, round_to=0)
    assert r.percent == D("12.5") and r.fixed_usd == D("0.1")


# --- rule precedence ---------------------------------------------------------

def test_product_beats_source_beats_category_beats_global():
    g = rule("global", percent="10")
    c = rule("category", CAT, percent="20")
    s = rule("source", SRC, percent="30")
    p = rule("product", PROD, percent="40")
    kw = dict(product_id=PROD, source_id=SRC, category_lineage=[CAT])
    assert select_markup_rule([g, c, s, p], **kw) is p
    assert select_markup_rule([g, c, s], **kw) is s
    assert select_markup_rule([g, c], **kw) is c
    assert select_markup_rule([g], **kw) is g


def test_scope_precedence_wins_over_priority():
    g = rule("global", percent="10", priority=100)
    s = rule("source", SRC, percent="30", priority=0)
    assert select_markup_rule([g, s], product_id=PROD, source_id=SRC) is s


def test_priority_within_scope_and_deterministic_tie_break():
    a = rule("source", SRC, priority=1, id="b")
    b = rule("source", SRC, priority=5, id="c")
    assert select_markup_rule([a, b], product_id=None, source_id=SRC) is b
    t1, t2 = rule("global", id="aaa"), rule("global", id="bbb")
    assert select_markup_rule([t2, t1], product_id=None, source_id=None) is t1


def test_inactive_and_non_matching_rules_ignored():
    other = rule("product", uuid4(), percent="99")
    off = rule("source", SRC, percent="99", active=False)
    g = rule("global", percent="5")
    assert select_markup_rule([other, off, g], product_id=PROD, source_id=SRC) is g


def test_category_rules_inherit_from_nearest_ancestor():
    lineage = [CAT, PARENT, GRAND]  # own category first
    grand = rule("category", GRAND, percent="10", priority=50)
    parent = rule("category", PARENT, percent="20", priority=0)
    assert select_markup_rule([grand, parent], product_id=None, source_id=None, category_lineage=lineage) is parent
    own = rule("category", CAT, percent="30")
    assert select_markup_rule([grand, parent, own], product_id=None, source_id=None,
                              category_lineage=lineage) is own
    # priority decides between rules on the same (nearest) level
    parent_hi = rule("category", PARENT, percent="25", priority=9)
    assert select_markup_rule([grand, parent, parent_hi], product_id=None, source_id=None,
                              category_lineage=lineage) is parent_hi
    # unrelated category rule doesn't apply
    assert select_markup_rule([rule("category", uuid4())], product_id=None, source_id=None,
                              category_lineage=lineage) is None


def test_ids_compare_as_strings():
    s = rule("source", str(SRC))
    assert select_markup_rule([s], product_id=None, source_id=SRC) is s


def test_rule_scope_validation():
    with pytest.raises(PricingError):
        MarkupRule(id=1, scope="global", scope_id=uuid4())
    with pytest.raises(PricingError):
        MarkupRule(id=1, scope="source", scope_id=None)
    with pytest.raises(PricingError):
        MarkupRule(id=1, scope="brand", scope_id=uuid4())


def test_no_rules_falls_back_to_no_markup():
    q = quote(dropship("10", "2"))
    assert q.rule_id == str(FALLBACK_RULE.id)
    assert q.price == D("12.99")


# --- rounding ----------------------------------------------------------------

@pytest.mark.parametrize("amount,round_to,decimals,expected", [
    ("12.00", "0.99", 2, "12.99"),
    ("12.99", "0.99", 2, "12.99"),   # already on an ending: unchanged
    ("12.991", "0.99", 2, "13.99"),
    ("13.50", "0.99", 2, "13.99"),
    ("0", "0.99", 2, "0.99"),
    ("12.10", "0.95", 2, "12.95"),
    ("12.96", "0.95", 2, "13.95"),
    ("12.20", "0.5", 2, "12.50"),
    ("12.60", "0.5", 2, "13.50"),
    ("12.01", "1", 2, "13.00"),      # whole units
    ("12.00", "1", 2, "12.00"),
    ("101", "5", 2, "105.00"),
    ("101", "10", 2, "110.00"),
    ("12.00", "9.99", 2, "19.99"),   # charm pricing in tens
    ("9.99", "9.99", 2, "9.99"),
    ("12.341", "0", 2, "12.35"),     # 0 => just round up to cents
    ("12.341", "-1", 2, "12.35"),
    # zero-decimal currencies (JPY, and KES/IDR when marked 0 in currencies)
    ("1234.2", "0.99", 0, "1235"),
    ("1234", "0.99", 0, "1234"),
    ("1234.2", "1", 0, "1235"),
    ("1231", "9.99", 0, "1240"),     # 9.99 in a 0-dec currency -> multiples of 10
    ("1231", "100", 0, "1300"),
    # three-decimal currencies (KWD)
    ("4.1234", "0.99", 3, "4.990"),
    ("4.1234", "0", 3, "4.124"),
])
def test_round_up(amount, round_to, decimals, expected):
    out = round_up(D(amount), D(round_to), decimals)
    assert out == D(expected)
    assert str(out) == expected  # quantized to the currency's precision
    assert out >= D(amount)


def test_round_up_rejects_negative():
    with pytest.raises(PricingError):
        round_up(D("-1"), D("0.99"))


# --- quotes ------------------------------------------------------------------

def test_dropship_quote_usd():
    rules = [rule("global", percent="35", fixed="1.00")]
    q = quote(dropship("10", "2"), rules=rules)
    assert q.base_price_usd == D("17.20")
    assert q.price == D("17.99") and q.currency == "USD" and q.price_usd == D("17.99")


def test_dropship_quote_converts_then_rounds_up_in_local_currency():
    rules = [rule("global", percent="35", fixed="1.00")]
    q = quote(dropship("10", "2"), currency="AED", fx_rate=D("3.6725"), rules=rules)
    # 17.20 * 3.6725 = 63.167 -> 63.99 AED
    assert q.price == D("63.99")
    assert q.price_usd == D("17.42")  # 63.99 / 3.6725 rounded to cents
    assert q.fx_rate == D("3.6725")


def test_dropship_quote_jpy_whole_units():
    rules = [rule("global", percent="35", fixed="1.00")]
    q = quote(dropship("10", "2"), currency="JPY", fx_rate=D("150"), decimals=0, rules=rules)
    assert q.price == D("2580") and str(q.price) == "2580"  # 17.20*150 = 2580 exactly


def test_dropship_quote_kes_zero_decimals_rounds_up():
    rules = [rule("global", percent="35", fixed="1.00")]
    q = quote(dropship("10", "2.01"), currency="KES", fx_rate=D("129"), decimals=0, rules=rules)
    # (12.01*1.35+1)=17.2135 *129 = 2220.5415 -> 2221
    assert q.price == D("2221")


def test_usd_ignores_supplied_rate():
    q = quote(dropship(), currency="usd", fx_rate=D("99"), rules=[rule("global", round_to="0")])
    assert q.price == D("12.00") and q.currency == "USD"


def test_missing_or_bad_rate_raises():
    with pytest.raises(PricingError):
        quote(dropship(), currency="EUR", fx_rate=None)
    with pytest.raises(PricingError):
        quote(dropship(), currency="EUR", fx_rate=D(0))


def test_affiliate_no_markup_even_with_rules():
    off = OfferPricingInput(kind="affiliate", cost_usd=None, list_price_usd=D("24.99"), shipping_usd=D("0"),
                            product_id=PROD, source_id=SRC)
    rules = [rule("product", PROD, percent="50", fixed="5"), rule("global", percent="35")]
    q = quote(off, rules=rules)
    assert q.price == D("24.99") and q.rule_id is None
    q = quote(off, currency="INR", fx_rate=D("84"), rules=rules)
    assert q.price == D("2099.16")  # 24.99*84, no charm rounding


def test_affiliate_includes_shipping_and_rounds_half_up_to_currency():
    off = OfferPricingInput(kind="affiliate", cost_usd=None, list_price_usd=D("10.005"), shipping_usd=D("1"))
    assert quote(off).price == D("11.01")
    assert quote(off, currency="JPY", fx_rate=D("150.1"), decimals=0).price == D("1652")  # 1651.75 -> 1652


def test_affiliate_missing_list_price_raises():
    off = OfferPricingInput(kind="affiliate", cost_usd=D("1"), list_price_usd=None, shipping_usd=D("0"))
    with pytest.raises(PricingError):
        quote(off)


def test_unknown_kind_raises():
    with pytest.raises(PricingError):
        quote(OfferPricingInput(kind="other", cost_usd=D(1), list_price_usd=None, shipping_usd=D(0)))


def test_display_price_usd_uses_category_inheritance():
    rules = [rule("global", percent="35", fixed="1"), rule("category", PARENT, percent="25", fixed="1")]
    # (6.80+3.20)*1.25+1 = 13.50 -> 13.99 via the parent category rule
    assert display_price_usd(dropship("6.80", "3.20"), rules=rules, category_lineage=[CAT, PARENT]) == D("13.99")
    assert display_price_usd(dropship("6.80", "3.20"), rules=rules, category_lineage=[CAT]) == D("14.99")


def test_rule_round_to_is_used():
    rules = [rule("global", percent="0", round_to="1")]
    assert quote(dropship("10", "2.01"), rules=rules).price == D("13.00")
