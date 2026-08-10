-- The Review tab's "Saved overrides" count reads 0 on load even when overrides exist.
--
-- fin.v_transactions resolves an override into `category` before the payload is built, so
-- by the time the frame sees a row there is nothing marking it as overridden -- the
-- corrected category looks exactly like an inferred one. The frame therefore counts only
-- the edits made in the current session, and a reload resets it to zero. That reads as
-- "my corrections were not saved", which is the opposite of what happened.
--
-- Returning the map lets the frame seed its own override state from the server, so the
-- count reflects what is actually stored.
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
