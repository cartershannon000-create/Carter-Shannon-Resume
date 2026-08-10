-- Only completed charges enter the model, and every sync asks Plaid for fresh data.
--
-- Pending is excluded again, deliberately this time rather than by inheritance. A pending
-- amount is provisional -- a tip changes it, an authorisation and its reversal both
-- appear -- so including it means every total on the dashboard is a number that can move
-- after you read it. Settled-only keeps the figures meaningful.
--
-- Pending rows are still STAGED, because that is what lets a charge be recognised when it
-- posts and what fin.api_integrity() checks against. They just do not reach the model.
--
-- The refresh phase now runs for EVERY sync and as its own pass over all institutions
-- before any reading starts. /transactions/sync returns only what Plaid has already
-- collected on its own schedule, so without this a sync can only ever report what Plaid
-- happened to have. Refreshing every item first lets the banks re-poll in parallel during
-- the settle, rather than each one being asked and read back-to-back and returning its
-- own stale answer.
create or replace function fin.sync_plaid(p_reset boolean default false,
                                          p_force_refresh boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
  v_refreshed integer := 0;
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

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');

  -- Pass one: ask every institution to re-poll, so they work concurrently.
  if p_force_refresh then
    for v_item in select * from fin.plaid_items order by item_id loop
      v_token := fin.get_credential('plaid_token_' || v_item.item_id);
      if v_token is null then continue; end if;
      begin
        perform extensions.http((
          'POST', 'https://production.plaid.com/transactions/refresh',
          array[extensions.http_header('Content-Type', 'application/json')],
          'application/json',
          jsonb_build_object('client_id', v_client_id, 'secret', v_secret,
                             'access_token', v_token)::text
        )::extensions.http_request);
        v_refreshed := v_refreshed + 1;
      exception when others then
        -- Rate limited, unsupported, or the bank is down. Read what we have anyway:
        -- stale data beats none, and the next sync will pick up the difference.
        null;
      end;
    end loop;
    -- Give the extractions a moment to land before reading. Not all institutions finish
    -- inside the call, so without this the first sync after a refresh reports the old
    -- state and the change only appears on the following one.
    perform pg_catalog.pg_sleep(6);
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');

  -- Pass two: read.
  for v_item in select * from fin.plaid_items order by item_id loop
    v_token := fin.get_credential('plaid_token_' || v_item.item_id);
    if v_token is null then
      update fin.plaid_items set last_error = 'no access token stored' where item_id = v_item.item_id;
      continue;
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
          pending_transaction_id = excluded.pending_transaction_id, updated_at = now();
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
    'refreshed_items', v_refreshed,
    'upserted', v_added, 'removed', v_removed,
    'plaid_rows_derived', v_derived,
    'items', v_result);
end
$fn$;

-- Posted only. Pending stays staged so it can be recognised when it settles.
create or replace function fin.rebuild_plaid_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_takeover date;
  v_count integer;
begin
  select plaid_takeover_date into v_takeover from fin.config where id;
  if v_takeover is null then
    return 0;
  end if;

  create temporary table _derived on commit drop as
  with superseded as (
    select distinct pending_transaction_id as transaction_id
    from fin.plaid_transactions
    where pending_transaction_id is not null
  ),
  rows as (
    select
      t.transaction_id,
      a.dashboard_account as account,
      t.txn_date,
      coalesce(nullif(btrim(t.name), ''), nullif(btrim(t.merchant_name), ''), 'Plaid transaction') as description,
      round(case when r.amount_negative_for_spend then -t.amount else t.amount end, 2) as amount,
      round(t.amount, 2) as cost,
      t.merchant_name as counterparty,
      coalesce(nullif(t.category_detailed, ''), t.category_primary) as native_category,
      t.category_detailed, t.category_primary
    from fin.plaid_transactions t
    join fin.plaid_accounts a on a.account_id = t.account_id
    left join fin.account_roles r on r.account = a.dashboard_account
    where t.txn_date >= v_takeover
      and a.dashboard_account <> ''
      and not t.pending
      and not exists (select 1 from superseded s where s.transaction_id = t.transaction_id)
  ),
  ranked as (
    select rows.*,
           row_number() over (partition by txn_date, description, amount
                              order by transaction_id) as occurrence
    from rows
  )
  select
    fin.make_tx_id(account, txn_date, description, amount, 'Plaid:' || account,
                   coalesce(counterparty, ''), occurrence::integer) as id,
    account, txn_date, description,
    fin.categorize_plaid(description, native_category, category_detailed, category_primary,
                         account, coalesce(counterparty, '')) as category,
    amount, cost, 'Plaid:' || account as source, native_category,
    coalesce(counterparty, '') as counterparty, occurrence::integer as occurrence,
    transaction_id
  from ranked;

  delete from fin.transactions t
   where t.source like 'Plaid:%'
     and t.txn_date >= v_takeover
     and not exists (select 1 from _derived d where d.id = t.id);

  insert into fin.transactions
    (id, account, txn_date, description, category, amount, cost, type, status, source,
     native_category, counterparty, occurrence, needs_review, plaid_transaction_id,
     pending, updated_at)
  select d.id, d.account, d.txn_date, d.description, d.category, d.amount, d.cost, '', '',
         d.source, d.native_category, d.counterparty, d.occurrence,
         d.category in ('uncategorized', 'merchandise'), d.transaction_id,
         false, now()
  from _derived d
  on conflict (id) do update set
    account = excluded.account, description = excluded.description,
    category = excluded.category, amount = excluded.amount, cost = excluded.cost,
    status = excluded.status,
    native_category = excluded.native_category, counterparty = excluded.counterparty,
    occurrence = excluded.occurrence, needs_review = excluded.needs_review,
    plaid_transaction_id = excluded.plaid_transaction_id,
    pending = false, updated_at = now();

  select count(*) into v_count from _derived;
  return v_count;
end
$fn$;

revoke all on function fin.sync_plaid(boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function fin.rebuild_plaid_transactions() from public, anon, authenticated, service_role;

select fin.rebuild_plaid_transactions();;
