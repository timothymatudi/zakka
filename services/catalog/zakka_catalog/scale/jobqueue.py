"""Durable job queue with workers, retries and a dead-letter state.

Table ``jobs`` (migration 0007). Status flow:
``queued -> running -> done``; on error ``-> queued`` again with exponential
backoff (``run_after``) until ``max_attempts``, then ``dead`` (dead-letter, kept for
inspection/replay). Non-retryable errors go to ``dead`` at once.

* ``PostgresJobQueue``: claims with ``SELECT ... FOR UPDATE SKIP LOCKED`` so any
  number of workers on any number of machines can share the table.
* ``SqliteJobQueue``: same semantics for local/bench/tests (claims inside an
  IMMEDIATE transaction, so concurrent workers on one file never double-claim).
* ``RedisJobQueue``: placeholder showing the adapter seam; not implemented.

Jobs whose worker died (``running`` with an old ``locked_at``) are re-queued by
``requeue_stale``. Long jobs call ``heartbeat`` to keep their lease.
"""

from __future__ import annotations

import json
import logging
import socket
import sqlite3
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

log = logging.getLogger(__name__)

DEFAULT_QUEUE = "catalog"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class NonRetryable(Exception):
    """Raise from a handler to dead-letter a job immediately."""


@dataclass
class Job:
    id: int
    queue: str
    kind: str
    payload: dict
    attempts: int
    max_attempts: int


class JobQueue(ABC):
    backoff_base = timedelta(seconds=30)
    backoff_max = timedelta(hours=1)
    lease = timedelta(minutes=15)

    @abstractmethod
    def enqueue(self, kind: str, payload: dict | None = None, *, queue: str = DEFAULT_QUEUE, priority: int = 0,
                dedupe_key: str | None = None, run_after: datetime | None = None, max_attempts: int = 5) -> int | None:
        """Returns the job id, or None if an identical (dedupe_key) job is already queued/running."""

    @abstractmethod
    def claim(self, worker: str, *, queue: str = DEFAULT_QUEUE, kinds: tuple[str, ...] | None = None,
              limit: int = 1) -> list[Job]: ...

    @abstractmethod
    def complete(self, job: Job) -> None: ...

    @abstractmethod
    def fail(self, job: Job, error: str, *, retry: bool = True) -> str:
        """Returns the new status: 'queued' (will retry) or 'dead'."""

    @abstractmethod
    def heartbeat(self, job: Job) -> None: ...

    @abstractmethod
    def requeue_stale(self, older_than: timedelta | None = None) -> int: ...

    @abstractmethod
    def counts(self, queue: str = DEFAULT_QUEUE) -> dict[str, int]: ...

    def backoff(self, attempts: int) -> timedelta:
        return min(self.backoff_base * (2 ** max(attempts - 1, 0)), self.backoff_max)


# --------------------------------------------------------------------------------------------
class SqliteJobQueue(JobQueue):
    SCHEMA = """
    create table if not exists jobs (id integer primary key autoincrement, queue text not null, kind text not null,
      payload text not null default '{}', status text not null default 'queued', priority integer not null default 0,
      attempts integer not null default 0, max_attempts integer not null default 5, run_after text not null,
      locked_by text, locked_at text, last_error text, dedupe_key text, created_at text not null,
      updated_at text not null);
    create index if not exists jobs_claim on jobs (queue, status, priority, run_after);
    create unique index if not exists jobs_dedupe on jobs (queue, dedupe_key)
      where dedupe_key is not null and status in ('queued', 'running');
    """

    def __init__(self, path: str | Path = ":memory:"):
        self.path = str(path)
        self._local = threading.local()
        self._shared = None
        if self.path == ":memory:":  # one shared connection (tests); serialised by a lock
            self._shared = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
            self._lock = threading.Lock()
        self._conn().executescript(self.SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        if self._shared is not None:
            return self._shared
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, isolation_level=None, check_same_thread=False)
            c.execute("pragma journal_mode = wal")
            c.execute("pragma busy_timeout = 30000")
            self._local.conn = c
        return c

    def _tx(self, fn: Callable[[sqlite3.Connection], Any]) -> Any:
        lock = getattr(self, "_lock", None)
        if lock:
            lock.acquire()
        try:
            c = self._conn()
            c.execute("begin immediate")
            try:
                out = fn(c)
                c.execute("commit")
                return out
            except BaseException:
                c.execute("rollback")
                raise
        finally:
            if lock:
                lock.release()

    @staticmethod
    def _ts(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")

    def enqueue(self, kind, payload=None, *, queue=DEFAULT_QUEUE, priority=0, dedupe_key=None, run_after=None,
                max_attempts=5):
        now = self._ts(utcnow())

        def go(c):
            try:
                cur = c.execute(
                    "insert into jobs (queue, kind, payload, priority, max_attempts, run_after, dedupe_key, "
                    "created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (queue, kind, json.dumps(payload or {}, default=str), priority, max_attempts,
                     self._ts(run_after or utcnow()), dedupe_key, now, now))
                return cur.lastrowid
            except sqlite3.IntegrityError:
                return None
        return self._tx(go)

    def claim(self, worker, *, queue=DEFAULT_QUEUE, kinds=None, limit=1):
        now = self._ts(utcnow())

        def go(c):
            sql = ("select id from jobs where queue = ? and status = 'queued' and run_after <= ?"
                   + (f" and kind in ({','.join('?' * len(kinds))})" if kinds else "")
                   + " order by priority desc, run_after, id limit ?")
            ids = [r[0] for r in c.execute(sql, (queue, now, *(kinds or ()), limit))]
            jobs = []
            for jid in ids:
                row = c.execute("update jobs set status = 'running', locked_by = ?, locked_at = ?, "
                                "attempts = attempts + 1, updated_at = ? where id = ? and status = 'queued' "
                                "returning id, queue, kind, payload, attempts, max_attempts",
                                (worker, now, now, jid)).fetchone()
                if row:
                    jobs.append(Job(row[0], row[1], row[2], json.loads(row[3]), row[4], row[5]))
            return jobs
        return self._tx(go)

    def complete(self, job):
        now = self._ts(utcnow())
        self._tx(lambda c: c.execute("update jobs set status = 'done', locked_by = null, updated_at = ?, "
                                     "last_error = null where id = ?", (now, job.id)))

    def fail(self, job, error, *, retry=True):
        dead = not retry or job.attempts >= job.max_attempts
        now = utcnow()
        status = "dead" if dead else "queued"
        self._tx(lambda c: c.execute(
            "update jobs set status = ?, locked_by = null, run_after = ?, last_error = ?, updated_at = ? where id = ?",
            (status, self._ts(now + (timedelta(0) if dead else self.backoff(job.attempts))), error[:2000],
             self._ts(now), job.id)))
        return status

    def heartbeat(self, job):
        now = self._ts(utcnow())
        self._tx(lambda c: c.execute("update jobs set locked_at = ?, updated_at = ? where id = ?", (now, now, job.id)))

    def requeue_stale(self, older_than=None):
        cutoff = self._ts(utcnow() - (self.lease if older_than is None else older_than))
        return self._tx(lambda c: c.execute(
            "update jobs set status = 'queued', locked_by = null where status = 'running' and locked_at <= ?",
            (cutoff,)).rowcount)

    def counts(self, queue=DEFAULT_QUEUE):
        rows = self._tx(lambda c: c.execute("select status, count(*) from jobs where queue = ? group by status",
                                            (queue,)).fetchall())
        return {s: n for s, n in rows}

    def close(self) -> None:
        c = self._shared or getattr(self._local, "conn", None)
        if c is not None:
            c.close()
        self._local = threading.local()

    def dead_jobs(self, queue=DEFAULT_QUEUE) -> list[dict]:
        rows = self._tx(lambda c: c.execute("select id, kind, payload, attempts, last_error from jobs "
                                            "where queue = ? and status = 'dead' order by id", (queue,)).fetchall())
        return [{"id": r[0], "kind": r[1], "payload": json.loads(r[2]), "attempts": r[3], "last_error": r[4]}
                for r in rows]


# --------------------------------------------------------------------------------------------
class PostgresJobQueue(JobQueue):
    """Shares the jobs table across machines. One connection per thread."""

    def __init__(self, dsn: str):
        self.dsn = dsn
        self._local = threading.local()

    def _conn(self):
        c = getattr(self._local, "conn", None)
        if c is None or c.closed:
            import psycopg
            from psycopg.rows import dict_row

            c = psycopg.connect(self.dsn, autocommit=False, row_factory=dict_row, connect_timeout=5)
            self._local.conn = c
        return c

    def _run(self, sql: str, params: Any = ()) -> list[dict]:
        c = self._conn()
        try:
            with c.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall() if cur.description else []
            c.commit()
            return rows
        except BaseException:
            c.rollback()
            raise

    def enqueue(self, kind, payload=None, *, queue=DEFAULT_QUEUE, priority=0, dedupe_key=None, run_after=None,
                max_attempts=5):
        from psycopg.types.json import Jsonb

        rows = self._run(
            "insert into jobs (queue, kind, payload, priority, max_attempts, run_after, dedupe_key) "
            "values (%s, %s, %s, %s, %s, coalesce(%s, now()), %s) "
            "on conflict (queue, dedupe_key) where dedupe_key is not null and status in ('queued', 'running') "
            "do nothing returning id",
            (queue, kind, Jsonb(json.loads(json.dumps(payload or {}, default=str))), priority, max_attempts,
             run_after, dedupe_key))
        return rows[0]["id"] if rows else None

    def claim(self, worker, *, queue=DEFAULT_QUEUE, kinds=None, limit=1):
        rows = self._run(
            "with next as (select id from jobs where queue = %s and status = 'queued' and run_after <= now() "
            "  and (%s::text[] is null or kind = any(%s::text[])) "
            "  order by priority desc, run_after, id limit %s for update skip locked) "
            "update jobs j set status = 'running', locked_by = %s, locked_at = now(), attempts = j.attempts + 1, "
            "updated_at = now() from next where j.id = next.id "
            "returning j.id, j.queue, j.kind, j.payload, j.attempts, j.max_attempts",
            (queue, list(kinds) if kinds else None, list(kinds) if kinds else None, limit, worker))
        return [Job(r["id"], r["queue"], r["kind"], dict(r["payload"]), r["attempts"], r["max_attempts"])
                for r in rows]

    def complete(self, job):
        self._run("update jobs set status = 'done', locked_by = null, last_error = null, updated_at = now() "
                  "where id = %s", (job.id,))

    def fail(self, job, error, *, retry=True):
        dead = not retry or job.attempts >= job.max_attempts
        delay = timedelta(0) if dead else self.backoff(job.attempts)
        self._run("update jobs set status = %s, locked_by = null, run_after = now() + %s, last_error = %s, "
                  "updated_at = now() where id = %s", ("dead" if dead else "queued", delay, error[:2000], job.id))
        return "dead" if dead else "queued"

    def heartbeat(self, job):
        self._run("update jobs set locked_at = now(), updated_at = now() where id = %s", (job.id,))

    def requeue_stale(self, older_than=None):
        rows = self._run("update jobs set status = 'queued', locked_by = null where status = 'running' "
                         "and locked_at < now() - %s returning id", (self.lease if older_than is None else older_than,))
        return len(rows)

    def counts(self, queue=DEFAULT_QUEUE):
        return {r["status"]: r["n"] for r in self._run(
            "select status, count(*) as n from jobs where queue = %s group by status", (queue,))}


class RedisJobQueue(JobQueue):  # pragma: no cover - adapter seam only
    """Swap-in point for Redis (e.g. streams + consumer groups, XAUTOCLAIM for stale jobs).
    Not implemented: the Postgres queue needs no new infrastructure."""

    def __init__(self, *_, **__):
        raise NotImplementedError("RedisJobQueue is a placeholder; use PostgresJobQueue")

    enqueue = claim = complete = fail = heartbeat = requeue_stale = counts = None  # type: ignore[assignment]


# --------------------------------------------------------------------------------------------
Handler = Callable[[Job, Callable[[], None]], Any]  # (job, heartbeat) -> anything


@dataclass
class WorkerStats:
    done: int = 0
    retried: int = 0
    dead: int = 0


class Worker:
    def __init__(self, queue: JobQueue, handlers: Mapping[str, Handler], *, name: str | None = None,
                 queue_name: str = DEFAULT_QUEUE, non_retryable: tuple[type[BaseException], ...] = (NonRetryable,)):
        self.queue = queue
        self.handlers = dict(handlers)
        self.name = name or f"{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
        self.queue_name = queue_name
        self.non_retryable = non_retryable
        self.stats = WorkerStats()

    def run_one(self) -> bool:
        jobs = self.queue.claim(self.name, queue=self.queue_name, kinds=tuple(self.handlers), limit=1)
        if not jobs:
            return False
        job = jobs[0]
        try:
            self.handlers[job.kind](job, lambda: self.queue.heartbeat(job))
            self.queue.complete(job)
            self.stats.done += 1
        except Exception as exc:
            retry = not isinstance(exc, self.non_retryable)
            status = self.queue.fail(job, f"{type(exc).__name__}: {exc}", retry=retry)
            if status == "dead":
                self.stats.dead += 1
                log.error("job %s (%s) dead-lettered after %d attempt(s): %s", job.id, job.kind, job.attempts, exc)
            else:
                self.stats.retried += 1
                log.warning("job %s (%s) failed, will retry: %s", job.id, job.kind, exc)
        return True

    def drain(self, max_jobs: int | None = None) -> WorkerStats:
        n = 0
        while (max_jobs is None or n < max_jobs) and self.run_one():
            n += 1
        return self.stats

    def run_forever(self, poll_seconds: float = 2.0, stop: threading.Event | None = None) -> None:  # pragma: no cover
        stop = stop or threading.Event()
        while not stop.is_set():
            try:
                if not self.run_one():
                    stop.wait(poll_seconds)
            except Exception:
                log.exception("worker loop error")
                stop.wait(poll_seconds)


def drain_parallel(make_worker: Callable[[int], Worker], threads: int, max_jobs: int | None = None) -> WorkerStats:
    """Run ``threads`` workers until the queue has nothing runnable."""
    total = WorkerStats()
    workers = [make_worker(i) for i in range(threads)]
    ts = [threading.Thread(target=w.drain, kwargs={"max_jobs": max_jobs}, daemon=True) for w in workers]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    for w in workers:
        total.done += w.stats.done
        total.retried += w.stats.retried
        total.dead += w.stats.dead
    return total

