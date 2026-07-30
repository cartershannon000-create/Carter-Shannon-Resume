-- Manual last-known airport seeds are not equivalent to live ADS-B fixes.
-- Keep the observation source and location method on each row so the dashboard
-- can distinguish a FlightAware arrival from an airplanes.live position.

alter table cos.fleet_positions
  add column if not exists source text not null
    default 'airplanes.live ADS-B',
  add column if not exists location_kind text not null
    default 'adsb_fix',
  add column if not exists airport_icao text,
  add column if not exists source_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fleet_positions_location_kind_check'
      and conrelid = 'cos.fleet_positions'::regclass
  ) then
    alter table cos.fleet_positions
      add constraint fleet_positions_location_kind_check
      check (location_kind in ('adsb_fix', 'airport_last_arrival'));
  end if;
end
$$;

comment on column cos.fleet_positions.source is
  'Provider for this observation, such as airplanes.live ADS-B or FlightAware.';
comment on column cos.fleet_positions.location_kind is
  'adsb_fix is a point observation; airport_last_arrival is the destination of the latest completed flight.';
comment on column cos.fleet_positions.airport_icao is
  'Airport represented by an airport_last_arrival row; null for point ADS-B fixes.';
comment on column cos.fleet_positions.source_url is
  'Public evidence URL for a manually seeded last-known arrival.';

create or replace function cos.api_fleet_state(
  p_trail_minutes integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz :=
    now() - make_interval(mins => greatest(p_trail_minutes, 5));
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'aircraft', (
      select coalesce(jsonb_agg(a order by a.tail), '[]'::jsonb)
      from (
        select f.icao24, f.tail, f.model, f.operator, f.source,
               f.source as roster_source,
               p.seen_at, p.callsign, p.lat, p.lon, p.altitude_m,
               p.velocity_ms, p.heading_deg, p.on_ground,
               p.source as position_source, p.location_kind,
               p.airport_icao, p.source_url
        from cos.fleet_aircraft f
        left join lateral (
          select *
          from cos.fleet_positions q
          where q.icao24 = f.icao24
          order by q.seen_at desc
          limit 1
        ) p on true
        where f.active
      ) a
    ),
    'trails', (
      select coalesce(jsonb_object_agg(t.icao24, t.points), '{}'::jsonb)
      from (
        select q.icao24,
               jsonb_agg(
                 jsonb_build_object(
                   'lat', q.lat,
                   'lon', q.lon,
                   'seen_at', q.seen_at
                 ) order by q.seen_at
               ) as points
        from cos.fleet_positions q
        where q.seen_at >= v_cutoff
          and q.lat is not null
          and q.location_kind = 'adsb_fix'
        group by q.icao24
      ) t
    ),
    'coverage', (
      select jsonb_build_object(
        'aircraft_tracked', (
          select count(*) from cos.fleet_aircraft where active
        ),
        'aircraft_seen', (
          select count(distinct icao24)
          from cos.fleet_positions
        ),
        'aircraft_seen_recently', (
          select count(distinct icao24)
          from cos.fleet_positions
          where seen_at >= v_cutoff
        ),
        'latest_fix_at', (
          select max(seen_at) from cos.fleet_positions
        ),
        'source', 'airplanes.live ADS-B + FlightAware last-known arrivals',
        'position_source', 'mixed per-aircraft; see position_source',
        'roster_source', 'OpenSky aircraft registry',
        'basis', 'measured'
      )
    )
  );
end
$$;

revoke all on function cos.api_fleet_state(integer) from public, anon;
grant execute on function cos.api_fleet_state(integer) to authenticated;
