-- Bank credentials, split so the agent runner can never hold both halves.
--
-- Supabase grants service_role USAGE on `vault` and SELECT on vault.decrypted_secrets,
-- which returns PLAINTEXT. That grant is made by supabase_admin and cannot be revoked by
-- postgres, so anything placed in Vault is permanently readable by the runner. Putting
-- Plaid access tokens there would hand it credentials that can read every bank
-- transaction -- a worse exposure than the `fin` data itself.
--
-- So the two halves live apart:
--   * the encryption KEY in Vault      -- runner can read it, and it is useless alone
--   * the CIPHERTEXT in fin            -- runner has no USAGE on this schema at all
--
-- fin.sync_plaid() is SECURITY DEFINER owned by postgres, so it reads both as its owner.
-- The result is encrypted at rest *and* access-controlled, where Vault alone gave only
-- the first and a plain table only the second.

create table if not exists fin.plaid_credentials (
  name text primary key,
  secret_encrypted bytea not null,
  updated_at timestamptz not null default now()
);

alter table fin.plaid_credentials enable row level security;
revoke all on fin.plaid_credentials from public, anon, authenticated, service_role;

-- The key is created once and never rotated automatically: rotating it without
-- re-encrypting every row would silently break the sync rather than fail loudly.
create or replace function fin.credential_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fin_credential_key';
  if v_key is null then
    raise exception 'fin_credential_key is missing from Vault; run fin_setup_cloud_sync.py --secrets';
  end if;
  return v_key;
end
$fn$;

create or replace function fin.set_credential(p_name text, p_value text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  insert into fin.plaid_credentials (name, secret_encrypted, updated_at)
  values (p_name, extensions.pgp_sym_encrypt(p_value, fin.credential_key()), now())
  on conflict (name) do update
    set secret_encrypted = excluded.secret_encrypted, updated_at = now();
end
$fn$;

create or replace function fin.get_credential(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cipher bytea;
begin
  select secret_encrypted into v_cipher from fin.plaid_credentials where name = p_name;
  if v_cipher is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_cipher, fin.credential_key());
end
$fn$;

-- Read credentials from the split store rather than straight from Vault.
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

revoke all on function fin.credential_key() from public, anon, authenticated, service_role;
revoke all on function fin.set_credential(text, text) from public, anon, authenticated, service_role;
revoke all on function fin.get_credential(text) from public, anon, authenticated, service_role;
revoke all on function fin.sync_plaid(boolean) from public, anon, authenticated, service_role;;
