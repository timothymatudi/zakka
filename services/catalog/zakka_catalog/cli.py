"""Command line: ``python -m zakka_catalog <command>``.

  sync  --source cj | --all  [--dry-run] [--max-pages N] [--json]
  track [--dry-run]
  forward ORDER_ID [--dry-run]
  serve [--port 4020]
  sources                      list connectors and whether they run mock or live
  feed --country KE --locale sw --format google-xml|google-tsv|jsonl --out PATH [--demo]
                               merchant feed (dropship offers only), streamed from the store
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


def cmd_export_dev(args) -> int:
    from pathlib import Path

    from .devdata import export_dev_catalog

    out = Path(args.out).resolve()
    data = export_dev_catalog(out)
    print(f"wrote {out} ({out.stat().st_size:,} bytes): {len(data['categories'])} categories, "
          f"{len(data['sources'])} sources, {len(data['products'])} products, {len(data['offers'])} offers, "
          f"{len(data['fx_rates'])} fx rates")
    return 0


def _scale_backends(args):
    """Postgres (DATABASE_URL) for production; local SQLite files otherwise."""
    from pathlib import Path

    from .config import database_url
    from .scale.bulkstore import PostgresBulkStore, SqliteBulkStore
    from .scale.jobqueue import PostgresJobQueue, SqliteJobQueue

    dsn = None if args.local else database_url()
    if dsn:
        try:
            PostgresBulkStore(dsn).conn.close()
            return (lambda: PostgresBulkStore(dsn)), PostgresJobQueue(dsn), "postgres"
        except Exception as exc:
            print(f"note: database unreachable ({type(exc).__name__}); using local SQLite in {args.cache_dir}")
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    db = cache / "catalog.sqlite"
    return (lambda: SqliteBulkStore(db)), SqliteJobQueue(cache / "jobs.sqlite"), f"sqlite ({db})"


def _scale_deps(args):
    from .connectors import all_connectors
    from .enrich import get_enricher
    from .images import get_image_store
    from .notify import ConciergeNotifier
    from .scheduler import Reindexer

    return dict(connectors=all_connectors(), enricher=get_enricher(), images=get_image_store(cache_dir=args.cache_dir),
                reindexer=Reindexer(cache_dir=args.cache_dir), notifier=ConciergeNotifier())


def cmd_scheduler(args) -> int:
    from .scheduler import interval_minutes, run_forever, run_once

    make_bulk, queue, desc = _scale_backends(args)
    deps = _scale_deps(args)
    interval = args.interval or interval_minutes()
    print(f"scheduler: store={desc}, workers={args.workers}, every {interval:g} min{' (once)' if args.once else ''}")

    def one():
        summary = run_once(make_bulk, queue, deps["connectors"], deps["enricher"], images=deps["images"],
                           reindexer=deps["reindexer"], notifier=deps["notifier"], workers=args.workers,
                           cache_dir=args.cache_dir)
        print(summary.line(), flush=True)
        return summary

    run_forever(one, interval_min=interval, once=args.once)
    return 0


def cmd_worker(args) -> int:  # pragma: no cover - long-running
    import threading

    from .scale.jobqueue import Worker
    from .scale.pipeline import ScaleContext, make_handlers
    from .scheduler import RetryPolicy

    make_bulk, queue, desc = _scale_backends(args)
    deps = _scale_deps(args)
    retry = RetryPolicy()
    ctx = ScaleContext(make_bulk=make_bulk, queue=queue, connectors=deps["connectors"], enricher=deps["enricher"],
                       images=deps["images"], reindexer=deps["reindexer"], notifier=deps["notifier"],
                       call_for=lambda c: retry.for_connector(c, {}))
    handlers = make_handlers(ctx)
    print(f"worker: store={desc}, threads={args.workers}; Ctrl+C to stop")
    stop = threading.Event()
    threads = [threading.Thread(target=Worker(queue, handlers, name=f"w{i}").run_forever,
                                kwargs={"stop": stop}, daemon=True) for i in range(args.workers)]
    for t in threads:
        t.start()
    try:
        while any(t.is_alive() for t in threads):
            stop.wait(1)
    except KeyboardInterrupt:
        stop.set()
    return 0


def cmd_bench(args) -> int:
    from pathlib import Path

    from .scale.bench import run_bench

    print(f"bench: {args.products:,} synthetic products, batch {args.batch:,}, {args.changed_pct}% changed in run 2")
    report = run_bench(args.products, db=Path(args.db), batch_size=args.batch, changed_pct=args.changed_pct,
                       keep=args.keep, dsn=args.dsn, lite=not args.full_rows)
    print(json.dumps(report, indent=2, default=str))
    return 0


def cmd_sources(args) -> int:
    from .connectors import all_connectors

    for c in all_connectors().values():
        d = c.describe()
        print(f"{d['code']:<15} {d['kind']:<9} {'MOCK' if d['mock'] else 'LIVE':<5} "
              f"missing={','.join(d['missing_keys']) or '-'}  docs={d['docs']}")
    return 0


def cmd_feed(args) -> int:
    import os
    import tempfile
    from pathlib import Path

    from .config import web_base_url
    from .feed import write_feed

    if args.demo:
        from .runtime import demo_store

        store, desc = demo_store(), "memory (demo fixtures)"
    else:
        from .runtime import try_postgres

        store, note = try_postgres()
        if store is None:
            print(f"error: {note}. Re-run with --demo to build a feed from the fixture catalog.", file=sys.stderr)
            return 2
        desc = "postgres"
    base = args.web_base_url or web_base_url()
    if args.out == "-":
        stats = write_feed(store, sys.stdout, args.format, args.country, args.locale, web_base_url=base)
    else:
        out = Path(args.out).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file and rename, so a feed URL never serves a half-written file.
        fd, tmp = tempfile.mkstemp(prefix=out.name + ".", suffix=".tmp", dir=out.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                stats = write_feed(store, fh, args.format, args.country, args.locale, web_base_url=base)
            os.replace(tmp, out)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
    skipped = ", ".join(f"{k}={v}" for k, v in sorted(stats.skipped.items())) or "none"
    print(f"feed: store={desc} country={args.country.upper()} locale={args.locale} format={args.format} "
          f"items={stats.items} skipped: {skipped}" + ("" if args.out == "-" else f" -> {args.out}"),
          file=sys.stderr)
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

    ex = sub.add_parser("export-dev", help="write the shared dev catalog JSON (mock sync of all sources)")
    from .devdata import DEFAULT_DEV_CATALOG
    ex.add_argument("--out", default=str(DEFAULT_DEV_CATALOG))
    ex.set_defaults(func=cmd_export_dev)

    for name, func, helptext in (("scheduler", cmd_scheduler, "tiered refresh loop: plan jobs and drain the queue"),
                                 ("worker", cmd_worker, "run queue workers continuously")):
        w = sub.add_parser(name, help=helptext)
        w.add_argument("--workers", type=int, default=2)
        w.add_argument("--cache-dir", default=".cache")
        w.add_argument("--local", action="store_true", help="use local SQLite even if DATABASE_URL is set")
        if name == "scheduler":
            w.add_argument("--once", action="store_true")
            w.add_argument("--interval", type=float, default=None, help="minutes (default SYNC_INTERVAL_MINUTES or 60)")
        w.set_defaults(func=func)

    b = sub.add_parser("bench", help="ingest N synthetic products through the scale pipeline")
    b.add_argument("--products", type=int, default=100_000)
    b.add_argument("--batch", type=int, default=1000)
    b.add_argument("--changed-pct", type=float, default=1.0)
    b.add_argument("--db", default=".cache/bench.sqlite")
    b.add_argument("--dsn", default=None, help="benchmark against Postgres instead of SQLite")
    b.add_argument("--keep", action="store_true", help="keep the bench database files")
    b.add_argument("--full-rows", action="store_true",
                   help="store full product/offer/translation rows (needs ~1.4 GB per 1M products)")
    b.set_defaults(func=cmd_bench)

    from .feed import FORMATS

    fd = sub.add_parser("feed", help="export a merchant product feed (Google format) for one country + locale")
    fd.add_argument("--country", required=True, type=lambda v: v.upper())
    fd.add_argument("--locale", required=True)
    fd.add_argument("--format", choices=FORMATS, default="google-xml")
    fd.add_argument("--out", required=True, help="output path, or - for stdout")
    fd.add_argument("--demo", action="store_true", help="use the offline fixture catalog instead of DATABASE_URL")
    fd.add_argument("--web-base-url", default=None, help="storefront origin for links (default WEB_BASE_URL)")
    fd.set_defaults(func=cmd_feed)

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
