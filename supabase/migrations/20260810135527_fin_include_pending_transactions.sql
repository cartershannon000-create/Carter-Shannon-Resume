-- Include pending transactions, marked as such.
--
-- They were excluded by `where not t.pending`, inherited from the CSV era when a pending
-- row was genuinely risky: it can change amount, it can vanish, and when it posts Plaid
-- issues it a NEW transaction_id. Naively appending them would double-count.
--
-- None of that applies here. fin.transactions is DERIVED from the whole staging table on
-- every run rather than appended to, and /transactions/sync reports the pending row as
-- `removed` when its posted twin arrives. So a settle, an amount change, and an
-- abandoned authorisation all propagate on the next rebuild without special handling.
--
-- What remains true is that a pending amount is provisional -- a restaurant tip is the
-- usual case, and an auth plus its reversal both appear. So they are carried with a flag
-- rather than blended silently into settled figures, and the UI marks them.
alter table fin.transactions add column if not exists pending boolean not null default false;

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
  with rows as (
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

-- Appended at the end: CREATE OR REPLACE VIEW cannot insert a column mid-list, and the
-- existing order is depended on by `select v.*` in fin.cashflow().
create or replace view fin.v_transactions as
select
  t.id, t.account, t.txn_date, t.month, t.description,
  coalesce(o.category, t.category) as category,
  coalesce(cl.label, initcap(replace(coalesce(o.category, t.category), '_', ' '))) as category_label,
  t.amount, t.cost, t.type, t.status, t.source, t.native_category, t.counterparty,
  t.occurrence,
  (t.needs_review or coalesce(o.category, t.category) in ('uncategorized', 'merchandise')) as needs_review,
  cc.class,
  (cc.class is null) as is_expense,
  case when cc.class is null then t.cost else 0 end as spend_cost,
  case when cc.class = 'income' then greatest(-t.cost, 0) else 0 end as income_amount,
  case when cc.class = 'savings' then greatest(t.cost, 0) else 0 end as savings_amount,
  t.pending
from fin.transactions t
left join fin.category_overrides o on o.tx_id = t.id
left join fin.category_labels cl on cl.category = coalesce(o.category, t.category)
left join fin.category_classes cc on cc.category = coalesce(o.category, t.category);

revoke all on table fin.v_transactions from public, anon, authenticated, service_role;
revoke all on table fin.transactions from public, anon, authenticated, service_role;

select fin.rebuild_plaid_transactions();;
