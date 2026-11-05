"""Sources whose official API / feed access is not confirmed yet.

For each of these the live adapter deliberately raises NotConfirmedError with
the place to confirm access - we do not invent endpoints, and we never scrape
the retailer's website. Mock mode (fixtures) works today.

Typical official routes to evaluate (confirm before building):

* Spocket   - Spocket is mostly consumed through its Shopify/Wix/etc. apps; a
              public REST API for third-party stores has not been confirmed.
              Ask Spocket for partner API access.
* Temu      - Temu Affiliate Program; product data via an official affiliate
              feed / partner API if Temu grants one.
* Shein     - Shein Affiliate Program (often via an affiliate network's product
              datafeed).
* Jumia     - Jumia KOL affiliate program (kol.jumia.com); product feed/API per
              country (NG, KE, EG, MA, CI, ...).
* Noon      - noon affiliate program (AE, SA, EG); product feed via the program.
* Flipkart  - Flipkart Affiliate API (affiliate-api.flipkart.net) uses
              Fk-Affiliate-Id + Fk-Affiliate-Token headers (FLIPKART_AFFILIATE_ID,
              FLIPKART_AFFILIATE_TOKEN). Endpoint paths/response still TODO(confirm).
"""

from __future__ import annotations

from ..models import ProductPage
from .base import Connector, NotConfirmedError


class _UnconfirmedConnector(Connector):
    def _live_products(self, page: int) -> ProductPage:
        raise NotConfirmedError(self.code, "product feed/API", self.docs_url)


class SpocketConnector(_UnconfirmedConnector):
    code = "spocket"
    name = "Spocket"
    kind = "dropship"
    env_keys = ("SPOCKET_API_KEY",)
    docs_url = "https://www.spocket.co/ (request partner API docs; none public confirmed)"


class TemuConnector(_UnconfirmedConnector):
    code = "temu"
    name = "Temu"
    kind = "affiliate"
    env_keys = ("TEMU_AFFILIATE_ID",)
    docs_url = "https://www.temu.com/ (Temu Affiliate Program portal - TODO(confirm) feed/API)"


class SheinConnector(_UnconfirmedConnector):
    code = "shein"
    name = "Shein"
    kind = "affiliate"
    env_keys = ("SHEIN_AFFILIATE_ID",)
    docs_url = "https://www.shein.com/ (SHEIN Affiliate Program - TODO(confirm) feed/API)"


class JumiaConnector(_UnconfirmedConnector):
    code = "jumia"
    name = "Jumia"
    kind = "affiliate"
    env_keys = ("JUMIA_AFFILIATE_ID",)
    docs_url = "https://kol.jumia.com/ (Jumia KOL affiliate program - TODO(confirm) feed/API)"


class NoonConnector(_UnconfirmedConnector):
    code = "noon"
    name = "Noon"
    kind = "affiliate"
    env_keys = ("NOON_AFFILIATE_ID",)
    docs_url = "https://www.noon.com/ (noon affiliate program - TODO(confirm) feed/API)"


class FlipkartConnector(_UnconfirmedConnector):
    code = "flipkart"
    name = "Flipkart"
    kind = "affiliate"
    env_keys = ("FLIPKART_AFFILIATE_ID", "FLIPKART_AFFILIATE_TOKEN")
    docs_url = "https://affiliate.flipkart.com/api-docs/ (TODO(confirm) endpoints and response)"
