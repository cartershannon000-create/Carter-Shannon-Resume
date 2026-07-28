-- Refresh USA Jet positions inside Supabase so fleet tracking does not depend
-- on a laptop process remaining online.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create or replace function cos.fleet_sweep(p_radius integer default 250)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points jsonb :=
    '[[42.24,-83.53],[39.71,-86.29],[38.17,-85.73],
      [32.90,-97.03],[27.54,-99.46],[31.80,-106.37]]'::jsonb;
  v_point jsonb;
  v_body text;
  v_ac jsonb;
  v_scanned integer := 0;
  v_matched integer := 0;
  v_written integer := 0;
  v_alt text;
  v_hex text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');

  for v_point in select * from jsonb_array_elements(v_points) loop
    begin
      select content into v_body
      from extensions.http_get(
        format(
          'https://api.airplanes.live/v2/point/%s/%s/%s',
          v_point->>0,
          v_point->>1,
          p_radius
        )
      );
    exception when others then
      continue;
    end;

    for v_ac in
      select * from jsonb_array_elements((v_body::jsonb)->'ac')
    loop
      v_scanned := v_scanned + 1;
      v_hex := lower(btrim(coalesce(v_ac->>'hex', '')));
      if v_hex = '' then continue; end if;

      if not (
        exists (
          select 1
          from cos.fleet_aircraft f
          where f.icao24 = v_hex and f.active
        )
        or upper(coalesce(v_ac->>'ownOp', '')) like '%USA JET AIRLINES%'
        or upper(btrim(coalesce(v_ac->>'flight', ''))) like 'JUS%'
      ) then
        continue;
      end if;

      v_matched := v_matched + 1;
      v_alt := v_ac->>'alt_baro';

      insert into cos.fleet_aircraft
        (icao24, tail, model, operator, source, active, updated_at)
      values (
        v_hex,
        nullif(btrim(coalesce(v_ac->>'r', '')), ''),
        nullif(btrim(coalesce(v_ac->>'desc', '')), ''),
        'USA Jet Airlines',
        'adsb_owner',
        true,
        now()
      )
      on conflict (icao24) do update
      set tail = coalesce(cos.fleet_aircraft.tail, excluded.tail),
          model = coalesce(cos.fleet_aircraft.model, excluded.model),
          updated_at = now();

      insert into cos.fleet_positions
        (icao24, seen_at, callsign, lat, lon, altitude_m, velocity_ms,
         heading_deg, on_ground)
      values (
        v_hex,
        now() - make_interval(
          secs => coalesce((v_ac->>'seen')::numeric, 0)
        ),
        nullif(btrim(coalesce(v_ac->>'flight', '')), ''),
        (v_ac->>'lat')::double precision,
        (v_ac->>'lon')::double precision,
        case
          when v_alt = 'ground' then 0
          when v_alt ~ '^-?[0-9.]+$'
            then (v_alt::double precision) * 0.3048
        end,
        (v_ac->>'gs')::double precision * 0.514444,
        coalesce(
          (v_ac->>'track')::double precision,
          (v_ac->>'dir')::double precision
        ),
        v_alt = 'ground'
      )
      on conflict (icao24, seen_at) do nothing;

      if found then v_written := v_written + 1; end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'matched', v_matched,
    'written', v_written,
    'swept_at', now()
  );
end
$$;

revoke all on function cos.fleet_sweep(integer)
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'fleet-sweep'
  ) then
    perform cron.schedule(
      'fleet-sweep',
      '*/15 * * * *',
      'select cos.fleet_sweep();'
    );
  end if;
end
$$;
