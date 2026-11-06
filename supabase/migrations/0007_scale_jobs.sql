-- Scale: refresh tiers on offers, a durable job queue, and per-source sync checkpoints.

alter table offers add column if not exists refresh_tier text not null default 'cold'
  check (refresh_tier in ('hot', 'warm', 'cold'));
alter table offers add column if not exists next_refresh_at timestamptz;
alter table offers add column if not exists content_hash text;

create index if not exists offers_next_refresh_idx on offers (refresh_tier, next_refresh_at) where is_active;

-- Postgres-backed job queue (workers claim with SELECT ... FOR UPDATE SKIP LOCKED).
create table if not exists jobs (
  id            bigserial primary key,
  queue         text not null,
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  priority      smallint not null default 0,
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 5,
  run_after     timestamptz not null default now(),
  locked_by     text,
  locked_at     timestamptz,
  last_error    text,
  dedupe_key    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists jobs_claim_idx on jobs (queue, priority desc, run_after) where status = 'queued';
create unique index if not exists jobs_dedupe_idx on jobs (queue, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

create table if not exists sync_checkpoints (
  source_id   uuid not null references sources(id),
  scope       text not null default 'full',
  cursor      text,
  started_at  timestamptz,
  updated_at  timestamptz not null default now(),
  stats       jsonb not null default '{}'::jsonb,
  primary key (source_id, scope)
);

-- Internal tables: service role only (default grants are revoked; see 0002).
alter table jobs enable row level security;
alter table sync_checkpoints enable row level security;
