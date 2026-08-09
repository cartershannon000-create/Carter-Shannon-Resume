-- ---------------------------------------------------------------------------
-- Insights (was build_insights)
-- ---------------------------------------------------------------------------
create or replace function fin.insights()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with cats as (
    select category, max(category_label) as label, count(*) as tx_count,
           round(sum(spend_cost), 2) as expense
    from fin.v_transactions group by category
  ),
  variable as (
    select * from cats where category <> 'rent' and expense > 0
    order by expense desc, category
  ),
  -- Here `complete` excludes the latest month with no single-month fallback, matching
  -- the Python: with one month of data the trend block is skipped entirely.
  months as (select distinct month from fin.v_transactions),
  complete as (
    select array(select month from months where month < (select max(month) from months) order by month) as arr
  ),
  recent as (select arr[greatest(array_length(arr,1)-2,1):array_length(arr,1)] as arr from complete where array_length(arr,1) > 0),
  prior as (select arr[1:greatest(array_length(arr,1)-3,0)] as arr from complete where array_length(arr,1) > 3),
  -- Unnested so the trend averages can flag membership with a join. `= any(subquery)`
  -- would parse as the subquery form of ANY and try to compare text to text[].
  recent_months as (select unnest(arr) as month from recent),
  prior_months as (select unnest(arr) as month from prior),
  -- Every (category, month) pair, including months where the category had no activity.
  -- Those must count as zero in the averages below, exactly as Python's
  -- category_month_spend() returned 0.0 -- averaging only the months that happen to
  -- have rows would inflate every trend.
  cat_month as (
    select c.category, m.month, coalesce(s.spend, 0) as spend
    from variable c
    cross join months m
    left join (
      select category, month, sum(cost) as spend
      from fin.v_transactions where is_expense group by category, month
    ) s on s.category = c.category and s.month = m.month
  ),
  watch as (
    select jsonb_build_object(
      'title', 'Watch ' || label,
      'detail', label || ' is ' || fin.money0(expense) || ' across the loaded period across ' || tx_count || ' transactions.',
      'action', 'Review the largest merchants in this category before setting next month''s budget.',
      'tone', 'neutral'
    ) as j, row_number() over (order by expense desc, category) as ord
    from variable order by expense desc, category limit 5
  ),
  trend as (
    select
      c.label,
      avg(case when rm.month is not null then cm.spend end) as recent_avg,
      avg(case when pm.month is not null then cm.spend end) as prior_avg
    from variable c
    join cat_month cm on cm.category = c.category
    left join recent_months rm on rm.month = cm.month
    left join prior_months pm on pm.month = cm.month
    where exists (select 1 from prior_months)
    group by c.label
  ),
  rising as (
    select jsonb_build_object(
      'title', label || ' is trending up',
      'detail', 'The recent monthly average is ' || fin.money0(recent_avg)
                || ', up ' || fin.money0(recent_avg - prior_avg)
                || ' from the earlier average of ' || fin.money0(prior_avg) || '.',
      'action', 'Set a category cap or inspect repeat merchants for this category.',
      'tone', 'warning'
    ) as j, row_number() over (order by (recent_avg - prior_avg) desc, label desc) as ord
    from trend
    where prior_avg > 50 and recent_avg > prior_avg * 1.25
    order by (recent_avg - prior_avg) desc, label desc
    limit 3
  ),
  -- Recurring-charge detection. Strips punctuation, drops any 5+ character alphanumeric
  -- token (order ids, reference numbers), then keys on the first three words plus the
  -- rounded amount, so the same subscription lands in one group month after month.
  merchants as (
    select
      array_to_string((string_to_array(
        trim(regexp_replace(
          regexp_replace(regexp_replace(lower(description), '[^a-z0-9 ]', '', 'g'), '\m[0-9a-z]{5,}\M', '', 'g'),
        '\s+', ' ', 'g')), ' '))[1:3], ' ') as merchant,
      round(cost) as rounded_cost,
      month
    from fin.v_transactions
    where is_expense and cost > 0
  ),
  grouped as (
    select merchant, rounded_cost, count(*) as n, count(distinct month) as months_seen
    from merchants where merchant <> ''
    group by merchant, rounded_cost
  ),
  recurring as (
    select jsonb_build_object(
      'title', 'Recurring charge: ' || initcap(merchant),
      'detail', 'Appears in ' || months_seen || ' months at roughly ' || fin.money0(rounded_cost) || '.',
      'action', 'Keep it only if it is still intentional; otherwise cancel or downgrade it.',
      'tone', 'opportunity'
    ) as j, row_number() over (order by months_seen desc, rounded_cost desc, initcap(merchant) desc) as ord
    from grouped
    where n >= 3 and months_seen >= 3 and rounded_cost >= 3
    order by months_seen desc, rounded_cost desc, initcap(merchant) desc
    limit 5
  ),
  totals as (
    select
      round(coalesce(sum(cost) filter (where category = 'bet' and is_expense), 0), 2) as betting,
      round(coalesce(sum(cost) filter (where category in ('service','spotify') and is_expense), 0), 2) as service
    from fin.v_transactions
  ),
  tail as (
    select jsonb_build_object(
      'title', 'Betting spend is visible',
      'detail', 'Loaded betting-related spend nets to ' || fin.money0(betting) || '.',
      'action', 'Use a hard monthly limit because this category can move quickly and does not compound value.',
      'tone', 'warning'
    ) as j, 1 as ord from totals where betting > 0
    union all
    select jsonb_build_object(
      'title', 'Audit services and subscriptions',
      'detail', 'Services and subscriptions total ' || fin.money0(service) || ' in the loaded data.',
      'action', 'Cancel unused software, media, and marketplace subscriptions; this is the easiest recurring reduction area.',
      'tone', 'opportunity'
    ) as j, 2 as ord from totals where service > 0
  ),
  ordered as (
    select j, 1 as block, ord from watch
    union all select j, 2, ord from rising
    union all select j, 3, ord from recurring
    union all select j, 4, ord from tail
  )
  select coalesce((
    select jsonb_agg(z.j order by z.block, z.ord) from (
      select j, block, ord from ordered order by block, ord limit 12
    ) z
  ), '[]'::jsonb)
$fn$;

-- Budget workbook rows, served as stored.
--
-- NOT yet at parity: Python re-ran extend_monthly_summary_with_actuals() and
-- reconcile_salary_rows() on every build, so the Salary row (and the Net Income,
-- Margin, and Total Savings rows derived from it) tracked actual salary transactions.
-- Here the stored values are served as the importer last wrote them, which means a
-- Review override that moves a transaction into or out of `salary` will not move these
-- rows until the importer runs again. Porting that reconciliation is tracked separately.
create or replace function fin.monthly_summary()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'months', coalesce((select to_jsonb(array(select distinct month from fin.monthly_summary_rows order by month))), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', label, 'style', style, 'kind', kind, 'values', coalesce(vals, '{}'::jsonb)
      ) order by row_order)
      from (
        select row_order, max(label) as label, max(style) as style, max(kind) as kind,
               jsonb_object_agg(month, value) filter (where value is not null) as vals
        from fin.monthly_summary_rows group by row_order
      ) r
    ), '[]'::jsonb)
  )
$fn$;

-- ---------------------------------------------------------------------------
-- The one public entry point.
-- ---------------------------------------------------------------------------
create or replace function fin.api_financial_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;

  v_summary := fin.summary();

  return jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD HH24:MI'),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'account', account, 'date', to_char(txn_date, 'YYYY-MM-DD'),
        'month', month, 'description', description, 'category', category,
        'category_label', category_label, 'amount', amount, 'cost', cost,
        'type', type, 'status', status, 'source', source,
        'native_category', native_category, 'counterparty', counterparty,
        'needs_review', case when needs_review then 1 else 0 end,
        'occurrence', occurrence
      ) order by txn_date desc, account desc, description desc)
      from fin.v_transactions
    ), '[]'::jsonb),
    'summary', fin.summary(),
    'workbook_monthly', fin.monthly_summary(),
    'insights', fin.insights(),
    'cashflow', fin.cashflow(),
    'accounts', (
      select to_jsonb(array['Overview','Monthly','Cash Flow','Analytics','Review']
                      || array(select distinct account from fin.v_transactions order by account))
    )
  );
end
$fn$;

-- Review-tab write-back.
create or replace function fin.api_set_category(p_tx_id text, p_category text, p_note text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from fin.transactions where id = p_tx_id) then
    return jsonb_build_object('ok', false, 'error', 'unknown transaction');
  end if;

  if coalesce(trim(p_category), '') = '' then
    delete from fin.category_overrides where tx_id = p_tx_id;
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;

  insert into fin.category_overrides (tx_id, category, note, updated_at)
  values (p_tx_id, lower(trim(p_category)), coalesce(p_note, ''), now())
  on conflict (tx_id) do update
    set category = excluded.category, note = excluded.note, updated_at = now();

  return jsonb_build_object('ok', true, 'category', lower(trim(p_category)));
end
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: only the two api_ functions are reachable, and only by an authenticated
-- session that passes cos.is_owner(). Helpers and the view stay unreachable.
-- ---------------------------------------------------------------------------
revoke all on function fin.insights() from public, anon, authenticated, service_role;
revoke all on function fin.monthly_summary() from public, anon, authenticated, service_role;

revoke all on function fin.api_financial_state() from public, anon, service_role;
revoke all on function fin.api_set_category(text, text, text) from public, anon, service_role;
grant execute on function fin.api_financial_state() to authenticated;
grant execute on function fin.api_set_category(text, text, text) to authenticated;
