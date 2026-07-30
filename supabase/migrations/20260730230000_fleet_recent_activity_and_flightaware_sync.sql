-- Operational fleet membership is evidence-based: an airframe is active when
-- public flight evidence exists in the preceding two months. Manual service
-- status remains available as historical context, but no longer drives the
-- Company-page active fleet.

insert into cos.fleet_positions (
  icao24, seen_at, callsign, lat, lon, altitude_m, velocity_ms, heading_deg,
  on_ground, source, location_kind, airport_icao, source_url
)
values
  ('a9bba9', '2026-04-14T16:38:00Z', 'JUS726', 31.2590, -81.4663, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KBQK',
   'https://www.flightaware.com/live/flight/N726US/history/20260414/1410Z/KLRD/KBQK'),
  ('a9bf60', '2026-07-30T19:13:00Z', 'JUS727', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N727US/history/20260730/1725Z/KMCI/KYIP'),
  ('ab0d14', '2024-03-22T05:00:00Z', 'JUS811', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N811AA/history/20240322/0400Z/KMQY/KYIP'),
  ('ab384a', '2024-04-10T06:03:00Z', 'JUS822', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N822AA/history/20240410/0500Z/KIAG/KYIP'),
  ('ab4add', '2024-04-10T08:31:00Z', 'JUS827', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N827AA/history/20240410/0530Z/KIAG/KYIP'),
  ('ab5de4', '2026-07-29T03:59:00Z', 'JUS403', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N831US/history/20260729/0305Z/KMCI/KYIP'),
  ('ab619b', '2026-07-29T17:04:00Z', 'JUS434', 27.5442, -99.4616, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KLRD',
   'https://www.flightaware.com/live/flight/N832US/history/20260729/1610Z/KDAY/KLRD'),
  ('ab6552', '2026-07-27T02:06:00Z', 'JUS101', 27.5442, -99.4616, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KLRD',
   'https://www.flightaware.com/live/flight/N833US/history/20260726/2240Z/KYIP/KLRD'),
  ('ab6909', '2026-07-29T08:56:00Z', 'JUS349', 27.5442, -99.4616, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KLRD',
   'https://www.flightaware.com/live/flight/N834US/history/20260729/0740Z/KAFW/KLRD'),
  ('ab6cc0', '2026-07-29T21:08:00Z', 'JUS441', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N835US/history/20260729/2010Z/KMCI/KYIP'),
  ('ab891a', '2026-06-26T21:37:00Z', 'JUS570', 31.2590, -81.4663, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KBQK',
   'https://www.flightaware.com/live/flight/N842US/history/20260626/2010Z/KSDF/KBQK'),
  ('ad4ee3', '2026-04-07T21:41:00Z', 'N957CJ', 42.6656, -83.4205, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KPTK',
   'https://www.flightaware.com/live/flight/N957CJ/history/20260407/2030Z/KYIP/KPTK'),
  ('ad6395', '2024-04-06T19:48:00Z', 'JUS962', 42.2403, -83.5315, null, null, null, true,
   'FlightAware', 'airport_last_arrival', 'KYIP',
   'https://www.flightaware.com/live/flight/N962AA/history/20240406/1900Z/KRFD/KYIP')
on conflict (icao24, seen_at) do update set
  callsign = excluded.callsign,
  lat = excluded.lat,
  lon = excluded.lon,
  on_ground = excluded.on_ground,
  source = excluded.source,
  location_kind = excluded.location_kind,
  airport_icao = excluded.airport_icao,
  source_url = excluded.source_url;

create or replace function cos.api_fleet_state(
  p_trail_minutes integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trail_cutoff timestamptz :=
    now() - make_interval(mins => greatest(p_trail_minutes, 5));
  v_active_cutoff timestamptz := now() - interval '2 months';
  v_live_cutoff timestamptz := now() - interval '15 minutes';
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'generated_at', now(),
    'active_cutoff', v_active_cutoff,
    'live_cutoff', v_live_cutoff,
    'aircraft', (
      select coalesce(
        jsonb_agg(a order by a.active_recent desc, a.tail),
        '[]'::jsonb
      )
      from (
        select
          f.icao24, f.tail, f.model, f.operator, f.source,
          f.source as roster_source, f.aircraft_family,
          f.service_status, f.status_as_of, f.status_note,
          f.status_source, f.status_source_url,
          coalesce(greatest(adsb.seen_at, arrival.seen_at), adsb.seen_at, arrival.seen_at)
            as latest_activity_at,
          coalesce(
            coalesce(
              greatest(adsb.seen_at, arrival.seen_at),
              adsb.seen_at,
              arrival.seen_at
            ) >= v_active_cutoff,
            false
          ) as active_recent,
          adsb.seen_at is not null
            and adsb.seen_at >= v_live_cutoff as live_now,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.seen_at
            else coalesce(arrival.seen_at, adsb.seen_at)
          end as seen_at,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.lat
            else coalesce(arrival.lat, adsb.lat)
          end as lat,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.lon
            else coalesce(arrival.lon, adsb.lon)
          end as lon,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.on_ground
            else arrival.seen_at is not null
          end as on_ground,
          coalesce(adsb.callsign, arrival.callsign) as callsign,
          case when adsb.seen_at >= v_live_cutoff then adsb.altitude_m end
            as altitude_m,
          case when adsb.seen_at >= v_live_cutoff then adsb.velocity_ms end
            as velocity_ms,
          case when adsb.seen_at >= v_live_cutoff then adsb.heading_deg end
            as heading_deg,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.source
            else coalesce(arrival.source, adsb.source)
          end as position_source,
          case
            when adsb.seen_at >= v_live_cutoff then adsb.location_kind
            else coalesce(arrival.location_kind, adsb.location_kind)
          end as location_kind,
          case when adsb.seen_at < v_live_cutoff or adsb.seen_at is null
            then arrival.airport_icao end as airport_icao,
          coalesce(
            arrival.source_url,
            'https://www.flightaware.com/live/flight/' || f.tail
          ) as source_url,
          adsb.seen_at as last_adsb_at,
          adsb.lat as last_adsb_lat,
          adsb.lon as last_adsb_lon,
          adsb.on_ground as last_adsb_on_ground,
          arrival.seen_at as last_arrival_at,
          arrival.airport_icao as last_arrival_airport,
          arrival.lat as last_arrival_lat,
          arrival.lon as last_arrival_lon,
          arrival.source_url as last_arrival_source_url
        from cos.fleet_aircraft f
        left join lateral (
          select q.*
          from cos.fleet_positions q
          where q.icao24 = f.icao24
            and q.location_kind = 'adsb_fix'
          order by q.seen_at desc
          limit 1
        ) adsb on true
        left join lateral (
          select q.*
          from cos.fleet_positions q
          where q.icao24 = f.icao24
            and q.location_kind = 'airport_last_arrival'
          order by q.seen_at desc
          limit 1
        ) arrival on true
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
                 )
                 order by q.seen_at
               ) as points
        from cos.fleet_positions q
        where q.seen_at >= v_trail_cutoff
          and q.lat is not null
          and q.location_kind = 'adsb_fix'
          and exists (
            select 1
            from cos.fleet_positions recent
            where recent.icao24 = q.icao24
              and recent.seen_at >= v_active_cutoff
          )
        group by q.icao24
      ) t
    ),
    'coverage', (
      select jsonb_build_object(
        'aircraft_tracked', count(*)::integer,
        'active_aircraft', count(*) filter (
          where exists (
            select 1
            from cos.fleet_positions p
            where p.icao24 = f.icao24
              and p.seen_at >= v_active_cutoff
          )
        )::integer,
        'historical_aircraft', count(*) filter (
          where not exists (
            select 1
            from cos.fleet_positions p
            where p.icao24 = f.icao24
              and p.seen_at >= v_active_cutoff
          )
        )::integer,
        'airborne_now', count(*) filter (
          where exists (
            select 1
            from cos.fleet_positions p
            where p.position_id = (
              select latest.position_id
              from cos.fleet_positions latest
              where latest.icao24 = f.icao24
                and latest.location_kind = 'adsb_fix'
              order by latest.seen_at desc
              limit 1
            )
              and p.seen_at >= v_live_cutoff
              and not p.on_ground
          )
        )::integer,
        'latest_fix_at', (
          select max(p.seen_at)
          from cos.fleet_positions p
        ),
        'source', 'airplanes.live ADS-B + FlightAware flight history',
        'position_source', 'mixed per-aircraft; see position_source',
        'roster_source', 'OpenSky aircraft registry + service-history review',
        'active_rule', 'Public flight evidence in the preceding two months',
        'basis', 'measured'
      )
      from cos.fleet_aircraft f
    )
  );
end
$$;

revoke all on function cos.api_fleet_state(integer)
  from public, anon, authenticated;
grant execute on function cos.api_fleet_state(integer) to authenticated;
