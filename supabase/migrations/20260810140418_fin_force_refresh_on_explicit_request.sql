-- An explicit "Refresh from banks" now asks Plaid to re-poll the institution first.
--
-- /transactions/sync only returns what Plaid has already collected on its own schedule,
-- so before this the button could not surface a charge the card issuer was already
-- showing -- which is exactly what happened with a Lyft charge posting on Amex while
-- Plaid still reported it pending. A passive tab view still does the cheap read; only a
-- deliberate refresh pays for the re-poll, which is rate limited.
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
  v_force boolean;
begin
  if not cos.is_owner() then
    raise exception 'forbidden';
  end if;
  if p_min_interval_seconds < 1 then
    raise exception 'p_min_interval_seconds must be at least 1';
  end if;

  -- A short window is only ever passed by a deliberate press of the refresh control; a
  -- passive tab view uses 900. That distinction is what decides whether it is worth
  -- spending a rate-limited re-poll.
  v_force := p_min_interval_seconds <= 120;

  select min(last_synced_at) into v_last from fin.plaid_items;

  if v_last is not null
     and v_last > pg_catalog.now() - pg_catalog.make_interval(secs => p_min_interval_seconds) then
    return jsonb_build_object('ran', false, 'reason', 'recent',
                              'last_synced_at', pg_catalog.to_char(v_last, 'YYYY-MM-DD HH24:MI'));
  end if;

  begin
    v_result := fin.sync_plaid(false, v_force);
  exception when others then
    return jsonb_build_object('ran', false, 'error', left(sqlerrm, 300));
  end;

  perform fin.capture_forecast_snapshot();

  return jsonb_build_object('ran', true, 'forced_refresh', v_force, 'result', v_result);
end
$fn$;

revoke all on function fin.api_sync_plaid_on_view(integer) from public, anon, service_role;
grant execute on function fin.api_sync_plaid_on_view(integer) to authenticated;;
