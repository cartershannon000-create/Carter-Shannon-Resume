-- Keep the Monthly tab live after the budget workbook's final column.  The backfill
-- stored Python-computed extension months as well as the workbook itself, so those
-- extension values must not remain the read source: Review overrides are resolved in
-- fin.v_transactions and need to affect Monthly on the next request.

create table if not exists fin.compensation (
  effective_from text primary key,
  annual_salary numeric(14,2) not null,
  k401_monthly numeric(14,2) not null,
  ira_monthly numeric(14,2) not null
);

insert into fin.compensation (effective_from, annual_salary, k401_monthly, ira_monthly)
values
  ('2025-01', 85000.00, 779.17, 141.67),
  ('2025-07', 90600.00, 830.50, 151.00)
on conflict (effective_from) do update set
  annual_salary = excluded.annual_salary,
  k401_monthly = excluded.k401_monthly,
  ira_monthly = excluded.ira_monthly;

alter table fin.compensation enable row level security;
revoke all on table fin.compensation from public, anon, authenticated, service_role;

create or replace function fin.monthly_summary()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with
  stored_rows as (
    select
      row_order,
      max(label) as label,
      max(style) as style,
      max(kind) as kind
    from fin.monthly_summary_rows
    group by row_order
  ),
  stored_months as (
    select distinct month
    from fin.monthly_summary_rows
    where month <> ''
  ),
  stored_extent as (
    select min(month) as first_month
    from stored_months
  ),
  event_extent as (
    select min(msr.month) as first_month
    from fin.monthly_summary_rows msr
    where msr.label = 'event' and msr.month <> ''
  ),
  -- extend_monthly_summary_with_actuals() added `event` immediately after the
  -- workbook was parsed.  Consequently its first stored value marks the first
  -- Python-generated month.  If event spans storage from the beginning, it was a
  -- workbook row instead and all stored months remain workbook months.
  workbook_cutoff as (
    select case
      when e.first_month > s.first_month then e.first_month
      else null
    end as first_live_month
    from stored_extent s cross join event_extent e
  ),
  workbook_months as (
    select sm.month
    from stored_months sm cross join workbook_cutoff c
    where c.first_live_month is null or sm.month < c.first_live_month
  ),
  transaction_months as (
    select distinct month from fin.v_transactions
  ),
  live_months as (
    select tm.month
    from transaction_months tm
    where not exists (
      select 1 from workbook_months wm where wm.month = tm.month
    )
  ),
  months as (
    select month from workbook_months
    union
    select month from transaction_months
  ),
  row_frame as (
    select
      sr.row_order,
      sr.row_order::numeric as sort_order,
      sr.label,
      sr.style,
      sr.kind
    from stored_rows sr

    union all

    select
      null::integer as row_order,
      coalesce(
        (select sr.row_order::numeric - 0.5
         from stored_rows sr
         where sr.label = 'Total'
         order by sr.row_order
         limit 1),
        (select coalesce(max(sr.row_order), -1)::numeric + 1 from stored_rows sr)
      ) as sort_order,
      'event'::text as label,
      'normal'::text as style,
      'money'::text as kind
    where not exists (select 1 from stored_rows where label = 'event')
      and exists (select 1 from live_months)
  ),
  category_costs as (
    select month, category, round(sum(cost), 2) as cost
    from fin.v_transactions
    group by month, category
  ),
  month_actuals_base as (
    select
      m.month,
      round(coalesce(sum(v.cost) filter (
        where v.is_expense and v.category <> 'rent'
      ), 0), 2) as total,
      round(-coalesce(sum(v.cost) filter (where v.category = 'rent'), 0), 2) as rent,
      round(-coalesce(sum(v.cost) filter (where v.category = 'salary'), 0), 2) as salary
    from months m
    left join fin.v_transactions v on v.month = m.month
    group by m.month
  ),
  month_actuals as (
    select
      a.month,
      a.total,
      a.rent,
      a.salary,
      round(a.salary - a.total + a.rent, 2) as net_income
    from month_actuals_base a
  ),
  month_compensation as (
    select
      m.month,
      c.annual_salary,
      c.k401_monthly,
      c.ira_monthly,
      round(c.k401_monthly + c.ira_monthly, 2) as total_inv
    from months m
    left join lateral (
      select annual_salary, k401_monthly, ira_monthly
      from fin.compensation
      where effective_from <= m.month
      order by effective_from desc
      limit 1
    ) c on true
  ),
  raw_cells as (
    select
      r.sort_order,
      r.label,
      r.style,
      r.kind,
      m.month,
      case
        when wm.month is not null then stored.value
        when r.style = 'spacer-row' then null
        when r.label = 'Total' then a.total
        when r.label = 'Rent' then a.rent
        when r.label = 'Salary' then a.salary
        when r.label = 'Net Income' then a.net_income
        when r.label = 'Margin' then
          case when a.salary <> 0 then round(a.net_income / a.salary, 6) else 0 end
        when r.label = '401k' then c.k401_monthly
        when r.label = 'IRA' then c.ira_monthly
        when r.label = 'Additional Savings' then 0
        when r.label = 'Total Inv Savings' then c.total_inv
        when r.label = 'Total Savings' then round(a.net_income + c.total_inv, 2)
        when r.label = '' and r.kind = 'integer' then c.annual_salary
        else coalesce(cc.cost, 0)
      end as value
    from row_frame r
    cross join months m
    left join workbook_months wm on wm.month = m.month
    left join fin.monthly_summary_rows stored
      on stored.row_order = r.row_order and stored.month = m.month
    left join category_costs cc
      on cc.month = m.month and cc.category = lower(r.label)
    left join month_actuals a on a.month = m.month
    left join month_compensation c on c.month = m.month
  ),
  salary_reconciliation_base as (
    select
      rc.month,
      bool_or(rc.label = 'Salary') as has_salary_row,
      max(a.salary) as actual_salary,
      max(rc.value) filter (where rc.label = 'Salary') as stored_salary,
      max(rc.value) filter (where rc.label = 'Total') as total,
      max(rc.value) filter (where rc.label = 'Rent') as rent,
      max(rc.value) filter (where rc.label = 'Total Inv Savings') as total_inv
    from raw_cells rc
    join month_actuals a on a.month = rc.month
    group by rc.month
  ),
  salary_reconciliation as (
    select
      s.*,
      s.has_salary_row
        and abs(s.actual_salary - round(coalesce(s.stored_salary, 0), 2)) > 0.02 as changed,
      round(s.actual_salary - coalesce(s.total, 0) + coalesce(s.rent, 0), 2) as net_income
    from salary_reconciliation_base s
  ),
  final_cells as (
    select
      rc.sort_order,
      rc.label,
      rc.style,
      rc.kind,
      rc.month,
      case
        when not s.changed then rc.value
        when rc.label = 'Salary' then s.actual_salary
        when rc.label = 'Net Income' then s.net_income
        when rc.label = 'Margin' then
          case when s.actual_salary <> 0 then round(s.net_income / s.actual_salary, 6) else 0 end
        when rc.label = 'Total Savings' then round(s.net_income + coalesce(s.total_inv, 0), 2)
        else rc.value
      end as value
    from raw_cells rc
    join salary_reconciliation s on s.month = rc.month
  )
  select jsonb_build_object(
    'months', to_jsonb(array(select month from months order by month)),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', r.label,
        'style', r.style,
        'kind', r.kind,
        'values', coalesce((
          select jsonb_object_agg(fc.month, fc.value order by fc.month)
          from final_cells fc
          where fc.sort_order = r.sort_order and fc.value is not null
        ), '{}'::jsonb)
      ) order by r.sort_order)
      from row_frame r
    ), '[]'::jsonb)
  )
$fn$;

revoke all on function fin.monthly_summary() from public, anon, authenticated, service_role;
