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


def test_mock_categorize_uses_seed_tree():
    m = MockEnricher()
    # most specific source segment maps directly when it is one of our categories
    assert m.categorize(prod(category_hint="Fashion > Dresses", title="Wrap"), CATS) == "dresses"
    # keywords beat a broad parent segment
    assert m.categorize(prod(category_hint="Electronics > Audio > Headphones"), CATS) == "audio-headphones"
    assert m.categorize(prod(category_hint=None, title="Ceramic mug"), CATS) == "tableware"
    # whole words only: "light-up sneakers" is not lighting
    assert m.categorize(prod(category_hint=None, title="Kids Light-up Sneakers"), CATS) == "kids-shoes"
    # falls back to a broader segment, then None
    assert m.categorize(prod(category_hint="Electronics > Gadgets", title="Thing"), CATS) == "electronics"
    assert m.categorize(prod(category_hint="Misc", title="Thingamajig"), CATS) is None


def test_categories_match_supabase_seed_with_all_locales():
    assert len(CATS) == 122
    by_slug = {c.slug: c for c in CATS}
    assert by_slug["audio-headphones"].parent_id == by_slug["electronics"].id
    assert all(len(c.names) == 10 for c in CATS)


class FakeMessages:
    def __init__(self, parsed, stop_reason="end_turn"):
        self.parsed, self.stop_reason, self.calls = parsed, stop_reason, []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(parsed_output=self.parsed, stop_reason=self.stop_reason)


def test_anthropic_enricher_uses_structured_output_and_validates():
    parsed = _EnrichmentOutput(category_slug="audio-headphones", translations=[
        _LocaleCopy(locale="fr", title="Écouteurs sans fil", description="Bien"),
        _LocaleCopy(locale="xx", title="ignored")])
    fake = SimpleNamespace(messages=FakeMessages(parsed))
    enr = AnthropicEnricher(client=fake, model="test-model")
    out = enr.enrich(prod(), CATS, ["en", "fr", "de"])
    call = fake.messages.calls[0]
    assert call["model"] == "test-model" and call["output_format"] is _EnrichmentOutput
    system = call["system"]
    assert system[-1]["cache_control"] == {"type": "ephemeral"} and "audio-headphones" in system[-1]["text"]
    assert "Wireless Earbuds" not in system[-1]["text"]  # product data stays out of the cached prefix
    assert out.category_slug == "audio-headphones"
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
