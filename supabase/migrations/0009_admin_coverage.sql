-- 0009: worldwide coverage reports for the admin (web app, /admin/coverage).
-- Read-only aggregates over active offers. Service role only: they reveal which partners we use.

create or replace function public.admin_source_coverage()
returns table (
  source_id             uuid,
  code                  text,
  name                  text,
  kind                  text,
  is_active             boolean,
  products              bigint,
  offers                bigint,
  origin_countries      text[],
  destination_countries bigint,
  last_synced_at        timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    s.id,
    s.code,
    s.name,
    s.kind,
    s.is_active,
    count(distinct o.product_id),
    count(o.id),
    coalesce(array_agg(distinct o.ships_from::text order by o.ships_from::text) filter (where o.ships_from is not null), '{}'),
    (select count(distinct d)
       from offers o2, unnest(o2.ships_to) d
      where o2.source_id = s.id and o2.is_active),
    max(o.last_synced_at)
  from sources s
  left join offers o on o.source_id = s.id and o.is_active
  group by s.id
  order by count(o.id) desc, s.code;
$$;

create or replace function public.admin_origin_coverage()
returns table (country_code text, stores bigint, products bigint, offers bigint)
language sql
stable
set search_path = public
as $$
  select o.ships_from::text, count(distinct o.source_id), count(distinct o.product_id), count(*)
  from offers o
  where o.is_active and o.ships_from is not null
  group by o.ships_from
  order by count(*) desc;
$$;

create or replace function public.admin_destination_coverage()
returns table (country_code text, stores bigint, products bigint, fastest_days integer)
language sql
stable
set search_path = public
as $$
  select d, count(distinct o.source_id), count(distinct o.product_id), min(o.delivery_days_min)::integer
  from offers o
  cross join lateral unnest(o.ships_to) d
  where o.is_active
  group by d
  order by count(distinct o.product_id) desc;
$$;

revoke all on function public.admin_source_coverage()      from public, anon, authenticated;
revoke all on function public.admin_origin_coverage()      from public, anon, authenticated;
revoke all on function public.admin_destination_coverage() from public, anon, authenticated;
grant execute on function public.admin_source_coverage()      to service_role;
grant execute on function public.admin_origin_coverage()      to service_role;
grant execute on function public.admin_destination_coverage() to service_role;
