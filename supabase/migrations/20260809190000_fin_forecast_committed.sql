-- Separate recurring merchant obligations from variable category spend. Committed
-- charges enter every band unchanged, while the additive percentile model sees only
-- variable history so fixed bills cannot widen the forecast or be counted twice.
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
    -- Detection and variable history share this window so a stale alias cannot survive
    -- merchant removal and forecast a second copy of a newly recognised commitment.
    select month
    from (
      select distinct e.month
      from expense e, params p
      where e.month < p.current_month
    ) available
    order by month desc
    limit 6
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
    left join variable_expense e on e.category = c.category and e.month = m.month
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
        select 1 from variable_expense e
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
  all_current as (
    select
      e.category,
      coalesce(sum(e.cost), 0) as spent
    from expense e, params p
    where e.month = p.current_month and e.txn_date <= p.today
    group by e.category
  ),
  variable_current as (
    select
      e.category,
      coalesce(sum(e.cost), 0) as spent
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
      coalesce(s.remaining_25, 0) as remaining_25,
      coalesce(s.remaining_50, 0) as remaining_50,
      coalesce(s.remaining_75, 0) as remaining_75,
      coalesce(s.regular, false) as regular,
      case when coalesce(s.months_of_history, 0) >= 3 then 'profile' else 'run_rate' end as basis
    from category_list c
    left join all_current a on a.category = c.category
    left join variable_current v on v.category = c.category
    left join committed_category k on k.category = c.category
    left join history_stats s on s.category = c.category
  ),
  variable_estimates as (
    select
      c.*,
      case
        when c.basis = 'profile' then greatest(
          c.remaining_25,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) * 0.9 else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_25,
      case
        when c.basis = 'profile' then greatest(
          c.remaining_50,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_50,
      case
        when c.basis = 'profile' then greatest(
          c.remaining_75,
          case when c.regular and c.variable_spent = 0 and c.committed_remaining = 0
            then greatest(c.typical_total - c.variable_spent, 0) * 1.1 else 0 end
        )
        else c.variable_spent / p.today_day * (p.month_days - p.today_day)
      end as variable_75
    from estimate_inputs c
    cross join params p
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
        else round((x.spent + k.amount)::numeric, 2)
      end as committed,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + x.variable_low * x.completion)::numeric, 2)
      end as low,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + x.variable_medium * x.completion)::numeric, 2)
      end as medium,
      case
        when x.day < p.today_day then null
        when x.day = p.today_day then x.spent
        else round((x.spent + k.amount + x.variable_high * x.completion)::numeric, 2)
      end as high
    from progress x
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
  from params p, total_values t, categories_json c, committed_json j
$fn$;
