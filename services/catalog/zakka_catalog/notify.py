"""Tell the WhatsApp concierge (services/concierge) about shipment status changes.

POST {CONCIERGE_PUBLIC_URL}/internal/orders/{order_id}/notify
  header  x-internal-token: $CONCIERGE_INTERNAL_TOKEN
  body    {status, carrier, tracking_number, tracking_url, last_event}

Mock mode (CONCIERGE_INTERNAL_TOKEN empty): log only, no HTTP call. Failures are
logged and swallowed so tracking polling never breaks because of the concierge.
"""

from __future__ import annotations

import logging
import os
from typing import Mapping
from uuid import UUID

import httpx

from .models import TrackingInfo

log = logging.getLogger(__name__)

DEFAULT_CONCIERGE_URL = "http://localhost:4030"


class ConciergeNotifier:
    def __init__(self, env: Mapping[str, str] | None = None, *, http: httpx.Client | None = None):
        env = os.environ if env is None else env
        self.base_url = ((env.get("CONCIERGE_PUBLIC_URL") or "").strip() or DEFAULT_CONCIERGE_URL).rstrip("/")
        self.token = (env.get("CONCIERGE_INTERNAL_TOKEN") or "").strip()
        self._http = http
        self.sent: list[tuple[str, dict]] = []  # what was notified (or would have been, in mock mode)

    @property
    def mock(self) -> bool:
        return not self.token

    @staticmethod
    def payload(info: TrackingInfo) -> dict:
        return {"status": info.status, "carrier": info.carrier, "tracking_number": info.tracking_number,
                "tracking_url": info.tracking_url, "last_event": info.last_event}

    def notify(self, order_id: UUID | str, info: TrackingInfo) -> bool:
        """Returns True if delivered (or logged in mock mode); never raises."""
        body = self.payload(info)
        url = f"{self.base_url}/internal/orders/{order_id}/notify"
        self.sent.append((str(order_id), body))
        if self.mock:
            log.info("concierge notify (mock, not sent): %s %s", url, body)
            return True
        try:
            if self._http is None:
                self._http = httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))
            resp = self._http.post(url, json=body, headers={"x-internal-token": self.token})
            if resp.status_code >= 400:
                log.warning("concierge notify for order %s failed: HTTP %s %s", order_id, resp.status_code,
                            resp.text[:200])
                return False
            return True
        except Exception as exc:  # network errors, timeouts, bad URL ...
            log.warning("concierge notify for order %s failed: %s: %s", order_id, type(exc).__name__, exc)
            return False
