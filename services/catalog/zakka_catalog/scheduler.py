"""Catalog refresh: ``python -m zakka_catalog scheduler [--once]``.

Runs every SYNC_INTERVAL_MINUTES (default 60). Each run plans work and lets workers
drain the durable job queue (``scale.jobqueue``):

1. Recompute refresh tiers (hot / warm / cold) from engagement and search impressions.
   Newly promoted products get ``fetch_detail`` jobs (full images, specs, AI).
2. Enqueue one ``import_source`` job per active DROPSHIP source. Each job is a
   checkpointed, streaming scan: a full scan weekly, and a delta ("updated since") scan
   in between where the supplier supports it. It resumes after any interruption.
   Affiliate catalogues are never bulk-imported (see ``scale.live``).
3. Enqueue ``refresh_offers`` jobs to re-price hot offers (hourly) and warm offers (daily)
   that are due.
4. Workers run the import, refresh, detail-fetch, image-mirroring, AI-translation,
   reindex and notification jobs, with retries, backoff and a dead-letter state.
   One failing source or job never stops the others.
5. Log a run summary (items scanned/changed/failed, API calls vs quota, jobs, tiers,
   duration) and write it to ``.cache/last-run.json``.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping

import httpx

from .connectors import Connector, NotConfirmedError, NotSupportedError
from .enrich import Enricher
from .images import ImageStore
from .scale.bulkstore import SqlBulkStore, utcnow
from .scale.jobqueue import JobQueue, NonRetryable, Worker, drain_parallel
from .scale.live import QuotaTracker
from .scale.pipeline import ScaleContext, make_handlers, plan_refresh, plan_reprice, promote_detail_jobs

log = logging.getLogger(__name__)

DEFAULT_INTERVAL_MINUTES = 60
NON_RETRYABLE = (NotConfirmedError, NotSupportedError, NonRetryable, ValueError, KeyError, TypeError)


def interval_minutes(env: Mapping[str, str] | None = None) -> float:
    env = os.environ if env is None else env
    raw = (env.get("SYNC_INTERVAL_MINUTES") or "").strip()
    try:
        value = float(raw) if raw else DEFAULT_INTERVAL_MINUTES
    except ValueError:
        log.warning("invalid SYNC_INTERVAL_MINUTES=%r, using %s", raw, DEFAULT_INTERVAL_MINUTES)
        return DEFAULT_INTERVAL_MINUTES
    return value if value > 0 else DEFAULT_INTERVAL_MINUTES


@dataclass
class RetryPolicy:
    attempts: int = 4
    base_delay: float = 2.0
    max_delay: float = 60.0
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic

    def for_connector(self, connector: Connector, counter: dict, quota: QuotaTracker | None = None) -> Callable:
        """A ``call(fn, *args)`` wrapper with throttling + retries for one connector."""
        min_gap = 0.0 if connector.mock else 1.0 / max(connector.rate_limit_per_sec, 0.01)
        last = {"t": None}

        def call(fn, *args):
            for attempt in range(1, self.attempts + 1):
                if min_gap and last["t"] is not None:
                    wait = min_gap - (self.clock() - last["t"])
                    if wait > 0:
                        self.sleep(wait)
                last["t"] = self.clock()
                if quota is not None:
                    quota.consume(connector.code)
                counter["calls"] = counter.get("calls", 0) + 1
                try:
                    return fn(*args)
                except NON_RETRYABLE:
                    raise
                except Exception as exc:
                    if attempt == self.attempts:
                        raise
                    delay = self._delay(exc, attempt)
                    counter["retries"] = counter.get("retries", 0) + 1
                    log.warning("[%s] %s failed (%s: %s); retry %d/%d in %.1fs", connector.code,
                                getattr(fn, "__name__", "call"), type(exc).__name__, exc, attempt,
                                self.attempts - 1, delay)
                    self.sleep(delay)

        return call

    def _delay(self, exc: Exception, attempt: int) -> float:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
            try:
                return min(float(exc.response.headers.get("retry-after", "")), self.max_delay)
            except ValueError:
                pass
        return min(self.base_delay * 2 ** (attempt - 1), self.max_delay)


class Reindexer:
    """Ask search to reindex changed products; fall back to a local id file."""

    def __init__(self, env: Mapping[str, str] | None = None, *, http: httpx.Client | None = None,
                 cache_dir: Path | str = ".cache"):
        env = os.environ if env is None else env
        self.base_url = (env.get("SEARCH_API_URL") or "").strip().rstrip("/")
        self.http = http
        self.file = Path(cache_dir) / "reindex-ids.json"

    def reindex(self, product_ids: list[str]) -> str:
        if not product_ids:
            return "none"
        if self.base_url:
            try:
                http = self.http or httpx.Client(timeout=httpx.Timeout(30.0, connect=5.0))
                resp = http.post(f"{self.base_url}/admin/reindex", json={"product_ids": product_ids})
                if resp.status_code < 300:
                    return "search"
                log.info("search reindex endpoint answered HTTP %s; writing ids to %s", resp.status_code, self.file)
            except Exception as exc:
                log.info("search reindex unavailable (%s: %s); writing ids to %s", type(exc).__name__, exc, self.file)
        self._append_file(product_ids)
        return "file"

    def _append_file(self, product_ids: list[str]) -> None:
        existing: set[str] = set()
        if self.file.is_file():
            try:
                existing = set(json.loads(self.file.read_text(encoding="utf-8")).get("product_ids", []))
            except (OSError, ValueError):
                pass
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps({"updated_at": _now_iso(), "product_ids": sorted(existing | set(product_ids))},
                                        indent=1) + "\n", encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class RunSummary:
    started_at: str
    duration_s: float = 0.0
    tiers: dict = field(default_factory=dict)
    promoted: int = 0
    reprice_jobs: int = 0
    imports: dict[str, dict] = field(default_factory=dict)
    jobs: dict = field(default_factory=dict)
    queue: dict = field(default_factory=dict)
    api: dict = field(default_factory=dict)
    failures: int = 0

    def as_dict(self) -> dict:
        return self.__dict__.copy()

    def line(self) -> str:
        scanned = sum(i.get("scanned", 0) for i in self.imports.values())
        changed = sum(i.get("new", 0) + i.get("changed", 0) for i in self.imports.values())
        return (f"catalog refresh: {len(self.imports)} import(s), {scanned} scanned, {changed} new/changed, "
                f"jobs done={self.jobs.get('done', 0)} retried={self.jobs.get('retried', 0)} "
                f"dead={self.jobs.get('dead', 0)}, {self.failures} failure(s), {self.duration_s:.1f}s")


def run_once(make_bulk: Callable[[], SqlBulkStore], queue: JobQueue, connectors: Mapping[str, Connector],
             enricher: Enricher, *, images: ImageStore | None = None, reindexer: Reindexer | None = None,
             notifier=None, retry: RetryPolicy | None = None, quota: QuotaTracker | None = None, workers: int = 1,
             max_jobs: int | None = None, cache_dir: Path | str = ".cache",
             now: Callable[[], datetime] = utcnow) -> RunSummary:
    """Plan this run's jobs, then drain the queue with ``workers`` threads."""
    retry = retry or RetryPolicy()
    quota = quota or QuotaTracker({c: k.daily_quota for c, k in connectors.items()})
    counters: dict[str, dict] = {code: {} for code in connectors}
    t0 = time.monotonic()
    summary = RunSummary(started_at=_now_iso())
    ctx = ScaleContext(make_bulk=make_bulk, queue=queue, connectors=connectors, enricher=enricher, images=images,
                       reindexer=reindexer, notifier=notifier, now=now,
                       call_for=lambda c: retry.for_connector(c, counters.setdefault(c.code, {}), quota))
    queue.requeue_stale()
    bulk = ctx.bulk()
    with bulk.transaction():
        tiers = bulk.recompute_tiers(now())
    summary.promoted = tiers["promoted"]
    promote_detail_jobs(ctx, tiers["promoted_product_ids"])
    for code, conn in connectors.items():
        src = bulk.get_source(code)
        if conn.kind == "dropship" and (src is None or src.is_active):
            queue.enqueue("import_source", {"source": code}, dedupe_key=f"import:{code}", priority=9)
    plan_refresh(ctx)
    summary.reprice_jobs = plan_reprice(ctx)
    handlers = make_handlers(ctx)
    stats = drain_parallel(lambda i: Worker(queue, handlers, name=f"worker-{i}"), max(1, workers), max_jobs)
    summary.jobs = {"done": stats.done, "retried": stats.retried, "dead": stats.dead}
    for res in ctx.results:
        summary.imports[res.source] = {"scope": res.scope, "complete": res.complete, "pages": res.pages,
                                       "resumed_from": res.resumed_from, **res.stats.__dict__}
    summary.tiers = bulk.tier_counts()
    summary.queue = queue.counts()
    summary.api = {code: {"calls": c.get("calls", 0), "retries": c.get("retries", 0),
                          "quota": connectors[code].daily_quota if code in connectors else None}
                   for code, c in counters.items() if c}
    summary.failures = stats.dead + stats.retried + sum(i.get("failed", 0) for i in summary.imports.values())
    summary.duration_s = round(time.monotonic() - t0, 2)
    log.info(summary.line())
    try:
        path = Path(cache_dir) / "last-run.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(summary.as_dict(), indent=1, default=str) + "\n", encoding="utf-8")
    except OSError as exc:
        log.warning("could not write run summary: %s", exc)
    return summary


def run_forever(run: Callable[[], RunSummary], *, interval_min: float, once: bool = False,
                sleep: Callable[[float], None] = time.sleep, max_runs: int | None = None) -> int:
    """Call ``run`` every ``interval_min`` minutes (start to start). A failed run never stops the loop."""
    runs = 0
    while True:
        started = time.monotonic()
        try:
            run()
        except Exception:
            log.exception("catalog refresh run failed; will retry next interval")
        runs += 1
        if once or (max_runs is not None and runs >= max_runs):
            return runs
        sleep(max(0.0, interval_min * 60 - (time.monotonic() - started)))
