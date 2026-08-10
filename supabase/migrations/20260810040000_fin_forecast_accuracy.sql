-- Keep the Addendum 4 calculation byte-for-byte intact as the uncorrected model. The
-- public stable function below adds scoring and bounded corrections without allowing a
-- read path to write snapshots. pg_get_functiondef is used here so this migration cannot
-- drift from the immediately preceding model while copying its large SQL body.
do $copy_base$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef('fin.forecast()'::regprocedure)
  into v_definition;

  v_definition := pg_catalog.regexp_replace(
    v_definition,
    '^CREATE OR REPLACE FUNCTION fin[.]forecast[(][)]',
    'CREATE OR REPLACE FUNCTION fin.forecast_daytype_1_base()'
  );

  if pg_catalog.strpos(v_definition, 'fin.forecast_daytype_1_base()') = 0 then
    raise exception 'could not preserve the Addendum 4 fin.forecast() implementation';
  end if;

  execute v_definition;
end
$copy_base$;

revoke all on function fin.forecast_daytype_1_base()
from public, anon, authenticated, service_role;

create table fin.forecast_snapshots (
  month text not null,
  day_of_month integer not null,
  category text not null,
  model_version text not null,
  spent numeric(14,2) not null,
  committed numeric(14,2) not null,
  low numeric(14,2) not null,
  medium numeric(14,2) not null,
  high numeric(14,2) not null,
  taken_at timestamptz not null default pg_catalog.now(),
  primary key (month, day_of_month, category, model_version)
);

alter table fin.forecast_snapshots enable row level security;
revoke all on table fin.forecast_snapshots from public, anon, authenticated;

-- Score only closed months. Predictions are grouped by their model version and by the
-- point in the month at which they were made; an early-month estimate must not be mixed
-- with one made after most of the month was already observed.
create or replace function fin.forecast_accuracy()
returns table (
  model_version text,
  category text,
  day_bucket text,
  sample_count bigint,
  months integer,
  median_pct_error numeric,
  in_band_rate numeric
)
language sql
stable
set search_path = ''
as $fn$
  with actual_by_category as (
    select
      e.month,
      e.category,
      pg_catalog.round(pg_catalog.sum(e.cost)::numeric, 2) as actual
    from fin.v_transactions e
    where e.is_expense
      and e.month < pg_catalog.to_char(current_date, 'YYYY-MM')
    group by e.month, e.category
  ),
  actuals as (
    select month, category, actual from actual_by_category
    union all
    select month, ''::text, pg_catalog.round(pg_catalog.sum(actual), 2)
    from actual_by_category
    group by month
  ),
  scored as (
    select
      s.model_version,
      s.month,
      s.category,
      case
        when s.day_of_month <= 10 then '1-10'
        when s.day_of_month <= 20 then '11-20'
        else '21-end'
      end as day_bucket,
      (a.actual - s.medium) / nullif(pg_catalog.abs(a.actual), 0) as pct_error,
      a.actual between s.low and s.high as in_band
    from fin.forecast_snapshots s
    join actuals a using (month, category)
    where s.month < pg_catalog.to_char(current_date, 'YYYY-MM')
  )
  select
    s.model_version,
    s.category,
    s.day_bucket,
    pg_catalog.count(*) as sample_count,
    pg_catalog.count(distinct s.month)::integer as months,
    (percentile_cont(0.5) within group (order by s.pct_error::double precision)
      filter (where s.pct_error is not null))::numeric as median_pct_error,
    pg_catalog.avg(case when s.in_band then 1::numeric else 0::numeric end) as in_band_rate
  from scored s
  group by s.model_version, s.category, s.day_bucket
$fn$;

revoke all on function fin.forecast_accuracy()
from public, anon, authenticated, service_role;

-- Apply accuracy as a pure JSON transformation over Addendum 4. With fewer than two
-- closed months the original category values and cumulative paths are left untouched;
-- only the new traceability payload is appended.
create or replace function fin.forecast()
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  c_model_version constant text := 'daytype-1';
  v_forecast jsonb := fin.forecast_daytype_1_base();
  v_categories jsonb := '[]'::jsonb;
  v_category jsonb;
  v_series jsonb;
  v_point jsonb;
  v_total jsonb;
  v_total_series jsonb := '[]'::jsonb;
  v_last_month jsonb;
  v_bucket text;
  v_category_name text;
  v_months integer;
  v_total_months integer;
  v_sample_count bigint;
  v_median_error numeric;
  v_coverage numeric;
  v_total_error numeric;
  v_total_coverage numeric;
  v_bias numeric;
  v_band_scale numeric;
  v_shrink numeric;
  v_variable_low numeric;
  v_variable_medium numeric;
  v_variable_high numeric;
  v_corrected_low numeric;
  v_corrected_medium numeric;
  v_corrected_high numeric;
  v_spent numeric;
  v_committed numeric;
  v_point_committed numeric;
  v_point_low numeric;
  v_point_medium numeric;
  v_point_high numeric;
  v_day integer;
  v_today_day integer := (v_forecast->>'day_of_month')::integer;
  v_days_in_month integer := (v_forecast->>'days_in_month')::integer;
  v_any_correction boolean := false;
begin
  v_bucket := case
    when v_today_day <= 10 then '1-10'
    when v_today_day <= 20 then '11-20'
    else '21-end'
  end;

  select a.months, a.median_pct_error, a.in_band_rate
  into v_total_months, v_total_error, v_total_coverage
  from fin.forecast_accuracy() a
  where a.model_version = c_model_version
    and a.category = ''
    and a.day_bucket = v_bucket;

  v_total_months := coalesce(v_total_months, 0);

  for v_category in
    select value from pg_catalog.jsonb_array_elements(v_forecast->'categories')
  loop
    v_category_name := v_category->>'category';

    select a.sample_count, a.months, a.median_pct_error, a.in_band_rate
    into v_sample_count, v_months, v_median_error, v_coverage
    from fin.forecast_accuracy() a
    where a.model_version = c_model_version
      and a.category = v_category_name
      and a.day_bucket = v_bucket;

    v_sample_count := coalesce(v_sample_count, 0);
    v_months := coalesce(v_months, 0);
    v_median_error := coalesce(v_median_error, 0);

    if v_months < 2 then
      v_bias := 1.0;
      v_band_scale := 1.0;
    else
      v_shrink := v_months::numeric / (v_months + 3);
      v_bias := least(1.4, greatest(0.7,
        1 + v_median_error * v_shrink));
      v_band_scale := least(1.8, greatest(0.6,
        pg_catalog.sqrt(0.5 / greatest(coalesce(v_coverage, 0), 0.1))));
      v_any_correction := true;
    end if;

    v_category := pg_catalog.jsonb_set(v_category, '{accuracy}', pg_catalog.jsonb_build_object(
      'median_pct_error', case when v_sample_count = 0 then null else v_median_error end,
      'in_band_rate', v_coverage,
      'bias_factor', v_bias,
      'band_scale', v_band_scale,
      'months', v_months,
      'sample_count', v_sample_count,
      'day_bucket', v_bucket
    ));

    if v_months >= 2 then
      v_variable_low := (v_category->>'variable_low')::numeric;
      v_variable_medium := (v_category->>'variable_medium')::numeric;
      v_variable_high := (v_category->>'variable_high')::numeric;
      v_spent := (v_category->>'spent')::numeric;
      v_committed := (v_category->>'committed')::numeric;

      v_corrected_medium := v_variable_medium * v_bias;
      v_corrected_low := v_corrected_medium - (v_variable_medium - v_variable_low) * v_band_scale;
      v_corrected_high := v_corrected_medium + (v_variable_high - v_variable_medium) * v_band_scale;

      -- Keep the centre fixed while retaining the public low <= medium <= high contract.
      v_corrected_low := least(v_corrected_low, v_corrected_medium);
      v_corrected_high := greatest(v_corrected_high, v_corrected_medium);

      v_category := pg_catalog.jsonb_set(v_category, '{variable_low}',
        pg_catalog.to_jsonb(pg_catalog.round(v_corrected_low, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{variable_medium}',
        pg_catalog.to_jsonb(pg_catalog.round(v_corrected_medium, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{variable_high}',
        pg_catalog.to_jsonb(pg_catalog.round(v_corrected_high, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{low}',
        pg_catalog.to_jsonb(pg_catalog.round(v_spent + v_committed + v_corrected_low, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{medium}',
        pg_catalog.to_jsonb(pg_catalog.round(v_spent + v_committed + v_corrected_medium, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{high}',
        pg_catalog.to_jsonb(pg_catalog.round(v_spent + v_committed + v_corrected_high, 2)));
      v_category := pg_catalog.jsonb_set(v_category, '{net_negative}',
        pg_catalog.to_jsonb(v_spent < 0 or v_spent + v_committed + v_corrected_medium < 0));

      v_series := '[]'::jsonb;
      for v_point in
        select value from pg_catalog.jsonb_array_elements(v_category->'cumulative')
      loop
        if (v_point->>'day')::integer > v_today_day then
          v_point_committed := (v_point->>'committed')::numeric;
          v_point_low := (v_point->>'low')::numeric - v_point_committed;
          v_point_medium := (v_point->>'medium')::numeric - v_point_committed;
          v_point_high := (v_point->>'high')::numeric - v_point_committed;
          v_corrected_medium := v_point_medium * v_bias;
          v_corrected_low := v_corrected_medium - (v_point_medium - v_point_low) * v_band_scale;
          v_corrected_high := v_corrected_medium + (v_point_high - v_point_medium) * v_band_scale;
          v_point := pg_catalog.jsonb_set(v_point, '{low}',
            pg_catalog.to_jsonb(pg_catalog.round(v_point_committed + least(v_corrected_low, v_corrected_medium), 2)));
          v_point := pg_catalog.jsonb_set(v_point, '{medium}',
            pg_catalog.to_jsonb(pg_catalog.round(v_point_committed + v_corrected_medium, 2)));
          v_point := pg_catalog.jsonb_set(v_point, '{high}',
            pg_catalog.to_jsonb(pg_catalog.round(v_point_committed + greatest(v_corrected_high, v_corrected_medium), 2)));
        end if;
        v_series := v_series || pg_catalog.jsonb_build_array(v_point);
      end loop;
      v_category := pg_catalog.jsonb_set(v_category, '{cumulative}', v_series);
    end if;

    v_categories := v_categories || pg_catalog.jsonb_build_array(v_category);
  end loop;

  v_forecast := pg_catalog.jsonb_set(v_forecast, '{categories}', v_categories);

  if v_any_correction then
    select pg_catalog.jsonb_build_object(
      'spent', pg_catalog.round(pg_catalog.sum((c.value->>'spent')::numeric), 2),
      'low', pg_catalog.round(pg_catalog.sum((c.value->>'low')::numeric), 2),
      'medium', pg_catalog.round(pg_catalog.sum((c.value->>'medium')::numeric), 2),
      'high', pg_catalog.round(pg_catalog.sum((c.value->>'high')::numeric), 2),
      'variable_low', pg_catalog.round(pg_catalog.sum((c.value->>'variable_low')::numeric), 2),
      'variable_medium', pg_catalog.round(pg_catalog.sum((c.value->>'variable_medium')::numeric), 2),
      'variable_high', pg_catalog.round(pg_catalog.sum((c.value->>'variable_high')::numeric), 2),
      'basis', v_forecast->'total'->>'basis'
    )
    into v_total
    from pg_catalog.jsonb_array_elements(v_categories) c;
    v_forecast := pg_catalog.jsonb_set(v_forecast, '{total}', v_total);

    for v_day in 1..v_days_in_month loop
      select pg_catalog.jsonb_build_object(
        'day', v_day,
        'actual', case when v_day <= v_today_day then
          pg_catalog.round(pg_catalog.sum((p.value->>'actual')::numeric), 2) end,
        'committed', case when v_day >= v_today_day then
          pg_catalog.round(pg_catalog.sum((p.value->>'committed')::numeric), 2) end,
        'low', case when v_day >= v_today_day then
          pg_catalog.round(pg_catalog.sum((p.value->>'low')::numeric), 2) end,
        'medium', case when v_day >= v_today_day then
          pg_catalog.round(pg_catalog.sum((p.value->>'medium')::numeric), 2) end,
        'high', case when v_day >= v_today_day then
          pg_catalog.round(pg_catalog.sum((p.value->>'high')::numeric), 2) end
      )
      into v_point
      from pg_catalog.jsonb_array_elements(v_categories) c
      cross join lateral pg_catalog.jsonb_array_elements(c.value->'cumulative') p
      where (p.value->>'day')::integer = v_day;
      v_total_series := v_total_series || pg_catalog.jsonb_build_array(v_point);
    end loop;
    v_forecast := pg_catalog.jsonb_set(v_forecast, '{cumulative}', v_total_series);
  end if;

  select pg_catalog.jsonb_build_object(
    'month', s.month,
    'predicted_medium', s.medium,
    'actual', a.actual,
    'pct_error', (a.actual - s.medium) / nullif(pg_catalog.abs(a.actual), 0),
    'in_band', a.actual between s.low and s.high
  )
  into v_last_month
  from fin.forecast_snapshots s
  cross join lateral (
    select pg_catalog.round(coalesce(pg_catalog.sum(e.cost), 0)::numeric, 2) as actual
    from fin.v_transactions e
    where e.is_expense and e.month = s.month
  ) a
  where s.model_version = c_model_version
    and s.category = ''
    and s.month < pg_catalog.to_char(current_date, 'YYYY-MM')
  order by s.month desc, s.day_of_month desc
  limit 1;

  v_forecast := pg_catalog.jsonb_set(v_forecast, '{accuracy}', pg_catalog.jsonb_build_object(
    'model_version', c_model_version,
    'months_scored', v_total_months,
    'total', pg_catalog.jsonb_build_object(
      'median_pct_error', v_total_error,
      'in_band_rate', v_total_coverage
    ),
    'corrections_applied', v_any_correction,
    'by_category', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'category', c.value->>'category',
        'median_pct_error', c.value->'accuracy'->'median_pct_error',
        'in_band_rate', c.value->'accuracy'->'in_band_rate',
        'bias_factor', c.value->'accuracy'->'bias_factor',
        'band_scale', c.value->'accuracy'->'band_scale',
        'months', c.value->'accuracy'->'months'
      ) order by c.value->>'category')
      from pg_catalog.jsonb_array_elements(v_categories) c
    ), '[]'::jsonb),
    'last_month', v_last_month
  ));

  return v_forecast;
end
$fn$;

revoke all on function fin.forecast()
from public, anon, authenticated, service_role;

-- Snapshot capture is deliberately a separate volatile writer. The primary key and ON
-- CONFLICT make repeated syncs on the same calendar day a no-op for every category and
-- for the total row (category '').
create or replace function fin.capture_forecast_snapshot()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_model_version constant text := 'daytype-1';
  v_forecast jsonb;
  v_inserted integer;
begin
  v_forecast := fin.forecast();

  insert into fin.forecast_snapshots (
    month, day_of_month, category, model_version,
    spent, committed, low, medium, high
  )
  select
    v_forecast->>'month',
    (v_forecast->>'day_of_month')::integer,
    x.category,
    c_model_version,
    x.spent,
    x.committed,
    x.low,
    x.medium,
    x.high
  from (
    select
      ''::text as category,
      (v_forecast->'total'->>'spent')::numeric as spent,
      (v_forecast->'committed'->>'remaining')::numeric as committed,
      (v_forecast->'total'->>'low')::numeric as low,
      (v_forecast->'total'->>'medium')::numeric as medium,
      (v_forecast->'total'->>'high')::numeric as high
    union all
    select
      c.value->>'category',
      (c.value->>'spent')::numeric,
      (c.value->>'committed')::numeric,
      (c.value->>'low')::numeric,
      (c.value->>'medium')::numeric,
      (c.value->>'high')::numeric
    from pg_catalog.jsonb_array_elements(v_forecast->'categories') c
  ) x
  on conflict (month, day_of_month, category, model_version) do nothing;

  get diagnostics v_inserted = row_count;
  return pg_catalog.jsonb_build_object(
    'month', v_forecast->>'month',
    'day_of_month', (v_forecast->>'day_of_month')::integer,
    'model_version', c_model_version,
    'inserted', v_inserted
  );
end
$fn$;

revoke all on function fin.capture_forecast_snapshot()
from public, anon, authenticated, service_role;

-- Capture only after fin.sync_plaid() returns successfully. Snapshot failure is reported
-- without hiding a successful bank sync; the dashboard can still render fresh data.
create or replace function fin.api_sync_plaid_on_view(p_min_interval_seconds integer default 900)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '55s'
as $fn$
declare
  v_last timestamptz;
  v_result jsonb;
  v_snapshot jsonb;
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;
  if p_min_interval_seconds < 1 then
    raise exception 'p_min_interval_seconds must be at least 1';
  end if;

  select pg_catalog.min(last_synced_at) into v_last from fin.plaid_items;

  if v_last is not null
     and v_last > pg_catalog.now() - pg_catalog.make_interval(secs => p_min_interval_seconds) then
    return pg_catalog.jsonb_build_object(
      'ran', false,
      'reason', 'recent',
      'last_synced_at', pg_catalog.to_char(v_last, 'YYYY-MM-DD HH24:MI')
    );
  end if;

  begin
    v_result := fin.sync_plaid();
  exception when others then
    return pg_catalog.jsonb_build_object('ran', false, 'error', left(sqlerrm, 300));
  end;

  begin
    v_snapshot := fin.capture_forecast_snapshot();
  exception when others then
    v_snapshot := pg_catalog.jsonb_build_object('error', left(sqlerrm, 300));
  end;

  return pg_catalog.jsonb_build_object(
    'ran', true,
    'result', v_result,
    'forecast_snapshot', v_snapshot
  );
end
$fn$;

revoke all on function fin.api_sync_plaid_on_view(integer)
from public, anon, service_role;
grant execute on function fin.api_sync_plaid_on_view(integer) to authenticated;
