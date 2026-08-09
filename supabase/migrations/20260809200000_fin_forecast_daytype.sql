-- Variable spend follows weekday and weekend rates rather than a day-of-month
-- profile. Each monthly rate divides by every calendar day of its type, including
-- zero-spend days, so sparse activity cannot inflate the forecast. Committed charges
-- retain their expected dates and amounts unchanged.
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
      date_trunc('month', current_date)::date as month_start,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date as month_end,
      to_char(current_date, 'YYYY-MM') as current_month,
      extract(day from current_date)::integer as today_day,
      extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::integer as month_days
  ),
  days as (
    select
      day,
      (p.month_start + day - 1)::date as calendar_date,
      extract(isodow from p.month_start + day - 1)::integer in (6, 7) as is_weekend
    from params p
    cross join generate_series(1, p.month_days) as x(day)
  ),
  calendar_counts as (
    select
      count(*) filter (where d.calendar_date > p.today and not d.is_weekend)::integer as weekdays_remaining,
      count(*) filter (where d.calendar_date > p.today and d.is_weekend)::integer as weekend_days_remaining,
      extract(isodow from p.today)::integer in (6, 7) as today_is_weekend
    from days d
    cross join params p
    group by p.today
  ),
  calendar_progress as (
    select
      d.day,
      count(*) filter (
        where x.calendar_date > p.today and x.calendar_date <= d.calendar_date and not x.is_weekend
      )::integer as weekdays_to_day,
      count(*) filter (
        where x.calendar_date > p.today and x.calendar_date <= d.calendar_date and x.is_weekend
      )::integer as weekends_to_day
    from days d
    cross join days x
    cross join params p
    group by d.day
  ),
  expense as (
    select
      category,
      category_label,
      txn_date,
      month,
      cost,
      description,
      counterparty,
      array_to_string((string_to_array(
        trim(regexp_replace(
          regexp_replace(regexp_replace(lower(description), '[^a-z0-9 ]', '', 'g'), '\m[0-9a-z]{5,}\M', '', 'g'),
        '\s+', ' ', 'g')), ' '))[1:3], ' ') as merchant
    from fin.v_transactions
    where is_expense
  ),
  category_list as (
    select category, max(category_label) as label
    from expense
    group by category
  ),
  complete_months as (
    -- The window is six real calendar months, not the last six month keys with a
    -- transaction. An entirely quiet month is still evidence for every daily rate.
    select to_char(x.month_start, 'YYYY-MM') as month
    from params p
    cross join lateral generate_series(
      (p.month_start - interval '6 months')::date,
      (p.month_start - interval '1 month')::date,
      interval '1 month'
    ) as x(month_start)
  ),
  history_month_count as (
    select count(*)::integer as value from complete_months
  ),
  merchant_months as (
    select
      e.merchant,
      e.category,
      e.month,
      sum(e.cost)::double precision as amount,
      percentile_cont(0.5) within group (
        order by extract(day from e.txn_date)::double precision
      ) as expected_day
    from expense e
    join complete_months m on m.month = e.month
    where e.cost > 0 and e.merchant <> ''
    group by e.merchant, e.category, e.month
  ),
  merchant_stats as (
    select
      merchant,
      category,
      count(*)::integer as months_seen,
      percentile_cont(0.5) within group (order by amount) as expected_amount,
      percentile_cont(0.5) within group (order by expected_day) as expected_day,
      stddev_pop(amount) as amount_stddev,
      min(amount) as min_amount,
      max(amount) as max_amount
    from merchant_months
    group by merchant, category
  ),
  merchant_label_source as (
    select
      e.merchant,
      case
        when nullif(btrim(regexp_replace(e.counterparty, '\s+', ' ', 'g')), '') is not null
          then btrim(regexp_replace(e.counterparty, '\s+', ' ', 'g'))
        else left(initcap(btrim(regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(e.description, '\s+', ' ', 'g'),
                '^zelle\s+|\s+on\s+[0-9]{1,2}/[0-9]{1,2}\s+ref\M.*$', '', 'gi'
              ),
              '\m[0-9]{3}[- ][0-9]{3}[- ][0-9]{4}\M', ' ', 'g'
            ),
            '\m(?=[0-9a-z]*[0-9])[0-9a-z]{5,}\M', ' ', 'gi'
          ),
          '(\s+#?[0-9]+)+\s*$', '', 'g'
        ), ' -–—*#:/')), 28)
      end as merchant_label,
      case
        when nullif(btrim(regexp_replace(e.counterparty, '\s+', ' ', 'g')), '') is not null then 1
        else 0
      end as source_priority
    from expense e
    join complete_months m on m.month = e.month
    where e.cost > 0 and e.merchant <> ''
  ),
  merchant_label_counts as (
    select merchant, merchant_label, source_priority, count(*)::integer as frequency
    from merchant_label_source
    where merchant_label <> ''
    group by merchant, merchant_label, source_priority
  ),
  merchant_labels as (
    select distinct on (merchant) merchant, merchant_label
    from merchant_label_counts
    order by merchant, source_priority desc, frequency desc, lower(merchant_label), merchant_label
  ),
  committed_definitions as (
    select
      s.merchant,
      coalesce(l.merchant_label, initcap(s.merchant)) as merchant_label,
      s.category,
      c.label,
      round(s.expected_amount::numeric, 2) as expected_amount,
      least(p.month_days, round(s.expected_day)::integer) as expected_day,
      s.months_seen
    from merchant_stats s
    left join merchant_labels l on l.merchant = s.merchant
    join category_list c on c.category = s.category
    cross join history_month_count h
    cross join params p
    where s.months_seen >= 3
      and s.months_seen::numeric / nullif(h.value, 0) >= 0.6
      and (
        s.max_amount - s.min_amount < 0.005
        or (s.expected_amount > 0 and s.amount_stddev / s.expected_amount <= 0.15)
      )
  ),
  current_committed as (
    select
      d.merchant,
      d.category,
      coalesce(sum(e.cost) filter (
        where e.month = p.current_month and e.txn_date <= p.today
      ), 0) as charged_amount,
      count(e.category) filter (
        where e.month = p.current_month and e.txn_date <= p.today
      ) > 0 as charged
    from committed_definitions d
    cross join params p
    left join expense e on e.merchant = d.merchant and e.category = d.category
    group by d.merchant, d.category
  ),
  committed_items as (
    select
      d.*,
      c.charged_amount,
      case
        when c.charged then 'charged'
        when d.expected_day < p.today_day then 'overdue'
        else 'due'
      end as status
    from committed_definitions d
    join current_committed c using (merchant, category)
    cross join params p
  ),
  committed_category as (
    select
      category,
      coalesce(sum(expected_amount) filter (where status <> 'charged'), 0) as remaining,
      coalesce(sum(charged_amount) filter (where status = 'charged'), 0) as charged_so_far
    from committed_items
    group by category
  ),
  variable_expense as (
    select e.*
    from expense e
    where not exists (
      select 1
      from committed_definitions d
      where d.merchant = e.merchant
    )
  ),
  variable_history_guard as (
    select count(*)::integer as excluded_count
    from expense e
    join complete_months m on m.month = e.month
    where exists (
      select 1
      from committed_definitions d
      where d.merchant = e.merchant
    )
  ),
  history_calendar as (
    select
      c.category,
      m.month,
      x.calendar_date::date as calendar_date,
      extract(isodow from x.calendar_date)::integer in (6, 7) as is_weekend,
      coalesce(sum(e.cost), 0)::double precision as daily_spend
    from category_list c
    cross join complete_months m
    cross join lateral generate_series(
      to_date(m.month || '-01', 'YYYY-MM-DD'),
      (to_date(m.month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
      interval '1 day'
    ) as x(calendar_date)
    left join variable_expense e
      on e.category = c.category and e.txn_date = x.calendar_date::date
    group by c.category, m.month, x.calendar_date
  ),
  monthly_daytype_rates as (
    select
      category,
      month,
      avg(daily_spend) filter (where not is_weekend) as weekday_rate,
      avg(daily_spend) filter (where is_weekend) as weekend_rate,
      sum(daily_spend) as final_total,
      bool_or(daily_spend <> 0) as has_any_spend
    from history_calendar
    group by category, month
  ),
  daytype_stats as (
    select
      category,
      count(*)::integer as months_of_history,
      percentile_cont(0.25) within group (order by weekday_rate) as weekday_25,
      percentile_cont(0.5) within group (order by weekday_rate) as weekday_50,
      percentile_cont(0.75) within group (order by weekday_rate) as weekday_75,
      percentile_cont(0.25) within group (order by weekend_rate) as weekend_25,
      percentile_cont(0.5) within group (order by weekend_rate) as weekend_50,
      percentile_cont(0.75) within group (order by weekend_rate) as weekend_75,
      percentile_cont(0.5) within group (order by final_total) as typical_total,
      (count(*) filter (where has_any_spend))::numeric / nullif(count(*), 0) >= 0.8 as regular
    from monthly_daytype_rates
    group by category
  ),
  category_history_bounds as (
    select category, date_trunc('month', min(txn_date))::date as first_month
    from variable_expense e, params p
    where e.txn_date < p.month_start
    group by category
  ),
  seasonal_monthly as (
    select
      b.category,
      x.month_start::date as month_start,
      coalesce(sum(e.cost), 0)::double precision as month_total
    from category_history_bounds b
    cross join params p
    cross join lateral generate_series(
      b.first_month,
      (p.month_start - interval '1 month')::date,
      interval '1 month'
    ) as x(month_start)
    left join variable_expense e
      on e.category = b.category
      and e.month = to_char(x.month_start, 'YYYY-MM')
    group by b.category, x.month_start
  ),
  seasonal_windows as (
    select
      category,
      month_start,
      month_total,
      count(*) over (partition by category)::integer as history_months,
      count(*) over (
        partition by category order by month_start rows between 11 preceding and current row
      )::integer as trailing_count,
      avg(month_total) over (
        partition by category order by month_start rows between 11 preceding and current row
      ) as trailing_average
    from seasonal_monthly
  ),
  seasonal_stats as (
    select
      sw.category,
      max(sw.history_months)::integer as history_months,
      count(*) filter (
        where extract(month from sw.month_start) = extract(month from p.today)
          and sw.trailing_count = 12 and sw.trailing_average <> 0
      )::integer as observations,
      percentile_cont(0.5) within group (
        order by sw.month_total / nullif(sw.trailing_average, 0)
      ) filter (
        where extract(month from sw.month_start) = extract(month from p.today)
          and sw.trailing_count = 12 and sw.trailing_average <> 0
      ) as raw_factor
    from seasonal_windows sw
    cross join params p
    group by sw.category
  ),
  seasonal as (
    select
      c.category,
      case
        when coalesce(s.history_months, 0) < 12 or coalesce(s.observations, 0) = 0 then 1::double precision
        else least(2::double precision, greatest(0.5::double precision,
          1 + (s.raw_factor - 1) * s.observations::double precision / (s.observations + 1)
        ))
      end as factor,
      case when coalesce(s.history_months, 0) < 12 then 0 else coalesce(s.observations, 0) end as observations
    from category_list c
    left join seasonal_stats s on s.category = c.category
  ),
  all_current as (
    select e.category, coalesce(sum(e.cost), 0) as spent
    from expense e, params p
    where e.month = p.current_month and e.txn_date <= p.today
    group by e.category
  ),
  variable_current as (
    select e.category, coalesce(sum(e.cost), 0) as spent
    from variable_expense e, params p
    where e.month = p.current_month and e.txn_date <= p.today
    group by e.category
  ),
  estimate_inputs as (
    select
      c.category,
      c.label,
      coalesce(a.spent, 0) as spent,
      coalesce(v.spent, 0) as variable_spent,
      coalesce(k.remaining, 0) as committed_remaining,
      coalesce(s.months_of_history, 0)::integer as months_of_history,
      coalesce(s.typical_total, 0) as typical_total,
      coalesce(s.regular, false) as regular,
      -- Seasonality adjusts the future day-type rates themselves. It never scales
      -- spend-to-date, committed charges, or the completed forecast total.
      coalesce(s.weekday_25, 0) * z.factor as weekday_25,
      coalesce(s.weekday_50, 0) * z.factor as weekday_50,
      coalesce(s.weekday_75, 0) * z.factor as weekday_75,
      coalesce(s.weekend_25, 0) * z.factor as weekend_25,
      coalesce(s.weekend_50, 0) * z.factor as weekend_50,
      coalesce(s.weekend_75, 0) * z.factor as weekend_75,
      z.factor as seasonal_factor,
      z.observations as seasonal_months_observed,
      case when coalesce(s.months_of_history, 0) >= 3 then 'profile' else 'run_rate' end as basis
    from category_list c
    left join all_current a on a.category = c.category
    left join variable_current v on v.category = c.category
    left join committed_category k on k.category = c.category
    left join daytype_stats s on s.category = c.category
    join seasonal z on z.category = c.category
  ),
  variable_estimates as (
    -- Summing weekday and weekend percentiles is deliberately conservative: the
    -- remaining dates will not all land at their respective 75th percentiles.
    select
      c.*,
      case
        when c.basis = 'profile' then greatest(
          c.weekday_25 * n.weekdays_remaining + c.weekend_25 * n.weekend_days_remaining,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) * 0.9 else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_25,
      case
        when c.basis = 'profile' then greatest(
          c.weekday_50 * n.weekdays_remaining + c.weekend_50 * n.weekend_days_remaining,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_50,
      case
        when c.basis = 'profile' then greatest(
          c.weekday_75 * n.weekdays_remaining + c.weekend_75 * n.weekend_days_remaining,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) * 1.1 else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_75
    from estimate_inputs c
    cross join params p
    cross join calendar_counts n
  ),
  clamped as (
    select
      v.*,
      least(v.variable_25, v.variable_50, v.variable_75) as variable_low,
      v.variable_50 as variable_medium,
      greatest(v.variable_25, v.variable_50, v.variable_75) as variable_high
    from variable_estimates v
  ),
  estimates as (
    select
      category,
      label,
      round(spent, 2) as spent,
      round((spent + committed_remaining + variable_low)::numeric, 2) as low,
      round((spent + committed_remaining + variable_medium)::numeric, 2) as medium,
      round((spent + committed_remaining + variable_high)::numeric, 2) as high,
      round(committed_remaining, 2) as committed,
      round(variable_low::numeric, 2) as variable_low,
      round(variable_medium::numeric, 2) as variable_medium,
      round(variable_high::numeric, 2) as variable_high,
      round(weekday_50::numeric, 2) as weekday_rate,
      round(weekend_50::numeric, 2) as weekend_rate,
      round(seasonal_factor::numeric, 4) as seasonal_factor,
      seasonal_months_observed,
      weekday_25,
      weekday_50,
      weekday_75,
      weekend_25,
      weekend_50,
      weekend_75,
      basis,
      months_of_history,
      spent < 0 or spent + committed_remaining + variable_medium < 0 as net_negative
    from clamped
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
  committed_progress as (
    select
      c.category,
      d.day,
      coalesce(sum(i.expected_amount) filter (
        where i.status <> 'charged'
          and least(p.month_days, greatest(i.expected_day, p.today_day + 1)) <= d.day
      ), 0) as amount
    from category_list c
    cross join days d
    cross join params p
    left join committed_items i on i.category = c.category
    group by c.category, d.day
  ),
  projection_inputs as (
    select
      e.*,
      d.day,
      g.weekdays_to_day,
      g.weekends_to_day,
      n.weekdays_remaining,
      n.weekend_days_remaining,
      e.weekday_25 * n.weekdays_remaining + e.weekend_25 * n.weekend_days_remaining as raw_25,
      e.weekday_50 * n.weekdays_remaining + e.weekend_50 * n.weekend_days_remaining as raw_50,
      e.weekday_75 * n.weekdays_remaining + e.weekend_75 * n.weekend_days_remaining as raw_75
    from estimates e
    cross join days d
    join calendar_progress g on g.day = d.day
    cross join calendar_counts n
  ),
  projection as (
    select
      x.category,
      x.day,
      a.actual,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount)::numeric, 2)
      end as committed,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + case
          when x.raw_25 <> 0 then
            (x.weekday_25 * x.weekdays_to_day + x.weekend_25 * x.weekends_to_day) * x.variable_low / x.raw_25
          else x.variable_low * (x.weekdays_to_day + x.weekends_to_day)::double precision
            / greatest(x.weekdays_remaining + x.weekend_days_remaining, 1)
        end)::numeric, 2)
      end as low,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + case
          when x.raw_50 <> 0 then
            (x.weekday_50 * x.weekdays_to_day + x.weekend_50 * x.weekends_to_day) * x.variable_medium / x.raw_50
          else x.variable_medium * (x.weekdays_to_day + x.weekends_to_day)::double precision
            / greatest(x.weekdays_remaining + x.weekend_days_remaining, 1)
        end)::numeric, 2)
      end as medium,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + case
          when x.raw_75 <> 0 then
            (x.weekday_75 * x.weekdays_to_day + x.weekend_75 * x.weekends_to_day) * x.variable_high / x.raw_75
          else x.variable_high * (x.weekdays_to_day + x.weekends_to_day)::double precision
            / greatest(x.weekdays_remaining + x.weekend_days_remaining, 1)
        end)::numeric, 2)
      end as high
    from projection_inputs x
    cross join params p
    join actual_daily a on a.category = x.category and a.day = x.day
    join committed_progress k on k.category = x.category and k.day = x.day
  ),
  categories_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'category', e.category,
      'label', e.label,
      'spent', e.spent,
      'low', e.low,
      'medium', e.medium,
      'high', e.high,
      'committed', e.committed,
      'variable_low', e.variable_low,
      'variable_medium', e.variable_medium,
      'variable_high', e.variable_high,
      'weekday_rate', e.weekday_rate,
      'weekend_rate', e.weekend_rate,
      'seasonal_factor', e.seasonal_factor,
      'seasonal_months_observed', e.seasonal_months_observed,
      'basis', e.basis,
      'months_of_history', e.months_of_history,
      'net_negative', e.net_negative,
      'cumulative', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', q.day, 'actual', q.actual, 'committed', q.committed,
          'low', q.low, 'medium', q.medium, 'high', q.high
        ) order by q.day)
        from projection q where q.category = e.category
      ), '[]'::jsonb)
    ) order by e.spent desc, e.category), '[]'::jsonb) as value
    from estimates e
  ),
  committed_json as (
    select jsonb_build_object(
      'remaining', round(coalesce(sum(expected_amount) filter (where status <> 'charged'), 0), 2),
      'charged_so_far', round(coalesce(sum(charged_amount) filter (where status = 'charged'), 0), 2),
      'variable_excluded_from_history', g.excluded_count,
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'merchant', initcap(merchant),
        'merchant_label', merchant_label,
        'category', category,
        'label', label,
        'expected_amount', expected_amount,
        'expected_day', expected_day,
        'months_seen', months_seen,
        'status', status
      ) order by
        case status when 'overdue' then 0 when 'due' then 1 else 2 end,
        expected_day,
        merchant_label
      ) filter (where merchant is not null), '[]'::jsonb)
    ) as value
    from variable_history_guard g
    left join committed_items on true
    group by g.excluded_count
  ),
  total_values as (
    select
      round(coalesce(sum(spent), 0), 2) as spent,
      round(coalesce(sum(low), 0), 2) as low,
      round(coalesce(sum(medium), 0), 2) as medium,
      round(coalesce(sum(high), 0), 2) as high,
      round(coalesce(sum(variable_low), 0), 2) as variable_low,
      round(coalesce(sum(variable_medium), 0), 2) as variable_medium,
      round(coalesce(sum(variable_high), 0), 2) as variable_high,
      case when count(*) filter (where basis = 'profile') > 0 then 'profile' else 'run_rate' end as basis
    from estimates
  ),
  total_series as (
    select
      d.day,
      case when d.day <= p.today_day then round(coalesce(sum(q.actual), 0), 2) end as actual,
      case when d.day >= p.today_day then round(coalesce(sum(q.committed), 0), 2) end as committed,
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
    'calendar', jsonb_build_object(
      'weekdays_remaining', n.weekdays_remaining,
      'weekend_days_remaining', n.weekend_days_remaining,
      'today_is_weekend', n.today_is_weekend
    ),
    'total', jsonb_build_object(
      'spent', t.spent, 'low', t.low, 'medium', t.medium, 'high', t.high,
      'variable_low', t.variable_low, 'variable_medium', t.variable_medium,
      'variable_high', t.variable_high, 'basis', t.basis
    ),
    'committed', j.value,
    'categories', c.value,
    'cumulative', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', day, 'actual', actual, 'committed', committed,
        'low', low, 'medium', medium, 'high', high
      ) order by day) from total_series
    ), '[]'::jsonb)
  )
  from params p, calendar_counts n, total_values t, categories_json c, committed_json j
$fn$;

revoke all on function fin.forecast() from public, anon, authenticated, service_role;
