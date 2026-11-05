from types import SimpleNamespace

from zakka_catalog.config import PHASE1_LOCALES
from zakka_catalog.enrich import (
    AnthropicEnricher,
    MockEnricher,
    _EnrichmentOutput,
    _LocaleCopy,
    get_enricher,
)
from zakka_catalog.models import SourceProduct
from zakka_catalog.store import MemoryStore

CATS = MemoryStore().list_categories()


def prod(**kw):
    return SourceProduct(**{"external_id": "1", "title": "Wireless Earbuds", "description": "Nice",
                            "bullet_points": ["BT 5.3"], **kw})


def test_mock_is_default_without_key():
    assert isinstance(get_enricher({}), MockEnricher)
    assert isinstance(get_enricher({"ANTHROPIC_API_KEY": ""}), MockEnricher)


def test_mock_translations_are_deterministic_placeholders():
    r1 = MockEnricher().enrich(prod(), CATS, PHASE1_LOCALES)
    r2 = MockEnricher().enrich(prod(), CATS, PHASE1_LOCALES)
    assert r1 == r2
    assert set(r1.translations) == set(PHASE1_LOCALES)
    assert r1.translations["en"].title == "Wireless Earbuds"
    assert r1.translations["ar"].title == "[ar] Wireless Earbuds"
    assert r1.translations["sw"].bullet_points == ["[sw] BT 5.3"]


def test_mock_categorize_prefers_deepest_matching_path_segment():
    m = MockEnricher()
    assert m.categorize(prod(category_hint="Electronics > Audio > Headphones"), CATS) == "headphones"
    assert m.categorize(prod(category_hint="Fashion > Women's Clothing > Dresses", title="Dress"), CATS) \
        == "womens-clothing"
    assert m.categorize(prod(category_hint=None, title="Ceramic mug"), CATS) == "kitchen"
    assert m.categorize(prod(category_hint="Misc", title="Thingamajig"), CATS) is None


class FakeMessages:
    def __init__(self, parsed, stop_reason="end_turn"):
        self.parsed, self.stop_reason, self.calls = parsed, stop_reason, []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(parsed_output=self.parsed, stop_reason=self.stop_reason)


def test_anthropic_enricher_uses_structured_output_and_validates():
    parsed = _EnrichmentOutput(category_slug="headphones", translations=[
        _LocaleCopy(locale="fr", title="Écouteurs sans fil", description="Bien"),
        _LocaleCopy(locale="xx", title="ignored")])
    fake = SimpleNamespace(messages=FakeMessages(parsed))
    enr = AnthropicEnricher(client=fake, model="test-model")
    out = enr.enrich(prod(), CATS, ["en", "fr", "de"])
    call = fake.messages.calls[0]
    assert call["model"] == "test-model" and call["output_format"] is _EnrichmentOutput
    system = call["system"]
    assert system[-1]["cache_control"] == {"type": "ephemeral"} and "headphones" in system[-1]["text"]
    assert "Wireless Earbuds" not in system[-1]["text"]  # product data stays out of the cached prefix
    assert out.category_slug == "headphones"
    assert out.translations["fr"].title == "Écouteurs sans fil"
    assert "xx" not in out.translations
    assert out.translations["de"].title == "Wireless Earbuds"  # missing locale falls back to source text


def test_anthropic_enricher_rejects_unknown_slug_and_handles_refusal():
    bad = _EnrichmentOutput(category_slug="not-a-slug", translations=[])
    out = AnthropicEnricher(client=SimpleNamespace(messages=FakeMessages(bad)), model="m").enrich(prod(), CATS, ["en"])
    assert out.category_slug is None
    refused = AnthropicEnricher(client=SimpleNamespace(messages=FakeMessages(None, "refusal")), model="m")
    out = refused.enrich(prod(), CATS, ["fr"])
    assert out.translations["fr"].title == "[fr] Wireless Earbuds"  # mock fallback


def test_model_comes_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    assert AnthropicEnricher(client=object()).model == "claude-sonnet-5-5"
