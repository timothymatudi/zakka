-- 0004: category markup rules inherit down the category tree (lead decision).
--
-- Precedence: product > source > category (nearest ancestor with an active
-- rule: own category first, then parent, grandparent, ...) > global.
-- Within the winning level the highest priority wins; ties broken by id.
-- Replaces the body of offer_effective_markup from 0003 (same signature),
-- so the offer_markups view picks it up unchanged.

create or replace function public.offer_effective_markup(p_offer_id uuid)
returns setof public.markup_rules
language sql
stable
set search_path = ''
as $$
  with recursive target as (
    select o.product_id, o.source_id, p.category_id
    from public.offers o
    join public.products p on p.id = o.product_id
    where o.id = p_offer_id
  ),
  ancestors (category_id, depth) as (
    select t.category_id, 0
    from target t
    where t.category_id is not null
    union all
    select c.parent_id, a.depth + 1
    from ancestors a
    join public.categories c on c.id = a.category_id
    where c.parent_id is not null
      and a.depth < 50                      -- guard against accidental cycles
  ),
  candidates as (
    select r.*, 1 as tier, 0 as depth
    from public.markup_rules r, target t
    where r.is_active and r.scope = 'product' and r.scope_id = t.product_id
    union all
    select r.*, 2, 0
    from public.markup_rules r, target t
    where r.is_active and r.scope = 'source' and r.scope_id = t.source_id
    union all
    select r.*, 3, a.depth
    from public.markup_rules r
    join ancestors a on r.scope_id = a.category_id
    where r.is_active and r.scope = 'category'
    union all
    select r.*, 4, 0
    from public.markup_rules r
    where r.is_active and r.scope = 'global'
      and exists (select 1 from target)
  )
  select id, scope, scope_id, percent, fixed_usd, round_to, priority, is_active
  from candidates
  order by tier, depth, priority desc, id
  limit 1
$$;

comment on function public.offer_effective_markup(uuid) is
  'Applicable markup rule for an offer: product > source > nearest-ancestor category > global, then highest priority.';

revoke all on function public.offer_effective_markup(uuid) from public, anon, authenticated;
grant execute on function public.offer_effective_markup(uuid) to service_role;
