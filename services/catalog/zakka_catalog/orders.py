"""Forward paid orders to dropship suppliers and poll tracking.

forward_order(order_id):
* order must be ``paid`` (or ``forwarded`` - re-running retries failed groups);
* dropship items are grouped by source -> one supplier order per source;
* affiliate items are skipped (the shopper buys those at the retailer);
* idempotent: a source group that already has a non-failed supplier_order is
  not placed again; a ``failed`` one is retried in place;
* when every dropship group is placed the order becomes ``forwarded``;
* ``order_items.unit_cost_usd`` is filled from the offer's ``cost_usd`` for the
  dropship items being placed, and set to null for affiliate items.

poll_tracking():
* asks each open supplier order's connector for tracking, upserts ``shipments``,
  notifies the concierge when a shipment's status changed (see notify.py),
  moves supplier_orders to shipped/delivered, and rolls the order up to
  ``shipped`` / ``delivered`` once all its supplier orders reach that state.

supplier_orders.status values used here: pending, placed, failed, shipped,
delivered, cancelled.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Mapping
from uuid import UUID

from .connectors import Connector, ConnectorError
from .models import Address, SupplierOrderLine, SupplierOrderRequest
from .notify import ConciergeNotifier
from .store import Store

log = logging.getLogger(__name__)

FORWARDABLE = ("paid", "forwarded")
OPEN_SUPPLIER_STATUSES = ("placed", "shipped")


class OrderNotFound(LookupError):
    pass


class OrderNotForwardable(RuntimeError):
    pass


@dataclass
class GroupResult:
    source: str
    status: str  # placed | already_placed | failed
    supplier_order_id: str | None = None
    external_order_id: str | None = None
    cost_usd: str | None = None
    items: int = 0
    error: str | None = None


@dataclass
class ForwardResult:
    order_id: str
    order_status: str
    groups: list[GroupResult] = field(default_factory=list)
    skipped_affiliate_items: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def forward_order(store: Store, order_id: UUID, connectors: Mapping[str, Connector],
                  address: Address | None = None) -> ForwardResult:
    order = store.get_order(order_id)
    if order is None:
        raise OrderNotFound(str(order_id))
    if order.status not in FORWARDABLE:
        raise OrderNotForwardable(f"order {order_id} is {order.status!r}; only paid orders are forwarded")
    if address is None and order.shipping_address:
        address = Address.model_validate(order.shipping_address)

    items = store.get_order_items(order_id)
    result = ForwardResult(order_id=str(order_id), order_status=order.status)
    groups: dict[str, list] = {}
    for it in items:
        if it.source_kind != "dropship":
            result.skipped_affiliate_items.append(str(it.id))
            if it.unit_cost_usd is not None:
                store.set_order_item_unit_cost(it.id, None)  # affiliate: Zakka has no cost
            continue
        groups.setdefault(it.source_code, []).append(it)

    existing = {so.source_code: so for so in store.list_supplier_orders(order_id)}
    all_ok = True
    for code, group in groups.items():
        prev = existing.get(code)
        if prev and prev.status != "failed":
            result.groups.append(GroupResult(code, "already_placed", str(prev.id), prev.external_order_id,
                                             str(prev.cost_usd) if prev.cost_usd is not None else None,
                                             len(group)))
            continue
        connector = connectors.get(code)
        for i in group:  # record what Zakka pays the supplier per unit, from the offer
            if i.unit_cost_usd != i.cost_usd:
                store.set_order_item_unit_cost(i.id, i.cost_usd)
        expected_cost = sum(((i.cost_usd or Decimal(0)) + i.shipping_usd) * i.qty for i in group)
        try:
            if connector is None:
                raise ConnectorError(f"no connector configured for {code}")
            request = SupplierOrderRequest(
                reference=str(order_id), address=address,
                lines=[SupplierOrderLine(external_id=i.external_id, qty=i.qty) for i in group])
            placed = connector.place_order(request)
            cost = placed.cost_usd if placed.cost_usd is not None else expected_cost
            if prev:
                store.update_supplier_order(prev.id, status="placed", external_order_id=placed.external_order_id,
                                            cost_usd=cost)
                so_id = prev.id
            else:
                so_id = store.create_supplier_order(order_id, group[0].source_id, placed.external_order_id,
                                                    "placed", cost)
            result.groups.append(GroupResult(code, "placed", str(so_id), placed.external_order_id, str(cost),
                                             len(group)))
        except Exception as exc:  # record the failure so it can be retried
            all_ok = False
            log.warning("forwarding %s to %s failed: %s", order_id, code, exc)
            if prev:
                store.update_supplier_order(prev.id, status="failed")
                so_id = prev.id
            else:
                so_id = store.create_supplier_order(order_id, group[0].source_id, None, "failed", expected_cost)
            result.groups.append(GroupResult(code, "failed", str(so_id), items=len(group), error=str(exc)))
        store.commit()

    if groups and all_ok and order.status == "paid":
        store.set_order_status(order_id, "forwarded")
        result.order_status = "forwarded"
    store.commit()
    return result


@dataclass
class TrackingUpdate:
    supplier_order_id: str
    source: str
    status: str
    tracking_number: str | None = None
    error: str | None = None
    notified: bool | None = None  # None = status unchanged, no notification sent


_TRACK_TO_SO = {"in_transit": "shipped", "delivered": "delivered", "cancelled": "cancelled"}


def poll_tracking(store: Store, connectors: Mapping[str, Connector],
                  notifier: ConciergeNotifier | None = None) -> list[TrackingUpdate]:
    notifier = notifier if notifier is not None else ConciergeNotifier()
    updates: list[TrackingUpdate] = []
    touched_orders: set[UUID] = set()
    for so in store.list_supplier_orders(statuses=OPEN_SUPPLIER_STATUSES):
        connector = connectors.get(so.source_code)
        if connector is None or not so.external_order_id:
            continue
        try:
            info = connector.track(so.external_order_id)
        except Exception as exc:
            updates.append(TrackingUpdate(str(so.id), so.source_code, so.status, error=str(exc)))
            continue
        previous = store.upsert_shipment(so.id, info)
        store.commit()
        notified = None
        if previous != info.status:
            notified = notifier.notify(so.order_id, info)  # never raises; failures are logged
        new_status = _TRACK_TO_SO.get(info.status, so.status)
        if new_status != so.status:
            store.update_supplier_order(so.id, status=new_status)
        touched_orders.add(so.order_id)
        updates.append(TrackingUpdate(str(so.id), so.source_code, new_status, info.tracking_number,
                                      notified=notified))

    for order_id in touched_orders:
        order = store.get_order(order_id)
        statuses = {s.status for s in store.list_supplier_orders(order_id) if s.status != "cancelled"}
        if not order or not statuses or order.status not in ("forwarded", "shipped"):
            continue
        if statuses == {"delivered"}:
            store.set_order_status(order_id, "delivered")
        elif statuses <= {"shipped", "delivered"} and order.status != "shipped":
            store.set_order_status(order_id, "shipped")
    store.commit()
    return updates
