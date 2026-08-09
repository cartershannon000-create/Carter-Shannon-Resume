-- Spacer rows in the budget workbook carry month = '' with a null value: they exist to
-- hold a row_order slot, not to describe a month. Python's loader skipped them when
-- building its month list (`if row["month"]`), so `distinct month` here was picking up a
-- blank entry that sorted to the front and shifted every column by one.
--
-- Caught by fin_parity.py, which diffs this payload against build_payload().
create or replace function fin.monthly_summary()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'months', to_jsonb(array(
      select distinct month from fin.monthly_summary_rows
      where month <> '' order by month
    )),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', r.label, 'style', r.style, 'kind', r.kind,
        'values', coalesce(r.vals, '{}'::jsonb)
      ) order by r.row_order)
      from (
        select row_order, max(label) as label, max(style) as style, max(kind) as kind,
               jsonb_object_agg(month, value) filter (where value is not null and month <> '') as vals
        from fin.monthly_summary_rows group by row_order
      ) r
    ), '[]'::jsonb)
  )
$fn$;

revoke all on function fin.monthly_summary() from public, anon, authenticated, service_role;
