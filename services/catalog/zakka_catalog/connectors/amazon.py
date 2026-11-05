"""Amazon (affiliate) via the Amazon Creators API.

Product Advertising API 5.0 was retired on 15 May 2026; its successor for
Associates is the Creators API. Do NOT use PA-API endpoints, and never scrape
amazon.* pages.

Docs: Associates Central -> Tools -> Creators API
      https://affiliate-program.amazon.com/  (TODO(confirm) exact docs URL)

Not yet confirmed (so live mode raises NotConfirmedError rather than guessing):
* token endpoint / grant type for AMAZON_CREATORS_CREDENTIAL_ID + _SECRET
* item lookup / search operation names, marketplace host per country, resources
* the Associates policy on price caching and display (PA-API required showing
  a price timestamp and refreshing within 24h; assume the same until confirmed,
  which is why sync marks Amazon offers stale when not refreshed).

What *is* stable and used in mock mode: Associates links carry the store's
partner tag as the ``tag`` query parameter, one tag per marketplace
(AMAZON_PARTNER_TAGS = "US:zakka-20,AE:zakka-21,...").
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..models import ProductPage, SourceProduct
from .base import Connector, NotConfirmedError


def parse_partner_tags(value: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for part in (value or "").split(","):
        if ":" in part:
            cc, tag = part.split(":", 1)
            if cc.strip() and tag.strip():
                tags[cc.strip().upper()] = tag.strip()
    return tags


def with_tag(url: str, tag: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "tag"] + [("tag", tag)]
    return urlunsplit(parts._replace(query=urlencode(query)))


class AmazonCreatorsConnector(Connector):
    code = "amazon"
    name = "Amazon"
    kind = "affiliate"
    env_keys = ("AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET")
    docs_url = "https://affiliate-program.amazon.com/ (Associates Central > Tools > Creators API)"

    @property
    def partner_tags(self) -> dict[str, str]:
        return parse_partner_tags(self.env.get("AMAZON_PARTNER_TAGS", ""))

    def _tagged(self, p: SourceProduct) -> SourceProduct:
        market = str(p.attributes.get("marketplace", "")).upper()
        tag = self.partner_tags.get(market)
        if p.url and tag:
            p = p.model_copy(update={"url": with_tag(p.url, tag)})
        return p

    def _mock_all(self) -> list[SourceProduct]:
        return [self._tagged(p) for p in super()._mock_all()]

    def _live_products(self, page: int) -> ProductPage:
        raise NotConfirmedError(self.code, "Creators API search/browse", self.docs_url)
