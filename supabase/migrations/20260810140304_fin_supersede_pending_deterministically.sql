-- Guarantee a charge is never counted twice across the pending -> posted transition.
--
-- When a pending charge posts, Plaid gives it a NEW transaction_id and sends the old one
-- in `removed`. The sync handles that. But the whole guarantee rests on that removal
-- arriving, and if it ever does not -- while the amount also changed, which is exactly
-- what a restaurant tip does -- the two versions carry different fingerprints and the
-- charge appears twice. A duplicate looks like real spending and would be believed.
--
-- Plaid also stamps the posted row with `pending_transaction_id` pointing back at the row
-- it replaces. That is a deterministic link rather than an event that might not come, so
-- it is stored and used to supersede the pending row directly. Belt and braces: either
-- mechanism alone is now sufficient.
alter table fin.plaid_transactions
  add column if not exists pending_transaction_id text;

create index if not exists plaid_transactions_pending_link_idx
  on fin.plaid_transactions (pending_transaction_id)
  where pending_transaction_id is not null;

create or replace function fin.rebuild_plaid_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_takeover date;
  v_count integer;
begin
  select plaid_takeover_date into v_takeover from fin.config where id;
  if v_takeover is null then
    return 0;
  end if;

  create temporary table _derived on commit drop as
  with superseded as (
    -- Pending rows whose posted replacement has already arrived. Excluded even if the
    -- `removed` event never came.
    select distinct pending_transaction_id as transaction_id
    from fin.plaid_transactions
    where pending_transaction_id is not null
  ),
  rows as (
    select
      t.transaction_id,
      a.dashboard_account as account,
      t.txn_date,
      coalesce(nullif(btrim(t.name), ''), nullif(btrim(t.merchant_name), ''), 'Plaid transaction') as description,
      round(case when r.amount_negative_for_spend then -t.amount else t.amount end, 2) as amount,
      round(t.amount, 2) as cost,
      t.merchant_name as counterparty,
      coalesce(nullif(t.category_detailed, ''), t.category_primary) as native_category,
      t.category_detailed, t.category_primary,
      t.pending
    from fin.plaid_transactions t
    join fin.plaid_accounts a on a.account_id = t.account_id
    left join fin.account_roles r on r.account = a.dashboard_account
    where t.txn_date >= v_takeover
      and a.dashboard_account <> ''
      and not exists (select 1 from superseded s where s.transaction_id = t.transaction_id)
  ),
  ranked as (
    select rows.*,
           row_number() over (partition by txn_date, description, amount
                              order by transaction_id) as occurrence
    from rows
  )
  select
    fin.make_tx_id(account, txn_date, description, amount, 'Plaid:' || account,
                   coalesce(counterparty, ''), occurrence::integer) as id,
    account, txn_date, description,
    fin.categorize_plaid(description, native_category, category_detailed, category_primary,
                         account, coalesce(counterparty, '')) as category,
    amount, cost, 'Plaid:' || account as source, native_category,
    coalesce(counterparty, '') as counterparty, occurrence::integer as occurrence,
    transaction_id, pending
  from ranked;

  delete from fin.transactions t
   where t.source like 'Plaid:%'
     and t.txn_date >= v_takeover
     and not exists (select 1 from _derived d where d.id = t.id);

  insert into fin.transactions
    (id, account, txn_date, description, category, amount, cost, type, status, source,
     native_category, counterparty, occurrence, needs_review, plaid_transaction_id,
     pending, updated_at)
  select d.id, d.account, d.txn_date, d.description, d.category, d.amount, d.cost, '',
         case when d.pending then 'pending' else '' end,
         d.source, d.native_category, d.counterparty, d.occurrence,
         d.category in ('uncategorized', 'merchandise'), d.transaction_id,
         d.pending, now()
  from _derived d
  on conflict (id) do update set
    account = excluded.account, description = excluded.description,
    category = excluded.category, amount = excluded.amount, cost = excluded.cost,
    status = excluded.status,
    native_category = excluded.native_category, counterparty = excluded.counterparty,
    occurrence = excluded.occurrence, needs_review = excluded.needs_review,
    plaid_transaction_id = excluded.plaid_transaction_id,
    pending = excluded.pending, updated_at = now();

  select count(*) into v_count from _derived;
  return v_count;
end
$fn$;

-- Answers "is anything missing" directly, rather than by inference. Any non-zero figure
-- here is a real gap between what the banks reported and what the dashboard shows.
create or replace function fin.api_integrity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_takeover date;
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;
  select plaid_takeover_date into v_takeover from fin.config where id;

  return (
    with staged as (
      select t.transaction_id, t.pending as is_pending
      from fin.plaid_transactions t
      join fin.plaid_accounts a on a.account_id = t.account_id
      where t.txn_date >= v_takeover and a.dashboard_account <> ''
        and not exists (
          select 1 from fin.plaid_transactions p
          where p.pending_transaction_id = t.transaction_id)
    )
    select jsonb_build_object(
      'posted_staged',   count(*) filter (where not s.is_pending),
      'posted_missing',  count(*) filter (where not s.is_pending and tx.id is null),
      'pending_staged',  count(*) filter (where s.is_pending),
      'pending_missing', count(*) filter (where s.is_pending and tx.id is null),
      'superseded_pending', (select count(*) from fin.plaid_transactions
                             where pending_transaction_id is not null),
      'duplicate_plaid_ids', (
        select count(*) from (
          select plaid_transaction_id from fin.transactions
          where plaid_transaction_id is not null
          group by plaid_transaction_id having count(*) > 1) d)
    )
    from staged s
    left join fin.transactions tx on tx.plaid_transaction_id = s.transaction_id
  );
end
$fn$;

revoke all on function fin.api_integrity() from public, anon, service_role;
grant execute on function fin.api_integrity() to authenticated;;
