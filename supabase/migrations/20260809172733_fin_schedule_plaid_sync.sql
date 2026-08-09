-- Every six hours. Banks post transactions in batches rather than instantly, so a
-- tighter schedule mostly spends Plaid quota re-asking a question already answered.
--
-- The job is safe to overrun or repeat: fin.sync_plaid() advances each item's cursor
-- only after the page it describes is stored, and fin.rebuild_plaid_transactions()
-- derives fin.transactions from the whole staging table rather than appending, so a
-- double run cannot double-count.
--
-- Until the Plaid credentials are in Vault this job will fail on every run and record
-- the reason in fin.plaid_items.last_error. That is deliberate: a scheduled job that
-- reports it cannot authenticate is a better state than no job at all.
select cron.schedule(
  'fin-plaid-sync',
  '0 */6 * * *',
  $job$select fin.sync_plaid()$job$
);

-- What the last run did, for the dashboard and for debugging.
create or replace function fin.api_sync_status()
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'institution', institution,
        'last_synced_at', to_char(last_synced_at, 'YYYY-MM-DD HH24:MI'),
        'last_error', last_error,
        'has_cursor', coalesce(cursor, '') <> ''
      ) order by institution)
      from fin.plaid_items), '[]'::jsonb),
    'staged_rows', (select count(*) from fin.plaid_transactions),
    'next_run', (select to_char(min(next_run), 'YYYY-MM-DD HH24:MI')
                 from (select now() as next_run) s)
  );
end
$fn$;

revoke all on function fin.api_sync_status() from public, anon, service_role;
grant execute on function fin.api_sync_status() to authenticated;;
