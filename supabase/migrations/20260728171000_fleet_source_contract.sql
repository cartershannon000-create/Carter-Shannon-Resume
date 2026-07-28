-- The scheduled sweep reads positions from airplanes.live. The earlier RPC
-- incorrectly labelled those fixes as OpenSky data; OpenSky supplies the
-- aircraft roster, not the live position feed.

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
               p.seen_at, p.callsign, p.lat, p.lon, p.altitude_m,
               p.velocity_ms, p.heading_deg, p.on_ground
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
          where seen_at >= v_cutoff
        ),
        'latest_fix_at', (
          select max(seen_at) from cos.fleet_positions
        ),
        'source', 'airplanes.live ADS-B',
        'position_source', 'airplanes.live ADS-B',
        'roster_source', 'OpenSky aircraft registry',
        'basis', 'measured'
      )
    )
  );
end
$$;

revoke all on function cos.api_fleet_state(integer) from public, anon;
grant execute on function cos.api_fleet_state(integer) to authenticated;
