-- Ownership registries include retired aircraft and parts donors. Preserve
-- those airframes for historical metrics without presenting them as current
-- USA Jet fleet capacity on the Company page.

alter table cos.fleet_aircraft
  add column if not exists aircraft_family text not null default 'unknown',
  add column if not exists service_status text not null
    default 'current_inventory',
  add column if not exists status_as_of date,
  add column if not exists status_note text,
  add column if not exists status_source text,
  add column if not exists status_source_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fleet_aircraft_service_status_check'
      and conrelid = 'cos.fleet_aircraft'::regclass
  ) then
    alter table cos.fleet_aircraft
      add constraint fleet_aircraft_service_status_check
      check (
        service_status in (
          'current_inventory', 'parked', 'retired',
          'parts_donor', 'scrapped'
        )
      );
  end if;
end
$$;

update cos.fleet_aircraft
set aircraft_family = case
      when tail = 'N195US' then 'dc_9'
      when tail in ('N726US', 'N727US') then 'boeing_727'
      when tail in ('N811AA', 'N822AA', 'N827AA', 'N957CJ', 'N962AA')
        then 'falcon_20'
      when tail = 'N831US' then 'md_83'
      when tail in (
        'N832US', 'N833US', 'N834US', 'N835US', 'N836US', 'N837US',
        'N842US', 'N912DL', 'N915DE', 'N917DL', 'N959DL'
      ) then 'md_88'
      else 'unknown'
    end,
    service_status = 'current_inventory',
    active = true,
    status_as_of = null,
    status_note = null,
    status_source = null,
    status_source_url = null,
    updated_at = now()
where operator = 'USA Jet Airlines';

update cos.fleet_aircraft
set service_status = 'retired',
    active = false,
    status_as_of = date '2023-12-31',
    status_note = 'USA Jet sunset its DC-9 program; the final DC-9 aircraft were withdrawn during 2023.',
    status_source = 'User-confirmed; Flightradar24 fleet review',
    status_source_url =
      'https://www.flightradar24.com/blog/aircraft-stories/where-you-can-still-find-a-mad-dog-in-the-us/',
    updated_at = now()
where tail = 'N195US';

update cos.fleet_aircraft
set service_status = 'parts_donor',
    active = false,
    status_as_of = date '2021-06-30',
    status_note = 'Acquired with other former Delta MD-88 airframes for spare-parts support, not operating fleet capacity.',
    status_source = 'Flightradar24 fleet review',
    status_source_url =
      'https://www.flightradar24.com/blog/aircraft-stories/where-you-can-still-find-a-mad-dog-in-the-us/',
    updated_at = now()
where tail in ('N912DL', 'N915DE', 'N917DL', 'N959DL');

comment on column cos.fleet_aircraft.aircraft_family is
  'Stable family used for fleet-history metrics, independent of inconsistent registry model labels.';
comment on column cos.fleet_aircraft.service_status is
  'Current-inventory and historical role; active controls Company-page inclusion.';
comment on column cos.fleet_aircraft.status_note is
  'Human-readable reason an airframe is current, parked, retired, a parts donor, or scrapped.';

create or replace view cos.fleet_inventory_metrics
with (security_invoker = true)
as
select
  operator,
  aircraft_family,
  service_status,
  active,
  count(*)::integer as aircraft_count
from cos.fleet_aircraft
group by operator, aircraft_family, service_status, active;

revoke all on cos.fleet_inventory_metrics from public, anon, authenticated;
grant select on cos.fleet_inventory_metrics to service_role;

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
               f.source as roster_source, f.aircraft_family,
               f.service_status,
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
        join cos.fleet_aircraft f
          on f.icao24 = q.icao24 and f.active
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
          select count(distinct q.icao24)
          from cos.fleet_positions q
          join cos.fleet_aircraft f
            on f.icao24 = q.icao24 and f.active
        ),
        'aircraft_seen_recently', (
          select count(distinct q.icao24)
          from cos.fleet_positions q
          join cos.fleet_aircraft f
            on f.icao24 = q.icao24 and f.active
          where q.seen_at >= v_cutoff
        ),
        'latest_fix_at', (
          select max(q.seen_at)
          from cos.fleet_positions q
          join cos.fleet_aircraft f
            on f.icao24 = q.icao24 and f.active
        ),
        'source', 'airplanes.live ADS-B + FlightAware last-known arrivals',
        'position_source', 'mixed per-aircraft; see position_source',
        'roster_source', 'OpenSky aircraft registry + service-status review',
        'basis', 'measured'
      )
    )
  );
end
$$;

revoke all on function cos.api_fleet_state(integer) from public, anon;
grant execute on function cos.api_fleet_state(integer) to authenticated;
