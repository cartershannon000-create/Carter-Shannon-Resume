-- Read path for the financials dashboard: the aggregation that build_payload() used to
-- do in Python, moved into the database so a Review-tab override immediately moves the
-- summary, the cash-flow bridge, and the insights without a local rebuild.
--
-- Split into helpers rather than one function so the Python-vs-SQL parity harness can
-- diff each block on its own. The helpers are not SECURITY DEFINER and are granted to
-- nobody -- they are reachable only from fin.api_financial_state(), which does the
-- owner check once at the top.

-- Money formatting used in insight prose. Mirrors Python's f"${v:,.0f}".
create or replace function fin.money0(v numeric)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select '$' || to_char(round(coalesce(v, 0)), 'FM999,999,999,990')
$fn$;

-- Every transaction with its EFFECTIVE category resolved.
--
-- A Review override replaces the category for all downstream maths but never
-- overwrites what the rules inferred, so the original stays recoverable. needs_review
-- is derived here rather than stored, because an override should clear it.
create or replace view fin.v_transactions as
select
  t.id,
  t.account,
  t.txn_date,
  t.month,
  t.description,
  coalesce(o.category, t.category) as category,
  coalesce(cl.label, initcap(replace(coalesce(o.category, t.category), '_', ' '))) as category_label,
  t.amount,
  t.cost,
  t.type,
  t.status,
  t.source,
  t.native_category,
  t.counterparty,
  t.occurrence,
  (t.needs_review or coalesce(o.category, t.category) in ('uncategorized', 'merchandise')) as needs_review,
  cc.class,
  (cc.class is null) as is_expense,
  case when cc.class is null then t.cost else 0 end as spend_cost,
  case when cc.class = 'income' then greatest(-t.cost, 0) else 0 end as income_amount,
  case when cc.class = 'savings' then greatest(t.cost, 0) else 0 end as savings_amount
from fin.transactions t
left join fin.category_overrides o on o.tx_id = t.id
left join fin.category_labels cl on cl.category = coalesce(o.category, t.category)
left join fin.category_classes cc on cc.category = coalesce(o.category, t.category);

-- Months that are complete enough to average over: everything before the latest month,
-- since the latest is still accruing. Falls back to all months when only one exists.
create or replace function fin.complete_months()
returns text[]
language sql
stable
set search_path = ''
as $fn$
  with m as (select distinct month from fin.v_transactions),
  latest as (select max(month) as latest from m)
  select coalesce(
    nullif(array(select month from m, latest where m.month < latest.latest order by month), '{}'),
    array(select month from m order by month)
  )
$fn$;

-- ---------------------------------------------------------------------------
-- Summary (was build_summary)
-- ---------------------------------------------------------------------------
create or replace function fin.summary()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with complete as (select fin.complete_months() as arr),
  recent as (
    select arr[greatest(array_length(arr, 1) - 2, 1):array_length(arr, 1)] as arr
    from complete
  ),
  by_month as (
    select
      month,
      round(sum(income_amount), 2) as income,
      round(sum(spend_cost), 2) as expenses,
      round(sum(cost) filter (where category = 'rent'), 2) as rent,
      round(sum(savings_amount), 2) as savings,
      count(*) as transactions
    from fin.v_transactions
    group by month
  ),
  -- Largest expense category per month. Python's max() breaks ties by first insertion;
  -- category name is used here so the result is deterministic instead.
  top_cat as (
    select distinct on (month) month, category_label, round(total, 2) as total
    from (
      select month, category_label, sum(cost) as total
      from fin.v_transactions
      where is_expense
      group by month, category_label
    ) s
    order by month, total desc, category_label
  ),
  months_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', b.month,
      'income', b.income,
      'expenses', b.expenses,
      'rent', coalesce(b.rent, 0),
      'savings', b.savings,
      'net_after_spend_and_savings', round(b.income - b.expenses - b.savings, 2),
      'transactions', b.transactions,
      'top_category', coalesce(t.category_label, ''),
      'top_category_amount', coalesce(t.total, 0)
    ) order by b.month), '[]'::jsonb) as j
    from by_month b left join top_cat t on t.month = b.month
  ),
  categories_json as (
    select coalesce(jsonb_agg(x order by x.expense desc, x.category), '[]'::jsonb) as j
    from (
      select
        category,
        max(category_label) as label,
        count(*) as count,
        round(sum(spend_cost), 2) as expense,
        round(sum(income_amount), 2) as income,
        round(sum(savings_amount), 2) as savings
      from fin.v_transactions group by category
    ) x
  ),
  overall as (
    select
      coalesce(to_char(min(txn_date), 'YYYY-MM-DD'), '') as first_date,
      coalesce(to_char(max(txn_date), 'YYYY-MM-DD'), '') as last_date,
      count(*) as transaction_count,
      round(coalesce(sum(income_amount), 0), 2) as income,
      round(coalesce(sum(spend_cost), 0), 2) as expenses,
      round(coalesce(sum(savings_amount), 0), 2) as savings,
      round(coalesce(sum(cost) filter (where category = 'rent'), 0), 2) as rent,
      count(distinct account) as account_count
    from fin.v_transactions
  ),
  averages as (
    select
      round(coalesce((select avg(expenses) from by_month, complete
                      where by_month.month = any(complete.arr)), 0), 2) as avg_expense,
      round(coalesce((select avg(expenses) from by_month, recent
                      where by_month.month = any(recent.arr)), 0), 2) as recent_avg_expense
  )
  select jsonb_build_object(
    'overall', jsonb_build_object(
      'first_date', o.first_date,
      'last_date', o.last_date,
      'transaction_count', o.transaction_count,
      'income', o.income,
      'expenses', o.expenses,
      'savings', o.savings,
      'rent', o.rent,
      'account_count', o.account_count,
      'net_after_spend_and_savings', round(o.income - o.expenses - o.savings, 2),
      'monthly_average_expense', a.avg_expense,
      'recent_monthly_average_expense', a.recent_avg_expense
    ),
    'months', (select j from months_json),
    'accounts', (
      select coalesce(jsonb_agg(y order by y.account), '[]'::jsonb) from (
        select account, count(*) as count,
               to_char(min(txn_date), 'YYYY-MM-DD') as first,
               to_char(max(txn_date), 'YYYY-MM-DD') as last,
               round(sum(spend_cost), 2) as expense,
               round(sum(income_amount), 2) as income,
               round(sum(savings_amount), 2) as savings
        from fin.v_transactions group by account
      ) y
    ),
    'categories', (select j from categories_json),
    'recent_basis', to_jsonb((select arr from recent))
  )
  from overall o, averages a
$fn$;

-- ---------------------------------------------------------------------------
-- Cash flow (was build_cashflow)
--
-- Spend and cash are different questions and they disagree every month: spend is
-- booked when a card is charged, cash moves when that card bill is paid, often a month
-- later. The bridge reconciles the two exactly, so a month where the P&L looks fine but
-- the balance dropped has an itemised reason rather than looking like an error.
--
-- The balance is a stock with no recorded values, so it is derived by walking flows
-- outward from the single hand-verified anchor in fin.config -- forward by adding each
-- later month's delta, backward by subtracting each following month's. Both directions
-- collapse into one cumulative window: closing(m) = anchor + cum(m) - cum(anchor).
-- ---------------------------------------------------------------------------
create or replace function fin.cashflow()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with cfg as (select * from fin.config where id),
  anchor as (select to_char(anchor_as_of, 'YYYY-MM') as anchor_month, anchor_balance, anchor_account from cfg),
  months as (select distinct month from fin.v_transactions),
  cash as (
    select v.* from fin.v_transactions v
    join fin.account_roles r on r.account = v.account and r.role = 'cash'
  ),
  flows as (
    select
      m.month,
      round(coalesce(sum(c.amount), 0), 2) as delta,
      round(coalesce(sum(c.amount) filter (where c.class = 'income'), 0), 2) as salary_in,
      round(coalesce(sum(c.amount) filter (where c.category = 'payment'), 0), 2) as card_pmts,
      round(coalesce(sum(c.amount) filter (where c.category = 'rent'), 0), 2) as rent_out,
      round(coalesce(sum(c.amount) filter (where c.class = 'savings'), 0), 2) as invest_out,
      round(coalesce(sum(c.amount) filter (where c.class = 'transfer' and c.category <> 'payment'), 0), 2) as transfers_in
    from months m left join cash c on c.month = m.month
    group by m.month
  ),
  -- Accrual side, measured across every account, not just checking.
  accrual as (
    select
      m.month,
      round(coalesce(sum(v.income_amount), 0), 2) as income,
      round(coalesce(sum(v.spend_cost), 0), 2) as spend,
      -- Spend charged somewhere other than checking has not touched cash yet.
      round(coalesce(sum(v.spend_cost) filter (where r.role is distinct from 'cash'), 0), 2) as deferred,
      round(coalesce(sum(v.spend_cost) filter (where r.role = 'card'), 0), 2) as charged
    from months m
    left join fin.v_transactions v on v.month = m.month
    left join fin.account_roles r on r.account = v.account
    group by m.month
  ),
  walked as (
    select
      f.*,
      sum(f.delta) over (order by f.month rows between unbounded preceding and current row) as cum
    from flows f
  ),
  anchored as (
    select w.*,
      (select cum from walked w2, anchor a where w2.month = a.anchor_month) as cum_at_anchor
    from walked w
  ),
  rows_out as (
    select
      an.month,
      case when an.cum_at_anchor is not null
           then round((select anchor_balance from anchor) + an.cum - an.cum_at_anchor, 2) end as closing,
      an.delta, an.salary_in, an.card_pmts, an.rent_out, an.invest_out, an.transfers_in,
      ac.income, ac.spend, ac.deferred, ac.charged,
      round(an.delta - an.salary_in - an.card_pmts - an.rent_out - an.invest_out - an.transfers_in, 2) as other_cash,
      round(ac.income - ac.spend, 2) as net_income
    from anchored an join accrual ac on ac.month = an.month
  ),
  final as (
    select
      r.*,
      round(r.closing - r.delta, 2) as opening,
      round(-r.card_pmts, 2) as paid,
      round(r.charged - (-r.card_pmts), 2) as float_change,
      round(r.delta - (round(r.income - r.spend, 2) + r.deferred + r.card_pmts + r.invest_out + r.transfers_in), 2) as bridge_residual
    from rows_out r
  ),
  -- Card float: charged but not yet paid. Only the CHANGE is trustworthy -- the opening
  -- float is unknown -- so it is reported as a running total since the start.
  cumulative as (
    select f.*,
      round(sum(f.float_change) over (order by f.month rows between unbounded preceding and current row), 2) as float_cumulative
    from final f
  )
  select jsonb_build_object(
    'anchor', jsonb_build_object(
      'account', (select anchor_account from anchor),
      'as_of', to_char((select anchor_as_of from cfg), 'YYYY-MM-DD'),
      'balance', (select round(anchor_balance, 2) from anchor),
      'month', (select anchor_month from anchor)
    ),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', month,
        'opening', opening,
        'closing', closing,
        'delta', delta,
        'salary_in', salary_in,
        'transfers_in', transfers_in,
        'card_payments', card_pmts,
        'rent', rent_out,
        'investments', invest_out,
        'other_cash', other_cash,
        'net_income', net_income,
        'income', income,
        'spend', spend,
        'deferred_spend', deferred,
        'bridge_residual', bridge_residual,
        'charged_to_cards', charged,
        'paid_to_cards', paid,
        'float_change', float_change,
        'float_cumulative', float_cumulative
      ) order by month) from cumulative
    ), '[]'::jsonb)
  )
$fn$;

revoke all on function fin.money0(numeric) from public, anon, authenticated, service_role;
revoke all on function fin.complete_months() from public, anon, authenticated, service_role;
revoke all on function fin.summary() from public, anon, authenticated, service_role;
revoke all on function fin.cashflow() from public, anon, authenticated, service_role;
revoke all on table fin.v_transactions from public, anon, authenticated, service_role;
