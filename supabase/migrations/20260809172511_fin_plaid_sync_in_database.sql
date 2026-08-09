-- Autonomous Plaid sync, running inside Postgres so the dashboard stays current with no
-- laptop involved. pg_cron schedules it; the http extension talks to Plaid; credentials
-- live in Vault. service_role is granted nothing here, as everywhere else in `fin`.
--
-- Design note: Plaid's /transactions/sync is incremental (added/modified/removed against
-- a cursor), but fin.transactions is keyed on a FINGERPRINT -- account|date|description|
-- amount|source -- not on Plaid's transaction_id. Two consequences drove the shape below:
--
--   * a removal names a transaction_id, which the fingerprint cannot be reversed into, and
--   * `occurrence` (which separates two genuine Metro taps from one charge seen twice)
--     is computed by ranking every identical row in the feed, so it is not incremental.
--
-- So the sync lands raw rows in a staging table, exactly like the local plaid_store.sqlite,
-- and fin.transactions is then DERIVED from that whole table in one deterministic pass.
-- That is what build_financial_dashboard.py does, and it means a re-run cannot double-count.

create table if not exists fin.plaid_accounts (
  account_id text primary key,
  item_id text not null,
  dashboard_account text not null,
  mask text not null default ''
);

create table if not exists fin.plaid_transactions (
  transaction_id text primary key,
  item_id text not null,
  account_id text not null,
  txn_date date not null,
  name text not null default '',
  merchant_name text not null default '',
  amount numeric(14,2) not null,
  category_primary text not null default '',
  category_detailed text not null default '',
  pending boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists plaid_transactions_date_idx on fin.plaid_transactions (txn_date);

-- Plaid signs spend as positive on every account; the dashboard wants cash accounts to
-- show spend as negative. Which accounts flip is a property of the account.
alter table fin.account_roles
  add column if not exists amount_negative_for_spend boolean not null default false;
update fin.account_roles set amount_negative_for_spend = true
  where account in ('Checking', 'Wells Fargo', 'Venmo');
insert into fin.account_roles (account, role, amount_negative_for_spend)
values ('Venmo', 'cash', true)
on conflict (account) do update set amount_negative_for_spend = true;

-- Lets a removal find the row it produced.
alter table fin.transactions add column if not exists plaid_transaction_id text;
create index if not exists transactions_plaid_id_idx on fin.transactions (plaid_transaction_id);

alter table fin.plaid_accounts enable row level security;
alter table fin.plaid_transactions enable row level security;

-- ---------------------------------------------------------------------------
-- Derive fin.transactions from the staging table.
--
-- Rebuilds every Plaid-sourced row from scratch, so it is idempotent: running it twice
-- changes nothing. Rows before the takeover date belong to the CSV era and are left
-- alone, which is the same hard line PLAID_TAKEOVER_DATE draws in Python.
-- ---------------------------------------------------------------------------
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
    return 0;   -- an unconfigured feed must change no number in the dashboard
  end if;

  create temporary table _derived on commit drop as
  with rows as (
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
    where not t.pending
      and t.txn_date >= v_takeover
      and a.dashboard_account <> ''
  ),
  -- Ranked by transaction_id so a repeat charge keeps the same occurrence between runs;
  -- otherwise the same charge changes primary key and the dashboard shows a new row.
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

  -- Drop Plaid rows that no longer exist upstream, then upsert what does.
  delete from fin.transactions t
   where t.source like 'Plaid:%'
     and t.txn_date >= v_takeover
     and not exists (select 1 from _derived d where d.id = t.id);

  insert into fin.transactions
    (id, account, txn_date, description, category, amount, cost, type, status, source,
     native_category, counterparty, occurrence, needs_review, plaid_transaction_id, updated_at)
  select d.id, d.account, d.txn_date, d.description, d.category, d.amount, d.cost, '', '',
         d.source, d.native_category, d.counterparty, d.occurrence,
         d.category in ('uncategorized', 'merchandise'), d.transaction_id, now()
  from _derived d
  on conflict (id) do update set
    account = excluded.account, description = excluded.description,
    category = excluded.category, amount = excluded.amount, cost = excluded.cost,
    native_category = excluded.native_category, counterparty = excluded.counterparty,
    occurrence = excluded.occurrence, needs_review = excluded.needs_review,
    plaid_transaction_id = excluded.plaid_transaction_id, updated_at = now();

  select count(*) into v_count from _derived;
  return v_count;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Pull from Plaid.
--
-- Only `production` data is ever accepted. Sandbox is fake money from "First Platypus
-- Bank" and must never mix into real numbers -- the same guard the local sync enforces.
-- ---------------------------------------------------------------------------
create or replace function fin.sync_plaid(p_reset boolean default false)
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
  v_result jsonb := '[]'::jsonb;
  v_item_added integer;
  v_item_removed integer;
  v_derived integer;
begin
  select decrypted_secret into v_client_id from vault.decrypted_secrets where name = 'plaid_client_id';
  select decrypted_secret into v_secret    from vault.decrypted_secrets where name = 'plaid_secret';
  if v_client_id is null or v_secret is null then
    raise exception 'Plaid credentials are not in Vault (need plaid_client_id and plaid_secret)';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');

  for v_item in select * from fin.plaid_items order by item_id loop
    select decrypted_secret into v_token from vault.decrypted_secrets
      where name = 'plaid_token_' || v_item.item_id;
    if v_token is null then
      update fin.plaid_items set last_error = 'no access token in Vault' where item_id = v_item.item_id;
      continue;
    end if;

    v_cursor := case when p_reset then '' else coalesce(v_item.cursor, '') end;
    v_has_more := true;
    v_pages := 0;
    v_item_added := 0;
    v_item_removed := 0;

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

        -- added and modified are handled identically: upsert whatever Plaid now says.
        insert into fin.plaid_transactions
          (transaction_id, item_id, account_id, txn_date, name, merchant_name, amount,
           category_primary, category_detailed, pending, updated_at)
        select x->>'transaction_id', v_item.item_id, x->>'account_id', (x->>'date')::date,
               coalesce(x->>'name', ''), coalesce(x->>'merchant_name', ''),
               round((x->>'amount')::numeric, 2),
               coalesce(x#>>'{personal_finance_category,primary}', ''),
               coalesce(x#>>'{personal_finance_category,detailed}', ''),
               coalesce((x->>'pending')::boolean, false), now()
        from jsonb_array_elements(coalesce(v_body->'added', '[]'::jsonb)
                                  || coalesce(v_body->'modified', '[]'::jsonb)) x
        on conflict (transaction_id) do update set
          account_id = excluded.account_id, txn_date = excluded.txn_date,
          name = excluded.name, merchant_name = excluded.merchant_name,
          amount = excluded.amount, category_primary = excluded.category_primary,
          category_detailed = excluded.category_detailed, pending = excluded.pending,
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

      -- The cursor is only advanced once the page it describes is safely stored, so a
      -- failure mid-run re-fetches rather than silently skipping transactions.
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
$fn$;

revoke all on all tables in schema fin from public, anon, authenticated, service_role;
revoke all on all functions in schema fin from public, anon, authenticated, service_role;
grant execute on function fin.api_financial_state() to authenticated;
grant execute on function fin.api_set_category(text, text, text) to authenticated;;
