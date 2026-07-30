import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type LiveAircraft = {
  hex?: string;
  flight?: string | null;
  lat?: number | null;
  lon?: number | null;
  seen_pos?: number | null;
  lastPosition?: {
    lat?: number | null;
    lon?: number | null;
    seen_pos?: number | null;
  } | null;
  alt_baro?: number | "ground" | null;
  gs?: number | null;
  track?: number | null;
};

type LiveResponse = {
  ac?: LiveAircraft[];
  now?: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error("missing bearer token");
  return match[1].trim();
}

function airplanesLiveBaseUrl(): string {
  if (
    requiredEnv("AIRPLANES_LIVE_TERMS_REVIEWED").toLowerCase() !== "true"
  ) {
    throw new Error(
      "airplanes.live terms must be reviewed before enabling fleet refresh",
    );
  }
  return requiredEnv("AIRPLANES_LIVE_API_BASE_URL").replace(/\/+$/, "");
}

function positionFrom(aircraft: LiveAircraft) {
  if (
    typeof aircraft.lat === "number" && Number.isFinite(aircraft.lat) &&
    typeof aircraft.lon === "number" && Number.isFinite(aircraft.lon) &&
    typeof aircraft.seen_pos === "number" &&
    Number.isFinite(aircraft.seen_pos)
  ) {
    return {
      lat: aircraft.lat,
      lon: aircraft.lon,
      secondsAgo: Math.max(0, aircraft.seen_pos),
    };
  }
  const prior = aircraft.lastPosition;
  if (
    typeof prior?.lat === "number" && Number.isFinite(prior.lat) &&
    typeof prior?.lon === "number" && Number.isFinite(prior.lon) &&
    typeof prior?.seen_pos === "number" && Number.isFinite(prior.seen_pos)
  ) {
    return {
      lat: prior.lat,
      lon: prior.lon,
      secondsAgo: Math.max(0, prior.seen_pos),
    };
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "cos" },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser(
      bearerToken(request),
    );
    if (authError || !authData.user) {
      return json({ error: "unauthorized" }, 401);
    }
    const { data: owner, error: ownerError } = await supabase
      .from("control_owners")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) {
      return json({ error: "forbidden" }, 403);
    }

    const { data: fleet, error: fleetError } = await supabase
      .from("fleet_aircraft")
      .select("icao24")
      .eq("active", true)
      .eq("service_status", "current_inventory");
    if (fleetError) throw fleetError;

    const roster = [
      ...new Set(
        (fleet ?? [])
          .map((row) => String(row.icao24 ?? "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ].sort();
    if (roster.length === 0) {
      throw new Error("cos.fleet_aircraft returned no active icao24s");
    }

    const sourceBaseUrl = airplanesLiveBaseUrl();
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_fleet_refresh",
      { p_min_interval_seconds: 60 },
    );
    if (claimError) throw claimError;
    if (!claimed) {
      const { data: lastKnown, error: lastKnownError } = await supabase
        .from("fleet_last_known")
        .select(
          "position_id,icao24,seen_at,callsign,lat,lon,altitude_m,velocity_ms,heading_deg,on_ground,captured_at,source,location_kind,airport_icao,source_url,age_seconds",
        )
        .order("icao24");
      if (lastKnownError) throw lastKnownError;
      return json({
        requested_at: new Date().toISOString(),
        roster_count: roster.length,
        observed_count: 0,
        skipped: "debounced",
        last_known: lastKnown,
      });
    }

    const sourceUrl = `${sourceBaseUrl}/v2/hex/${
      encodeURIComponent(roster.join(","))
    }`;
    // The roster is deliberately sent as one request: one view must not become
    // twenty upstream polls merely because the database stores twenty tails.
    const liveResponse = await fetch(sourceUrl, {
      headers: { "User-Agent": "SCKG fleet-refresh/1.0" },
    });
    if (!liveResponse.ok) {
      throw new Error(
        `airplanes.live returned ${liveResponse.status} ${liveResponse.statusText}`,
      );
    }
    const live = (await liveResponse.json()) as LiveResponse;
    if (typeof live.now !== "number" || !Number.isFinite(live.now)) {
      throw new Error("airplanes.live response omitted its data timestamp");
    }
    const feedNowMs = live.now > 10_000_000_000 ? live.now : live.now * 1000;

    const rosterSet = new Set(roster);
    const capturedAt = new Date();
    const positions = await Promise.all(
      (live.ac ?? [])
        .filter((aircraft) =>
          rosterSet.has(String(aircraft.hex ?? "").toLowerCase())
        )
        .map((aircraft) => ({ aircraft, position: positionFrom(aircraft) }))
        .filter(({ position }) => position !== null)
        .map(({ aircraft, position }) => {
          const icao24 = String(aircraft.hex).toLowerCase();
          // `seen_at` is anchored to the feed's `now`, never the function clock.
          const seenAt = new Date(feedNowMs - position!.secondsAgo * 1000)
            .toISOString();
          const onGround = aircraft.alt_baro === "ground";
          const altitudeM = onGround
            ? 0
            : typeof aircraft.alt_baro === "number"
            ? aircraft.alt_baro * 0.3048
            : null;
          return {
            icao24: icao24,
            seen_at: seenAt,
            callsign: aircraft.flight?.trim() || null,
            lat: position!.lat,
            lon: position!.lon,
            altitude_m: altitudeM,
            velocity_ms: typeof aircraft.gs === "number"
              ? aircraft.gs * 0.514444
              : null,
            heading_deg: aircraft.track ?? null,
            on_ground: onGround,
            captured_at: capturedAt.toISOString(),
            source: "airplanes.live ADS-B",
            location_kind: "adsb_fix",
            airport_icao: null,
            source_url: sourceUrl,
          };
        }),
    );

    if (positions.length > 0) {
      const { error: positionError } = await supabase
        .from("fleet_positions")
        .upsert(positions, { onConflict: "icao24,seen_at" });
      if (positionError) throw positionError;
    }

    const requestedAt = new Date();
    const { data: lastKnown, error: lastKnownError } = await supabase
      .from("fleet_last_known")
      .select(
        "position_id,icao24,seen_at,callsign,lat,lon,altitude_m,velocity_ms,heading_deg,on_ground,captured_at,source,location_kind,airport_icao,source_url,age_seconds",
      )
      .order("icao24");
    if (lastKnownError) throw lastKnownError;

    return json({
      requested_at: requestedAt.toISOString(),
      roster_count: roster.length,
      observed_count: positions.length,
      last_known: lastKnown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "refresh_failed", detail: message }, 500);
  }
});
