-- =============================================================================
-- Legacy data review — READ-ONLY. Run in the Supabase SQL editor on the
-- PRODUCTION schema as it is TODAY (before any 2026-09-28… migration), and
-- again any time before step 22 of PORTAL_RELEASE.md.
--
-- It changes nothing (SELECTs only, inside a transaction that ends in
-- ROLLBACK). It answers, from the actual rows, whether the carry-over of the
-- single-sum payment figures (20261002000100) and the Impact backfill
-- (20260929000300) will meet a doubtful case. A row here is a FACT from the
-- data, not a guess; an empty result means there is no such case.
--
-- It uses only columns that exist since 20260816000100, so it runs before the
-- release. The classification is the same as `payment_carry_over()` and
-- `impact_sync_applications()` use.
-- =============================================================================

begin read only;

-- 1. Summary: how many rows fall in each category (0 = none exists).
with fin as (
  select p.id,
         coalesce(p.invoiced_amount, 0) as inv, coalesce(p.paid_amount, 0) as paid, p.value,
         p.payment_state::text as state
  from projects p
  where (p.payment_state::text <> 'not_invoiced' or p.invoiced_amount is not null or p.paid_amount is not null)
), imp as (
  select l.id,
         exists (select 1 from opportunities o where o.lead_id = l.id) as sold
  from leads l
  where l.form_type = 'impact' or (l.form_type is null and l.source = 'impact')
)
select 'finance: projects with a single-sum figure (will be carried over)' as category, count(*) as rows from fin
union all select 'finance: paid amount without a date (always — dates were never recorded)', count(*) from fin where paid > 0
union all select 'finance DOUBTFUL: marked paid, no paid amount', count(*) from fin where state = 'paid' and paid = 0
union all select 'finance DOUBTFUL: marked paid, paid < contract/invoiced', count(*) from fin where state = 'paid' and paid > 0 and paid < coalesce(value, inv)
union all select 'finance DOUBTFUL: partially paid, no paid amount', count(*) from fin where state = 'partially_paid' and paid = 0
union all select 'finance DOUBTFUL: state contradicts the amounts', count(*) from fin
  where (state = 'not_invoiced' and (paid > 0 or inv > 0)) or (state = 'invoiced' and paid > 0)
union all select 'finance DOUBTFUL: paid more than the contract value', count(*) from fin where value is not null and paid > value
union all select 'finance DOUBTFUL: invoiced more than the contract value', count(*) from fin where value is not null and inv > value
union all select 'finance DOUBTFUL: a state but no amount at all (nothing to carry)', count(*) from fin
  where inv = 0 and paid = 0 and coalesce(value, 0) = 0
union all select 'impact: Impact leads (will become applications)', count(*) from imp where not sold
union all select 'impact CONFLICT: Impact lead that already has an opportunity (stays paid)', count(*) from imp where sold
union all select 'impact AMBIGUOUS: not Impact by form, but mentions Impact in free text', count(*) from leads l
  where not (l.form_type = 'impact' or (l.form_type is null and l.source = 'impact'))
    and (coalesce(l.service_interest, '') ilike '%impact%' or coalesce(l.message, '') ilike '%impact%');

-- 2. The doubtful finance rows themselves (empty = none).
select p.id, p.name, p.currency, p.value, p.payment_state::text as payment_state, p.invoiced_amount, p.paid_amount,
       array_remove(array[
         case when p.payment_state::text = 'paid' and coalesce(p.paid_amount, 0) = 0 then 'marked_paid_without_amount' end,
         case when p.payment_state::text = 'paid' and coalesce(p.paid_amount, 0) > 0
                   and p.paid_amount < coalesce(p.value, p.invoiced_amount, 0) then 'marked_paid_amount_short' end,
         case when p.payment_state::text = 'partially_paid' and coalesce(p.paid_amount, 0) = 0 then 'partial_without_amount' end,
         case when (p.payment_state::text = 'not_invoiced' and (coalesce(p.paid_amount, 0) > 0 or coalesce(p.invoiced_amount, 0) > 0))
                or (p.payment_state::text = 'invoiced' and coalesce(p.paid_amount, 0) > 0) then 'state_contradicts_amounts' end,
         case when p.value is not null and coalesce(p.paid_amount, 0) > p.value then 'paid_exceeds_contract' end,
         case when p.value is not null and coalesce(p.invoiced_amount, 0) > p.value then 'invoiced_exceeds_contract' end,
         case when coalesce(p.invoiced_amount, 0) = 0 and coalesce(p.paid_amount, 0) = 0 and coalesce(p.value, 0) = 0
              then 'nothing_to_carry' end
       ], null) as issues
from projects p
where (p.payment_state::text <> 'not_invoiced' or p.invoiced_amount is not null or p.paid_amount is not null)
  and (
    (p.payment_state::text = 'paid' and coalesce(p.paid_amount, 0) < coalesce(p.value, p.invoiced_amount, 1))
    or (p.payment_state::text = 'partially_paid' and coalesce(p.paid_amount, 0) = 0)
    or (p.payment_state::text = 'not_invoiced' and (coalesce(p.paid_amount, 0) > 0 or coalesce(p.invoiced_amount, 0) > 0))
    or (p.payment_state::text = 'invoiced' and coalesce(p.paid_amount, 0) > 0)
    or (p.value is not null and (coalesce(p.paid_amount, 0) > p.value or coalesce(p.invoiced_amount, 0) > p.value))
    or (coalesce(p.invoiced_amount, 0) = 0 and coalesce(p.paid_amount, 0) = 0 and coalesce(p.value, 0) = 0)
  )
order by p.name;

-- 3. Impact conflicts: Impact leads already sold as a paid opportunity (empty = none).
select l.id as lead_id, l.name, l.company, l.created_at, l.status::text as lead_status,
       o.id as opportunity_id, o.title, o.stage::text as stage
from leads l join opportunities o on o.lead_id = l.id
where l.form_type = 'impact' or (l.form_type is null and l.source = 'impact')
order by l.created_at;

rollback;
