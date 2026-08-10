-- The dashboard had no way to say when it last reached the banks. `generated_at` is when
-- the payload was assembled, which is every page load and says nothing about data
-- freshness -- the two look alike and the wrong one is reassuring. Plaid sync state is a
-- separate fact and is now carried explicitly.
--
-- last_synced_at is the OLDEST across institutions, not the newest: if Amex synced a
-- minute ago and Wells Fargo failed four hours back, the honest answer is four hours.
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
    'sync', jsonb_build_object(
      'last_synced_at', (select to_char(min(last_synced_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                         from fin.plaid_items),
      'never_synced', (select count(*) from fin.plaid_items where last_synced_at is null),
      'errors', (select count(*) from fin.plaid_items where coalesce(last_error, '') <> ''),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'institution', institution,
          'last_synced_at', to_char(last_synced_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'last_error', coalesce(last_error, '')
        ) order by institution)
        from fin.plaid_items), '[]'::jsonb)
    ),
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
    'overrides', coalesce((
      select jsonb_object_agg(tx_id, category) from fin.category_overrides
    ), '{}'::jsonb),
    'summary', fin.summary(),
    'workbook_monthly', fin.monthly_summary(),
    'insights', fin.insights(),
    'cashflow', fin.cashflow(),
    'forecast', fin.forecast(),
    'accounts', to_jsonb(
      array['Overview','Forecast','Monthly','Cash Flow','Analytics','Review']
      || array(select distinct account from fin.v_transactions order by account)
    )
  );
end
$fn$;

revoke all on function fin.api_financial_state() from public, anon, service_role;
grant execute on function fin.api_financial_state() to authenticated;;
