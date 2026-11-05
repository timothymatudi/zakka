"""Connector registry. Codes match ``sources.code`` in the contract."""

from __future__ import annotations

from typing import Mapping

from .aliexpress import AliExpressAffiliateConnector, AliExpressDropshipConnector
from .amazon import AmazonCreatorsConnector
from .base import Connector, ConnectorError, NotConfirmedError, NotSupportedError, load_fixture
from .cj import CJConnector
from .partners import (
    FlipkartConnector,
    JumiaConnector,
    NoonConnector,
    SheinConnector,
    SpocketConnector,
    TemuConnector,
)
from .printful import PrintfulConnector

CONNECTORS: dict[str, type[Connector]] = {
    c.code: c
    for c in (
        CJConnector, AliExpressDropshipConnector, SpocketConnector, PrintfulConnector,
        AmazonCreatorsConnector, TemuConnector, SheinConnector, AliExpressAffiliateConnector,
        JumiaConnector, NoonConnector, FlipkartConnector,
    )
}

SOURCE_CODES = tuple(CONNECTORS)


def get_connector(code: str, env: Mapping[str, str] | None = None, **kwargs) -> Connector:
    try:
        cls = CONNECTORS[code]
    except KeyError:
        raise ValueError(f"unknown source {code!r}; expected one of {', '.join(SOURCE_CODES)}") from None
    return cls(env, **kwargs)


def all_connectors(env: Mapping[str, str] | None = None, **kwargs) -> dict[str, Connector]:
    return {code: cls(env, **kwargs) for code, cls in CONNECTORS.items()}


__all__ = [
    "CONNECTORS", "SOURCE_CODES", "Connector", "ConnectorError", "NotConfirmedError",
    "NotSupportedError", "get_connector", "all_connectors", "load_fixture",
]
