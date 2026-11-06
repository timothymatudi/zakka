"""``python -m zakka_catalog bench --products 1000000``

Generates a synthetic supplier catalogue on the fly (never stored in git or held in
RAM) and runs it through the real pipeline into a local SQLite file store:

1. a full import, streamed in batches with checkpoints;
2. an incremental (delta) run where 1% of items changed, to show that only those
   items flow through.

It reports throughput, peak memory (process peak RSS / working set) and DB size.
Postgres is used only if ``--dsn`` is given; otherwise SQLite is used and the
report says so.
"""

from __future__ import annotations

import ctypes
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

from .bulkstore import SqliteBulkStore
from .jobqueue import SqliteJobQueue
from .pipeline import ImportRun
from .synthetic import SyntheticSupplier


def peak_rss_mb() -> float | None:
    try:
        if sys.platform == "win32":
            class PMC(ctypes.Structure):
                _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                            ("PeakPagefileUsage", ctypes.c_size_t)]
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            k32, psapi = ctypes.WinDLL("kernel32"), ctypes.WinDLL("psapi")
            k32.GetCurrentProcess.restype = ctypes.c_void_p
            psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), ctypes.c_ulong]
            if not psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return None
            return pmc.PeakWorkingSetSize / 1024 / 1024
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / 1024 / (1024 if sys.platform == "darwin" else 1)
    except Exception:
        return None


def run_bench(products: int, *, db: Path, batch_size: int = 1000, changed_pct: float = 1.0,
              keep: bool = False, progress: bool = True, dsn: str | None = None, lite: bool = True) -> dict:
    if dsn:
        from .bulkstore import PostgresBulkStore
        from .jobqueue import PostgresJobQueue

        bulk, queue, backend = PostgresBulkStore(dsn), PostgresJobQueue(dsn), "postgres"
    else:
        for suffix in ("", "-wal", "-shm"):
            for base in (db, db.with_name(db.stem + "-jobs" + db.suffix)):
                p = Path(str(base) + suffix)
                if p.exists():
                    p.unlink()
        db.parent.mkdir(parents=True, exist_ok=True)
        from .bulkstore import LiteBenchStore

        bulk = LiteBenchStore(db) if lite else SqliteBulkStore(db)
        queue = SqliteJobQueue(db.with_name(db.stem + "-jobs" + db.suffix))
        backend = ("sqlite-lite: offer index only, product content/translations processed but not stored"
                   if lite else "sqlite (full rows)") + " - no Postgres DSN given"
    changed_every = max(1, round(100 / changed_pct))
    supplier = SyntheticSupplier(products, changed_every=changed_every)
    last = {"t": time.monotonic(), "n": 0}

    def beat():
        if progress and time.monotonic() - last["t"] > 10:
            done = bulk.offer_count()
            print(f"  ... {done:,} offers stored ({(done - last['n']) / (time.monotonic() - last['t']):,.0f}/s)",
                  flush=True)
            last.update(t=time.monotonic(), n=done)

    t0 = time.monotonic()
    full = ImportRun(bulk, supplier, queue=queue, batch_size=batch_size).run(heartbeat=beat)
    t_full = time.monotonic() - t0

    supplier.generation = 1  # 1% of items change at the supplier
    t1 = time.monotonic()
    delta = ImportRun(bulk, supplier, queue=queue, batch_size=batch_size).run()
    t_delta = time.monotonic() - t1

    size_mb = None
    if not dsn:
        size_mb = sum(Path(str(db) + s).stat().st_size for s in ("", "-wal") if Path(str(db) + s).exists()) / 1e6
    report = {
        "backend": backend, "products": products, "batch_size": batch_size,
        "full": {"seconds": round(t_full, 1), "items_per_s": round(full.stats.scanned / t_full),
                 "pages": full.pages, **asdict(full.stats)},
        "incremental": {"changed_pct": changed_pct, "seconds": round(t_delta, 2),
                        "items_per_s": round(delta.stats.scanned / t_delta) if t_delta else None,
                        "scope": delta.scope, **asdict(delta.stats)},
        "stored": {"offers": bulk.offer_count(),
                   ("product_rows_written" if lite and not dsn else "products"): bulk.product_count(),
                   "tiers": bulk.tier_counts()},
        "jobs": queue.counts(), "peak_memory_mb": round(peak_rss_mb() or 0, 1), "db_size_mb": size_mb and round(size_mb, 1),
    }
    if not keep and not dsn:
        bulk.close()
        queue.close()
        for suffix in ("", "-wal", "-shm"):
            for base in (db, db.with_name(db.stem + "-jobs" + db.suffix)):
                try:
                    os.remove(str(base) + suffix)
                except OSError:
                    pass
    return report
