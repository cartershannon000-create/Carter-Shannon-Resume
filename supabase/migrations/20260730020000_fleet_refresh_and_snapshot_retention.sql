create or replace view cos.fleet_last_known
with (security_invoker = true)
as
select
  p.position_id,
  a.icao24,
  p.seen_at,
  p.callsign,
  p.lat,
  p.lon,
  p.altitude_m,
  p.velocity_ms,
  p.heading_deg,
  p.on_ground,
  p.captured_at,
  p.source,
  p.location_kind,
  p.airport_icao,
  p.source_url,
  case
    when p.seen_at is null then null
    else greatest(
      0,
      extract(epoch from (current_timestamp - p.seen_at))::bigint
    )
  end as age_seconds
from cos.fleet_aircraft as a
left join lateral (
  select
    fp.position_id,
    fp.seen_at,
    fp.callsign,
    fp.lat,
    fp.lon,
    fp.altitude_m,
    fp.velocity_ms,
    fp.heading_deg,
    fp.on_ground,
    fp.captured_at,
    fp.source,
    fp.location_kind,
    fp.airport_icao,
    fp.source_url
  from cos.fleet_positions as fp
  where lower(fp.icao24) = lower(a.icao24)
  order by fp.seen_at desc, fp.captured_at desc, fp.position_id desc
  limit 1
) as p on true
where a.active
  and a.service_status = 'current_inventory';

create table if not exists cos.fleet_refresh_state (
  singleton boolean primary key default true check (singleton),
  last_requested_at timestamptz
);

insert into cos.fleet_refresh_state (singleton)
values (true)
on conflict (singleton) do nothing;

alter table cos.fleet_refresh_state enable row level security;
revoke all on cos.fleet_refresh_state from public, anon, authenticated;
grant select, insert, update on cos.fleet_refresh_state to service_role;

create or replace function cos.claim_fleet_refresh(
  p_min_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_requested_at timestamptz;
begin
  if p_min_interval_seconds < 1 then
    raise exception 'p_min_interval_seconds must be at least 1';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cos.claim_fleet_refresh', 0)
  );
  select last_requested_at
  into v_last_requested_at
  from cos.fleet_refresh_state
  where singleton;

  if v_last_requested_at is not null
     and v_last_requested_at >
       current_timestamp - pg_catalog.make_interval(
         secs => p_min_interval_seconds
       ) then
    return false;
  end if;

  update cos.fleet_refresh_state
  set last_requested_at = current_timestamp
  where singleton;
  return true;
end;
$$;

revoke all on function cos.claim_fleet_refresh(integer) from public;
grant execute on function cos.claim_fleet_refresh(integer) to service_role;

create or replace function cos.prune_omnisupply_snapshots(
  p_keep_recent integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doomed text[];
  v_deleted integer;
begin
  if p_keep_recent < 1 then
    raise exception 'p_keep_recent must be at least 1';
  end if;

  perform 1
  from cos.omnisupply_snapshots
  for update;

  with ranked as (
    select
      snapshot_id::text as snapshot_id,
      published_at,
      is_current,
      max(published_at) over () as newest_published_at,
      row_number() over (
        order by published_at desc, snapshot_id desc
      ) as recent_rank,
      row_number() over (
        partition by (published_at at time zone 'UTC')::date
        order by published_at desc, snapshot_id desc
      ) as daily_rank
    from cos.omnisupply_snapshots
  )
  select coalesce(array_agg(snapshot_id), array[]::text[])
  into v_doomed
  from ranked
  where recent_rank > p_keep_recent
    and (
      daily_rank > 1
      or published_at < newest_published_at - interval '30 days'
    )
    and not is_current;

  delete from cos.omnisupply_answers
  where snapshot_id::text = any(v_doomed);
  delete from cos.omnisupply_snapshots
  where snapshot_id::text = any(v_doomed);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

drop function if exists cos.refresh_omnisupply_on_view(
  text, timestamptz, integer
);

revoke all on function cos.prune_omnisupply_snapshots(integer) from public;
grant execute on function cos.prune_omnisupply_snapshots(integer)
  to service_role;
