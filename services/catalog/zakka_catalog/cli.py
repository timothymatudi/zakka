"""Command line: ``python -m zakka_catalog <command>``.

  sync  --source cj | --all  [--dry-run] [--max-pages N] [--json]
  track [--dry-run]
  forward ORDER_ID [--dry-run]
  serve [--port 4020]
  sources                      list connectors and whether they run mock or live
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid

from .config import load_dotenv


def _store(dry_run: bool, *, demo: bool = False):
    from .runtime import demo_store, try_postgres
    from .store import MemoryStore

    if dry_run:
        echo = lambda line: print(f"  [dry-run] {line}")  # noqa: E731
        if demo:
            return demo_store(echo=echo), "memory (dry-run, demo data)"
        return MemoryStore(echo=echo), "memory (dry-run, fixture reference data)"
    pg, note = try_postgres()
    if pg is None:
        print(f"error: {note}. Re-run with --dry-run to print what would be written.", file=sys.stderr)
        sys.exit(2)
    return pg, "postgres"


def cmd_sync(args) -> int:
    from .connectors import SOURCE_CODES, get_connector
    from .enrich import get_enricher
    from .sync import sync_source

    codes = list(SOURCE_CODES) if args.all else [args.source]
    store, store_desc = _store(args.dry_run)
    enricher = get_enricher()
    if args.dry_run and enricher.name != "mock":
        print("note: dry-run still calls the AI enricher for translations (ANTHROPIC_API_KEY is set)")
    print(f"store: {store_desc}; enricher: {enricher.name}")
    reports, rc = [], 0
    for code in codes:
        connector = get_connector(code)
        print(f"\n== {code} ({connector.kind}, {'MOCK' if connector.mock else 'LIVE'}) ==")
        rep = sync_source(store, connector, enricher, max_pages=args.max_pages)
        reports.append(rep)
        for o in rep.offers:
            print(f"  {o.external_id:<14} {o.kind:<9} display_price_usd={o.display_price_usd!s:>8}  "
                  f"category={o.category or '-':<18} {'active' if o.is_active else 'INACTIVE'}  {o.title[:44]}")
        for s in rep.skipped:
            print(f"  skipped {s}")
        if rep.error:
            rc = 1
            print(f"  ERROR {rep.error}")
        print(f"  summary: pages={rep.pages} items={rep.items} products_created={rep.products_created} "
              f"products_matched={rep.products_matched} offers={rep.offers_upserted} "
              f"translations={rep.translations_written} stale_deactivated={rep.stale_deactivated} "
              f"complete={rep.complete}")
    if args.json:
        print(json.dumps([r.as_dict() for r in reports], indent=2, default=str))
    return rc


def cmd_track(args) -> int:
    from .connectors import all_connectors
    from .orders import poll_tracking

    store, desc = _store(args.dry_run, demo=True)
    connectors = all_connectors()
    if args.dry_run:  # demo store needs an order that has been forwarded first
        from .orders import forward_order
        for oid in list(store.orders):
            forward_order(store, oid, connectors)
    print(f"store: {desc}")
    for u in poll_tracking(store, connectors):
        print(f"  {u.source:<14} so={u.supplier_order_id} status={u.status} tracking={u.tracking_number} "
              f"{u.error or ''}")
    return 0


def cmd_forward(args) -> int:
    from .connectors import all_connectors
    from .orders import OrderNotForwardable, OrderNotFound, forward_order

    store, desc = _store(args.dry_run, demo=True)
    print(f"store: {desc}")
    try:
        res = forward_order(store, uuid.UUID(args.order_id), all_connectors())
    except (OrderNotFound, OrderNotForwardable) as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(res.as_dict(), indent=2))
    return 0 if all(g.status != "failed" for g in res.groups) else 1


def cmd_serve(args) -> int:  # pragma: no cover
    from .api import run

    run(port=args.port)
    return 0


def cmd_sources(args) -> int:
    from .connectors import all_connectors

    for c in all_connectors().values():
        d = c.describe()
        print(f"{d['code']:<15} {d['kind']:<9} {'MOCK' if d['mock'] else 'LIVE':<5} "
              f"missing={','.join(d['missing_keys']) or '-'}  docs={d['docs']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    from .connectors import SOURCE_CODES

    p = argparse.ArgumentParser(prog="python -m zakka_catalog")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("sync", help="sync products/offers from connectors")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--source", choices=SOURCE_CODES)
    g.add_argument("--all", action="store_true")
    s.add_argument("--dry-run", action="store_true", help="don't touch the DB; print what would be written")
    s.add_argument("--max-pages", type=int, default=None, help="partial sync (never marks offers stale)")
    s.add_argument("--json", action="store_true", help="also print the full report as JSON")
    s.set_defaults(func=cmd_sync)

    t = sub.add_parser("track", help="poll supplier tracking into shipments")
    t.add_argument("--dry-run", action="store_true")
    t.set_defaults(func=cmd_track)

    f = sub.add_parser("forward", help="forward a paid order's dropship items")
    f.add_argument("order_id")
    f.add_argument("--dry-run", action="store_true")
    f.set_defaults(func=cmd_forward)

    sv = sub.add_parser("serve", help="run the HTTP API")
    sv.add_argument("--port", type=int, default=None)
    sv.set_defaults(func=cmd_serve)

    sc = sub.add_parser("sources", help="list connectors and mock/live mode")
    sc.set_defaults(func=cmd_sources)
    return p


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
