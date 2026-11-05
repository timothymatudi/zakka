-- 0003: pricing helper, margin reporting, category navigation.
-- Adds only. Nothing from 0001_core.sql is renamed or dropped.

-- ---------------------------------------------------------------------------
-- offer_effective_markup(offer_id)
--
-- Returns the single markup rule that applies to an offer, following the
-- contract: check scopes in the order product > source > category > global,
-- and within the first scope that has an active rule take the highest
-- priority. Ties are broken by id so the answer is deterministic.
--
-- "category" means the product's own category_id (no ancestor inheritance),
-- matching the contract and services/catalog/zakka_catalog/pricing.py.
--
-- Returns zero rows when the offer does not exist or no active rule matches
-- (e.g. no global rule seeded). Callers should treat that as 0% markup.
-- Affiliate offers get a rule back too; the contract says not to apply it,
-- so callers check sources.kind.
-- ---------------------------------------------------------------------------

create or replace function public.offer_effective_markup(p_offer_id uuid)
returns setof public.markup_rules
language sql
stable
set search_path = ''
as $$
  select r.*
  from public.offers o
  join public.products p on p.id = o.product_id
  join public.markup_rules r
    on r.is_active
   and (
         (r.scope = 'product'  and r.scope_id = o.product_id)
      or (r.scope = 'source'   and r.scope_id = o.source_id)
      or (r.scope = 'category' and r.scope_id = p.category_id)
      or (r.scope = 'global')
   )
  where o.id = p_offer_id
  order by
    case r.scope
      when 'product'  then 1
      when 'source'   then 2
      when 'category' then 3
      when 'global'   then 4
    end,
    r.priority desc,
    r.id
  limit 1
$$;

comment on function public.offer_effective_markup(uuid) is
  'Applicable markup rule for an offer: product > source > category > global, then highest priority.';

-- Markup rules are internal: service role only.
revoke all on function public.offer_effective_markup(uuid) from public, anon, authenticated;
grant execute on function public.offer_effective_markup(uuid) to service_role;

-- Convenience view: one row per offer with its effective rule (service role only).
create or replace view public.offer_markups
with (security_invoker = true)
as
  select o.id as offer_id,
         s.kind as source_kind,
         m.id as markup_rule_id,
         m.scope,
         m.scope_id,
         m.percent,
         m.fixed_usd,
         m.round_to,
         m.priority
  from public.offers o
  join public.sources s on s.id = o.source_id
  left join lateral public.offer_effective_markup(o.id) m on true;

comment on view public.offer_markups is
  'Each offer with its effective markup rule (null columns if none). Service role only.';
revoke all on public.offer_markups from public, anon, authenticated;
grant select on public.offer_markups to service_role;

-- ---------------------------------------------------------------------------
-- order_margin: per-order revenue, cost and margin in USD.
--
-- cost_usd prefers what suppliers actually charged (sum of
-- supplier_orders.cost_usd) once any supplier order has a cost; before
-- forwarding it falls back to the sum of order_items.qty * unit_cost_usd.
-- Affiliate-only orders have cost 0 here (their income is commission, which
-- is tracked outside orders).
-- ---------------------------------------------------------------------------

create or replace view public.order_margin
with (security_invoker = true)
as
  select o.id                                    as order_id,
         o.customer_id,
         o.status,
         o.channel,
         o.currency,
         o.total,
         o.total_usd,
         coalesce(i.items_cost_usd, 0)           as items_cost_usd,
         so.supplier_cost_usd,
         coalesce(so.supplier_cost_usd, i.items_cost_usd, 0)               as cost_usd,
         o.total_usd - coalesce(so.supplier_cost_usd, i.items_cost_usd, 0) as margin_usd,
         case when o.total_usd > 0
              then round((o.total_usd - coalesce(so.supplier_cost_usd, i.items_cost_usd, 0))
                         / o.total_usd, 4)
         end                                     as margin_rate,
         o.created_at
  from public.orders o
  left join (
    select order_id, sum(qty * unit_cost_usd) as items_cost_usd
    from public.order_items
    group by order_id
  ) i on i.order_id = o.id
  left join (
    select order_id, sum(cost_usd) as supplier_cost_usd
    from public.supplier_orders
    where cost_usd is not null
    group by order_id
  ) so on so.order_id = o.id;

comment on view public.order_margin is
  'Per order: total_usd, cost_usd (supplier actuals, else item costs), margin_usd, margin_rate. Service role only.';
revoke all on public.order_margin from public, anon, authenticated;
grant select on public.order_margin to service_role;

-- ---------------------------------------------------------------------------
-- top_level_categories: navigation roots, ordered by sort.
-- security_invoker so the categories RLS policy (public read) applies.
-- ---------------------------------------------------------------------------

create or replace view public.top_level_categories
with (security_invoker = true)
as
  select c.id,
         c.slug,
         c.icon,
         c.sort,
         c.shopify_taxonomy_id,
         c.google_category_id,
         (select count(*) from public.categories ch where ch.parent_id = c.id) as child_count
  from public.categories c
  where c.is_top_level
  order by c.sort, c.slug;

comment on view public.top_level_categories is
  'Top-level categories ordered by sort. Join category_translations for names.';
revoke all on public.top_level_categories from public;
grant select on public.top_level_categories to anon, authenticated, service_role;
