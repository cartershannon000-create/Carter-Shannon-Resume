-- Live definitions captured after two in-place fixes, so the repository matches
-- production. fin.sync_plaid now records Plaid's pending_transaction_id, which links a
-- posted charge back to the pending row it replaces; that link supersedes the pending
-- row deterministically rather than relying on the `removed` event arriving. Without it,
-- a missed removal plus a changed amount (a tip) would show the charge twice.
--
-- api_financial_state carries the pending flag so the table can mark provisional rows.

CREATE OR REPLACE FUNCTION fin.sync_plaid(p_reset boolean DEFAULT false, p_force_refresh boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client_id text;
  v_secret text;
  v_item record;
  v_token text;
  v_cursor text;
  v_has_more boolean;
  v_body jsonb;
  v_resp record;
  v_pages integer;
  v_added integer := 0;
  v_removed integer := 0;
  v_result jsonb := '[]'::jsonb;
  v_item_added integer;
  v_item_removed integer;
  v_derived integer;
begin
  v_client_id := fin.get_credential('plaid_client_id');
  v_secret    := fin.get_credential('plaid_secret');
  if v_client_id is null or v_secret is null then
    raise exception 'Plaid credentials are not stored; run fin_setup_cloud_sync.py --secrets';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');

  for v_item in select * from fin.plaid_items order by item_id loop
    v_token := fin.get_credential('plaid_token_' || v_item.item_id);
    if v_token is null then
      update fin.plaid_items set last_error = 'no access token stored' where item_id = v_item.item_id;
      continue;
    end if;

    -- /transactions/sync only reads what Plaid has already gathered. Asking it to
    -- re-poll the institution first is what makes an explicit refresh able to pick up a
    -- charge the card issuer already shows. Rate limited, so only on explicit request,
    -- and a failure here must not stop the sync -- stale data beats no data.
    if p_force_refresh then
      begin
        perform extensions.http((
          'POST', 'https://production.plaid.com/transactions/refresh',
          array[extensions.http_header('Content-Type', 'application/json')],
          'application/json',
          jsonb_build_object('client_id', v_client_id, 'secret', v_secret,
                             'access_token', v_token)::text
        )::extensions.http_request);
      exception when others then
        null;
      end;
    end if;

    v_cursor := case when p_reset then '' else coalesce(v_item.cursor, '') end;
    v_has_more := true;
    v_pages := 0;

    begin
      while v_has_more and v_pages < 50 loop
        v_pages := v_pages + 1;

        select * into v_resp from extensions.http((
          'POST',
          'https://production.plaid.com/transactions/sync',
          array[extensions.http_header('Content-Type', 'application/json')],
          'application/json',
          jsonb_build_object('client_id', v_client_id, 'secret', v_secret,
                             'access_token', v_token, 'count', 500)
            || case when v_cursor <> '' then jsonb_build_object('cursor', v_cursor) else '{}'::jsonb end
        )::extensions.http_request);

        if v_resp.status <> 200 then
          raise exception 'Plaid returned % for item %: %',
            v_resp.status, v_item.item_id, left(v_resp.content, 300);
        end if;

        v_body := v_resp.content::jsonb;

        insert into fin.plaid_transactions
          (transaction_id, item_id, account_id, txn_date, name, merchant_name, amount,
           category_primary, category_detailed, pending, pending_transaction_id, updated_at)
        select x->>'transaction_id', v_item.item_id, x->>'account_id', (x->>'date')::date,
               coalesce(x->>'name', ''), coalesce(x->>'merchant_name', ''),
               round((x->>'amount')::numeric, 2),
               coalesce(x#>>'{personal_finance_category,primary}', ''),
               coalesce(x#>>'{personal_finance_category,detailed}', ''),
               coalesce((x->>'pending')::boolean, false),
               nullif(x->>'pending_transaction_id', ''), now()
        from jsonb_array_elements(coalesce(v_body->'added', '[]'::jsonb)
                                  || coalesce(v_body->'modified', '[]'::jsonb)) x
        on conflict (transaction_id) do update set
          account_id = excluded.account_id, txn_date = excluded.txn_date,
          name = excluded.name, merchant_name = excluded.merchant_name,
          amount = excluded.amount, category_primary = excluded.category_primary,
          category_detailed = excluded.category_detailed, pending = excluded.pending,
          pending_transaction_id = excluded.pending_transaction_id,
          updated_at = now();
        get diagnostics v_item_added = row_count;
        v_added := v_added + v_item_added;

        delete from fin.plaid_transactions
         where transaction_id in (
           select x->>'transaction_id'
           from jsonb_array_elements(coalesce(v_body->'removed', '[]'::jsonb)) x);
        get diagnostics v_item_removed = row_count;
        v_removed := v_removed + v_item_removed;

        v_cursor := coalesce(v_body->>'next_cursor', v_cursor);
        v_has_more := coalesce((v_body->>'has_more')::boolean, false);
      end loop;

      update fin.plaid_items
         set cursor = v_cursor, last_synced_at = now(), last_error = ''
       where item_id = v_item.item_id;

    exception when others then
      update fin.plaid_items set last_error = left(sqlerrm, 400) where item_id = v_item.item_id;
      v_result := v_result || jsonb_build_object('item', v_item.item_id, 'error', left(sqlerrm, 300));
      continue;
    end;

    v_result := v_result || jsonb_build_object(
      'item', v_item.item_id, 'institution', v_item.institution, 'pages', v_pages);
  end loop;

  v_derived := fin.rebuild_plaid_transactions();

  return jsonb_build_object(
    'synced_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    'upserted', v_added, 'removed', v_removed,
    'plaid_rows_derived', v_derived,
    'items', v_result);
end
$function$
;

CREATE OR REPLACE FUNCTION fin.api_financial_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'pending_count', (select count(*) from fin.v_transactions where pending),
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
        'occurrence', occurrence, 'pending', pending
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
$function$
;

revoke all on function fin.sync_plaid(boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function fin.api_financial_state() from public, anon, service_role;
grant execute on function fin.api_financial_state() to authenticated;
