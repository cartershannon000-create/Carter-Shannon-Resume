-- Sync when the dashboard is opened, not on a timer.
--
-- The 6-hourly cron job was the wrong instinct. This data has exactly one consumer -- a
-- dashboard someone looks at -- so a schedule spends Plaid calls whether or not anyone
-- is watching, and still serves data up to six hours stale at the moment they are. On
-- view inverts that: nothing is fetched when nobody is looking, and what you see when
-- you do look was fetched seconds ago.
--
-- This is the pattern the console already uses for the OmniSupply fleet
-- (refreshFleetOnView + a debounced RPC); financials now matches it.
select cron.unschedule('fin-plaid-sync');

-- Owner-gated, debounced entry point. Returns without calling Plaid when the last sync
-- is recent enough, so re-opening the tab or hitting Refresh repeatedly costs nothing.
--
-- The explicit statement_timeout matters: `authenticator` runs with 8s, and four banks
-- paged over HTTP will exceed that, so a browser-initiated sync would be killed
-- mid-flight. A function-level SET overrides the role default for this call alone.
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
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;
  if p_min_interval_seconds < 1 then
    raise exception 'p_min_interval_seconds must be at least 1';
  end if;

  -- The oldest item decides: if any institution is stale the run is worth making.
  select min(last_synced_at) into v_last from fin.plaid_items;

  if v_last is not null
     and v_last > pg_catalog.now() - pg_catalog.make_interval(secs => p_min_interval_seconds) then
    return jsonb_build_object('ran', false, 'reason', 'recent',
                              'last_synced_at', pg_catalog.to_char(v_last, 'YYYY-MM-DD HH24:MI'));
  end if;

  -- A sync failure must never take the dashboard down with it: the tab should still
  -- render the last known state and say why it is not fresher.
  begin
    v_result := fin.sync_plaid();
  exception when others then
    return jsonb_build_object('ran', false, 'error', left(sqlerrm, 300));
  end;

  return jsonb_build_object('ran', true, 'result', v_result);
end
$fn$;

revoke all on function fin.api_sync_plaid_on_view(integer) from public, anon, service_role;
grant execute on function fin.api_sync_plaid_on_view(integer) to authenticated;;
