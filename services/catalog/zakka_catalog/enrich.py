"""AI enrichment hook: categorise products into our tree and translate copy.

* ``MockEnricher`` (default when ANTHROPIC_API_KEY is empty, and in tests):
  deterministic keyword/slug categorisation and placeholder translations
  ``"[fr] Original title"``. No network.
* ``AnthropicEnricher``: one Messages API call per product using structured
  outputs (``client.messages.parse`` with a pydantic schema). Model comes from
  ANTHROPIC_MODEL.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from typing import Mapping, Sequence

from pydantic import BaseModel, Field

from .config import env as getenv
from .models import CategoryRef, SourceProduct, Translation

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"


class EnrichmentResult(BaseModel):
    category_slug: str | None = None
    translations: dict[str, Translation] = Field(default_factory=dict)


class Enricher(ABC):
    name: str = "base"

    @abstractmethod
    def enrich(self, product: SourceProduct, categories: Sequence[CategoryRef],
               locales: Sequence[str]) -> EnrichmentResult:
        """Return a category slug (one of ``categories`` or None) and a translation per locale."""


def _slug(text: str) -> str:
    text = text.lower().replace("&", " ").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


# Keyword fallbacks when the source's category path doesn't match our slugs.
KEYWORDS: dict[str, tuple[str, ...]] = {
    "headphones": ("earbud", "earphone", "headphone", "headset"),
    "phone-accessories": ("phone", "power bank", "charger", "car mount"),
    "wearables": ("smart watch", "smartwatch", "wearable"),
    "computers": ("keyboard", "mouse", "laptop", "computer"),
    "lighting": ("lamp", "light", "led"),
    "kitchen": ("mug", "kitchen", "cooker", "bottle", "utensil", "food bag", "dallah", "blender"),
    "appliances": ("fryer", "fan", "appliance", "gas cooker"),
    "home-decor": ("candle", "decor", "prayer mat"),
    "womens-clothing": ("women", "dress", "kurta", "cardigan"),
    "mens-clothing": ("men's", "mens", "shirt", "tee"),
    "shoes": ("shoe", "sneaker", "sandal"),
    "bags": ("bag", "tote"),
    "accessories": ("hat", "cap"),
    "sports-outdoors": ("yoga", "fitness", "sport"),
    "toys-games": ("toy", "building blocks", "game"),
    "beauty": ("beauty", "skincare", "makeup"),
}


class MockEnricher(Enricher):
    name = "mock"

    def categorize(self, product: SourceProduct, categories: Sequence[CategoryRef]) -> str | None:
        by_key: dict[str, str] = {}
        for c in categories:
            by_key[c.slug] = c.slug
            if c.name:
                by_key[_slug(c.name)] = c.slug
        # 1) deepest segment of the source category path that matches our tree
        if product.category_hint:
            for seg in reversed([s.strip() for s in product.category_hint.split(">")]):
                if _slug(seg) in by_key:
                    return by_key[_slug(seg)]
        # 2) keyword match on hint + title; prefer earlier (more specific) entries
        haystack = f"{product.category_hint or ''} {product.title}".lower()
        known = {c.slug for c in categories}
        for slug, words in KEYWORDS.items():
            if slug in known and any(w in haystack for w in words):
                return slug
        return None

    def enrich(self, product, categories, locales):
        out: dict[str, Translation] = {}
        for loc in locales:
            if loc == product.locale:
                out[loc] = Translation(title=product.title, description=product.description,
                                       bullet_points=list(product.bullet_points))
            else:
                out[loc] = Translation(
                    title=f"[{loc}] {product.title}",
                    description=f"[{loc}] {product.description}" if product.description else None,
                    bullet_points=[f"[{loc}] {b}" for b in product.bullet_points],
                )
        return EnrichmentResult(category_slug=self.categorize(product, categories), translations=out)


# ---------------------------------------------------------------------------
# Anthropic


class _LocaleCopy(BaseModel):
    locale: str
    title: str
    description: str | None = None
    bullet_points: list[str] = Field(default_factory=list)


class _EnrichmentOutput(BaseModel):
    category_slug: str | None
    translations: list[_LocaleCopy]


SYSTEM_PROMPT = """You enrich product listings for Zakka, a worldwide shopping catalog.
1. Pick the single most specific category slug from the list below that fits the product, or null if none fits.
2. Write the product title, description and bullet points in each requested locale.
   Translate faithfully: do not add claims, prices, or promotional language that is not in the source.
   Keep brand names, model numbers and units unchanged. Titles under 120 characters.
   Use natural, everyday shopping language for each locale (e.g. Modern Standard Arabic for "ar",
   Simplified Chinese for "zh", Kiswahili for "sw", Bahasa Indonesia for "id")."""


class AnthropicEnricher(Enricher):
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None, client=None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key or getenv("ANTHROPIC_API_KEY"))
        self.client = client
        self.model = model or getenv("ANTHROPIC_MODEL") or DEFAULT_MODEL

    @staticmethod
    def system_blocks(categories: Sequence[CategoryRef]) -> list[dict]:
        """Instructions + category tree: identical for every product in a run, so it is
        the cached prefix (prompt caching). Product data goes in the user turn."""
        cat_lines = "\n".join(f"- {c.slug}" + (f" ({c.name})" if c.name else "")
                              for c in sorted(categories, key=lambda c: c.slug))
        return [{"type": "text", "text": f"{SYSTEM_PROMPT}\n\nCategory slugs:\n{cat_lines}",
                 "cache_control": {"type": "ephemeral"}}]

    def enrich(self, product, categories, locales):
        # One request per product covers categorisation and all requested locales.
        fields = {"locale", "title", "description", "bullet_points", "category_hint", "brand"}
        user = (f"Requested locales: {', '.join(locales) or '(none - categorise only)'}\n\n"
                f"Product (JSON):\n{product.model_dump_json(include=fields)}")
        response = self.client.messages.parse(
            model=self.model,
            max_tokens=16000,
            system=self.system_blocks(categories),
            messages=[{"role": "user", "content": user}],
            output_format=_EnrichmentOutput,
        )
        if getattr(response, "stop_reason", None) == "refusal" or response.parsed_output is None:
            log.warning("enrichment declined for %s; falling back to mock", product.external_id)
            return MockEnricher().enrich(product, categories, locales)
        parsed: _EnrichmentOutput = response.parsed_output
        valid = {c.slug for c in categories}
        slug = parsed.category_slug if parsed.category_slug in valid else None
        translations = {t.locale: Translation(title=t.title, description=t.description,
                                              bullet_points=t.bullet_points)
                        for t in parsed.translations if t.locale in locales}
        # Never lose the source text; fill any locale the model skipped with the original.
        for loc in locales:
            translations.setdefault(loc, Translation(title=product.title, description=product.description,
                                                     bullet_points=list(product.bullet_points)))
        return EnrichmentResult(category_slug=slug, translations=translations)


def get_enricher(environ: Mapping[str, str] | None = None) -> Enricher:
    key = (environ or {}).get("ANTHROPIC_API_KEY") if environ is not None else getenv("ANTHROPIC_API_KEY")
    if not key:
        return MockEnricher()
    model = (environ or {}).get("ANTHROPIC_MODEL") if environ is not None else getenv("ANTHROPIC_MODEL")
    return AnthropicEnricher(api_key=key, model=model or None)
