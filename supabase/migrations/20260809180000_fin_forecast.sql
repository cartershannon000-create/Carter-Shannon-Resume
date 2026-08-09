-- Forecast what remains to arrive instead of dividing spend-to-date by a timing
-- fraction. The additive shape cannot explode early in the month and can still forecast
-- a regular bill, such as rent, when that bill is late and current spend is zero.
create or replace function fin.forecast()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with recursive
  params as (
    select
      current_date as today,
      to_char(current_date, 'YYYY-MM') as current_month,
      extract(day from current_date)::integer as today_day,
      extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::integer as month_days
  ),
  days as (
    select generate_series(1, (select month_days from params))::integer as day
  ),
  expense as (
    select category, category_label, txn_date, month, cost
    from fin.v_transactions
    where is_expense
  ),
  category_list as (
    select category, max(category_label) as label
    from expense
    group by category
  ),
  complete_months as (
    select distinct e.month
    from expense e, params p
    where e.month < p.current_month
  ),
  history_daily as (
    select
      c.category,
      m.month,
      d.day,
      coalesce(sum(e.cost), 0) as final_total,
      coalesce(sum(e.cost) filter (
        where extract(day from e.txn_date)::integer <= d.day
      ), 0) as cumulative
    from category_list c
    cross join complete_months m
    cross join days d
    left join expense e on e.category = c.category and e.month = m.month
    group by c.category, m.month, d.day
  ),
  profiles as (
    select
      category,
      day,
      percentile_cont(0.5) within group (
        order by cumulative::double precision / final_total::double precision
      ) as fraction
    from history_daily
    where final_total <> 0
    group by category, day
  ),
  history_at_today as (
    select
      h.category,
      h.month,
      h.final_total,
      h.cumulative as cum_at_d,
      h.final_total - h.cumulative as remaining_at_d,
      exists (
        select 1 from expense e
        where e.category = h.category and e.month = h.month
      ) as has_any_spend
    from history_daily h, params p
    where h.day = p.today_day
  ),
  history_stats as (
    select
      h.category,
      count(*)::integer as months_of_history,
      percentile_cont(0.5) within group (order by h.final_total::double precision) as typical_total,
      greatest(percentile_cont(0.25) within group (order by h.remaining_at_d::double precision), 0) as remaining_25,
      greatest(percentile_cont(0.5) within group (order by h.remaining_at_d::double precision), 0) as remaining_50,
      greatest(percentile_cont(0.75) within group (order by h.remaining_at_d::double precision), 0) as remaining_75,
      (count(*) filter (where h.has_any_spend))::numeric / nullif(count(*), 0) >= 0.8 as regular
    from history_at_today h
    group by h.category
  ),
  current_spend as (
    select
      c.category,
      c.label,
      coalesce(sum(e.cost) filter (
        where e.month = p.current_month and e.txn_date <= p.today
      ), 0) as spent,
      coalesce(max(s.months_of_history), 0)::integer as months_of_history,
      coalesce(max(s.typical_total), 0) as typical_total,
      coalesce(max(s.remaining_25), 0) as remaining_25,
      coalesce(max(s.remaining_50), 0) as remaining_50,
      coalesce(max(s.remaining_75), 0) as remaining_75,
      coalesce(bool_or(s.regular), false) as regular
    from category_list c
    cross join params p
    left join expense e on e.category = c.category
    left join history_stats s on s.category = c.category
    group by c.category, c.label
  ),
  estimate_inputs as (
    select
      c.*,
      case when c.months_of_history >= 3 then 'profile' else 'run_rate' end as basis,
      case when c.regular then greatest(c.typical_total - c.spent, 0) else 0 end as floor_remaining
    from current_spend c
  ),
  estimates_raw as (
    select
      c.*,
      case
        when c.months_of_history >= 3 then
          c.spent + greatest(c.remaining_25, c.floor_remaining * 0.9)
        else c.spent / p.today_day * p.month_days
      end as estimate_25,
      case
        when c.months_of_history >= 3 then
          c.spent + greatest(c.remaining_50, c.floor_remaining)
        else c.spent / p.today_day * p.month_days
      end as estimate_50,
      case
        when c.months_of_history >= 3 then
          c.spent + greatest(c.remaining_75, c.floor_remaining * 1.1)
        else c.spent / p.today_day * p.month_days
      end as estimate_75
    from estimate_inputs c
    cross join params p
  ),
  estimates as (
    select
      category,
      label,
      round(spent, 2) as spent,
      round(least(estimate_25, estimate_50, estimate_75)::numeric, 2) as low,
      round(estimate_50::numeric, 2) as medium,
      round(greatest(estimate_25, estimate_50, estimate_75)::numeric, 2) as high,
      basis,
      months_of_history,
      spent < 0 or estimate_50 < 0 as net_negative
    from estimates_raw
  ),
  actual_daily as (
    select
      c.category,
      d.day,
      case when d.day <= p.today_day then round(coalesce(sum(e.cost) filter (
        where e.month = p.current_month
          and e.txn_date <= p.today
          and extract(day from e.txn_date)::integer <= d.day
      ), 0), 2) end as actual
    from category_list c
    cross join days d
    cross join params p
    left join expense e on e.category = c.category
    group by c.category, d.day, p.today_day
  ),
  progress as (
    select
      e.*,
      d.day,
      case
        when d.day <= p.today_day then 0::double precision
        when e.basis = 'run_rate' then
          case when p.today_day = p.month_days then 1::double precision
               else (d.day - p.today_day)::double precision / (p.month_days - p.today_day) end
        when coalesce(p_end.fraction - p_start.fraction, 0) > 0 then
          greatest(0::double precision, least(1::double precision,
            (p_day.fraction - p_start.fraction) / (p_end.fraction - p_start.fraction)))
        else 1::double precision
      end as completion
    from estimates e
    cross join days d
    cross join params p
    left join profiles p_day on p_day.category = e.category and p_day.day = d.day
    left join profiles p_start on p_start.category = e.category and p_start.day = p.today_day
    left join profiles p_end on p_end.category = e.category and p_end.day = p.month_days
  ),
  projection as (
    select
      x.category,
      x.day,
      a.actual,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + (x.low - x.spent) * x.completion)::numeric, 2)
      end as low,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + (x.medium - x.spent) * x.completion)::numeric, 2)
      end as medium,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + (x.high - x.spent) * x.completion)::numeric, 2)
      end as high
    from progress x
    cross join params p
    join actual_daily a on a.category = x.category and a.day = x.day
  ),
  categories_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'category', e.category,
      'label', e.label,
      'spent', e.spent,
      'low', e.low,
      'medium', e.medium,
      'high', e.high,
      'basis', e.basis,
      'months_of_history', e.months_of_history,
      'net_negative', e.net_negative,
      'cumulative', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', q.day, 'actual', q.actual, 'low', q.low,
          'medium', q.medium, 'high', q.high
        ) order by q.day)
        from projection q where q.category = e.category
      ), '[]'::jsonb)
    ) order by e.spent desc, e.category), '[]'::jsonb) as value
    from estimates e
  ),
  total_values as (
    select
      round(coalesce(sum(spent), 0), 2) as spent,
      round(coalesce(sum(low), 0), 2) as low,
      round(coalesce(sum(medium), 0), 2) as medium,
      round(coalesce(sum(high), 0), 2) as high,
      case when count(*) filter (where basis = 'profile') > 0 then 'profile' else 'run_rate' end as basis
    from estimates
  ),
  total_series as (
    select
      d.day,
      case when d.day <= p.today_day then round(coalesce(sum(q.actual), 0), 2) end as actual,
      case when d.day >= p.today_day then round(coalesce(sum(q.low), 0), 2) end as low,
      case when d.day >= p.today_day then round(coalesce(sum(q.medium), 0), 2) end as medium,
      case when d.day >= p.today_day then round(coalesce(sum(q.high), 0), 2) end as high
    from days d
    cross join params p
    left join projection q on q.day = d.day
    group by d.day, p.today_day
  )
  select jsonb_build_object(
    'month', p.current_month,
    'day_of_month', p.today_day,
    'days_in_month', p.month_days,
    'total', jsonb_build_object(
      'spent', t.spent, 'low', t.low, 'medium', t.medium, 'high', t.high,
      'basis', t.basis
    ),
    'categories', c.value,
    'cumulative', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', day, 'actual', actual, 'low', low, 'medium', medium, 'high', high
      ) order by day) from total_series
    ), '[]'::jsonb)
  )
  from params p, total_values t, categories_json c
$fn$;

-- Keep the owner-gated state endpoint as the only route to the forecast helper.
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
    'forecast', fin.forecast(),
    'accounts', (
      select to_jsonb(array['Overview','Forecast','Monthly','Cash Flow','Analytics','Review']
                      || array(select distinct account from fin.v_transactions order by account))
    )
  );
end
$fn$;

revoke all on function fin.forecast() from public, anon, authenticated, service_role;
revoke all on function fin.api_financial_state() from public, anon, service_role;
grant execute on function fin.api_financial_state() to authenticated;
