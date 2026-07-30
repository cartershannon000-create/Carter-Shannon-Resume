# Placement Sim — feature and implementation plan

Status: planned

Surface: OmniSupply → **Simulations**

Engine: SCKG positioning simulator, executed by the local CoS runner

Primary use: compare aircraft-placement strategies under the same plausible
business, maintenance, and weather conditions.

## 1. Decision this feature supports

Placement Sim should answer:

> Given this fleet, a stated level of trip opportunities, and routine
> operational disruption, which placement strategy serves more trips with less
> empty flying and a better normalized margin?

It is a scenario-comparison tool, not a prediction of USA Jet's bookings or
profit. Until PEAK mission data is available, every result remains
**Scenario only** and the assumed inputs remain visible.

The existing SCKG Model 5 simulator is the starting point. It already provides
a deterministic discrete-event engine, common random numbers, aircraft state
transitions, T-100 lane density, and replay output. Its deferred v1 validation
finding must be resolved or explicitly retained before results are exposed in
the dashboard. The new feature extends that engine with an interactive run
contract, the current fleet snapshot, normalized economics, routine weather,
and rare maintenance events.

## 2. User workflow

1. Open OmniSupply and select **Simulations**.
2. Select a horizon: **Day**, **Week**, or **Month**.
3. Select the number of simulation runs. A run is one independent replay of
   the full selected horizon.
4. Set the business level:
   - average trip opportunities per day;
   - probability of a zero-trip day;
   - daily maximum, hard-capped at 20;
   - optional quiet / normal / busy presets once calibrated.
5. Select a placement strategy:
   - **Random placement**
   - **LRD focused**
   - **YIP focused**
   - **Custom by aircraft**
6. Review the fleet and starting locations. The default roster is the current
   active fleet: public flight evidence within the preceding two months.
7. Optionally change weather, maintenance, revenue, and cost assumptions.
8. Run the simulation.
9. Compare median outcomes and the range across runs, then play any individual
   replay on the map.

The UI should call repetitions **Simulation runs**, not loops or cycles, so a
monthly horizon run is not confused with 30 daily runs.

## 3. Simulation contract

### Time and repetitions

- Horizon: 1 day, 7 days, or one calendar month.
- Event-driven engine with hourly replay frames.
- Suggested run presets: 25 quick, 100 standard, and 500 deep.
- Seed is retained with the result so every run is reproducible.
- Each strategy comparison consumes the same trip, weather, and maintenance
  tape. Strategy is the only changing variable.

### Fleet

- Fetch the active/historical classification and latest location from the
  owner-gated Supabase fleet state at run creation.
- Default to active aircraft only.
- Allow historical aircraft only behind an explicit **Include historical
  fleet** switch.
- Preserve the aircraft model and operating class on every tail.
- DC-9 aircraft remain useful historical context but are excluded by default
  because the DC-9 program has been sunset.
- A public last-known location is a starting-position input, not proof that an
  aircraft is dispatch-ready. The UI must say this beside the fleet selector.

Aircraft states:

- `AVAILABLE`
- `DEADHEAD`
- `LOADED`
- `TURNAROUND`
- `MAINTENANCE`
- `WEATHER_HOLD`

A tail may occupy exactly one state at any point in simulated time.

### Trip opportunities without PEAK

T-100 provides performed monthly flights and historical lane density. It does
not provide offered trips, passed trips, or actual request timestamps.
Therefore the demand model separates:

- **Where trips tend to originate and end:** historical U7 T-100 lane shares.
- **How many opportunities arrive:** user-controlled assumption, bounded from
  0 to 20 per day.
- **When they arrive:** synthetic arrival times within the chosen day.
- **What was passed:** a simulator outcome when no eligible tail can meet the
  response deadline, not a historical fact.

A zero-inflated bounded count model is preferable to an unbounded Poisson:

1. Draw whether the day has zero opportunities.
2. Otherwise draw 1–20 opportunities around the selected daily business
   level.
3. Draw each lane and aircraft class from the measured historical density.

This supports both zero-event days and the stated 20-event ceiling. Quiet,
normal, and busy presets should not be labeled calibrated until PEAK data
defines their actual distributions.

### Strategy definitions

| Strategy | Starting placement | After a loaded trip |
|---|---|---|
| Random | Random eligible station per tail | Stay or randomly reposition according to the seeded tape |
| LRD focused | Concentrate user-selected share at LRD | Empty-leg return to LRD when operationally feasible |
| YIP focused | Concentrate user-selected share at YIP | Empty-leg return to YIP when operationally feasible |
| Custom by aircraft | User assigns each tail to an airport | Per-tail choice: return home or stay at destination |

The existing SCKG `STAY` and `COVERAGE` policies can remain internal
benchmarks and become later advanced strategies. They are not required in the
first user-facing release.

### Mission assignment and passed trips

When a trip request arrives:

1. Find aircraft with a suitable operating class.
2. Exclude aircraft in maintenance or weather hold.
3. Calculate deadhead time from each remaining aircraft to the trip origin.
4. Assign the feasible aircraft with the best response time, using residual
   network coverage as a stable tie-break.
5. Run the origin turnaround, loaded leg, and destination turnaround.
6. Apply the strategy's return, stay, or reposition rule.
7. If no aircraft can meet the response deadline, record the trip as passed
   with a reason: no available aircraft, wrong aircraft class, too far away,
   maintenance, or weather.

Every opportunity must end in exactly one state: served, passed, or
weather-cancelled.

## 4. Normalized revenue, cost, fuel, and margin

The simulator must not show dollar signs until actual trip economics are
available. It should use an explicit **Operating Economics Index**.

### Revenue index

- Each opportunity receives a seeded revenue value from 1–100.
- The same opportunity keeps the same revenue value under every strategy.
- The user can set a mean and variability or select a low / normal / high
  revenue mix.
- Distance, payload class, and aircraft requirement can influence the default
  revenue tier, but the rule remains an assumption until PEAK calibration.

### Cost index

Use relative aircraft-type weights rather than claiming actual gallons or
dollars:

```text
mission cost =
  loaded block hours × aircraft operating weight
  + deadhead block hours × aircraft operating weight
  + turnaround cost
  + weather delay penalty
  + maintenance allocation
```

The component total is normalized to a 1–100 trip cost index. Initial
aircraft weights cover the current classes:

- Falcon 20: baseline relative operating weight
- MD-83 / MD-88: higher relative operating weight
- Boeing 727: highest relative operating weight

Exact weights are configurable estimates and need a sourced calibration pass
before implementation. If a historical DC-9 is enabled, it receives its own
estimated weight and an inactive-fleet warning.

### Margin

```text
margin index = revenue index - assignment-specific cost index
```

The result can be negative. The dashboard should show:

- total revenue-index points;
- total operating-cost-index points;
- total margin-index points;
- average margin index per served trip;
- margin distribution across simulation runs.

This lets placement strategies be compared realistically: a strategy can
serve more work but lose margin through excessive empty flying.

## 5. Random operational events

### Maintenance

- Support planned maintenance entered by tail and date/time.
- Add an optional rare unplanned-maintenance probability per tail-day.
- Draw event duration from an editable short-duration range.
- Maintenance removes a tail from service; it does not manufacture a
  historical claim about that aircraft.
- Default frequency must remain low and visibly marked as an assumption until
  actual maintenance logs are supplied.

### Weather

The default weather model represents routine operations:

- delay: most common;
- localized cancellation or temporary airport closure: less common;
- severe network event: off by default and available only as an advanced
  stress scenario.

Weather affects an airport or leg for a defined time and can add delay,
prevent assignment, or cancel the opportunity. Historical station/month
weather frequency may later be calibrated from NOAA data, but the operational
impact remains estimated without dispatch records.

Weather and maintenance events are generated before policy comparison, so all
strategies face the same disruptions.

## 6. Simulations tab UX

Suggested page structure:

```text
┌ Simulations ────────────────────────────────────────────────────────┐
│ Day / Week / Month   Runs: 100   Seed   [Run simulation]          │
│ Business level   Zero-day chance   Maximum trips/day: 20          │
├ Strategy ──────────────────────────────────────────────────────────┤
│ Random       LRD focused       YIP focused       Custom by tail    │
├ Fleet & starting placement ──────────────── Advanced assumptions ─┤
│ Active tails on movable map                 Weather               │
│ Tail list + airport assignment              Maintenance           │
│ [ ] Include historical fleet                Economics index       │
├ Results ───────────────────────────────────────────────────────────┤
│ Served  Passed  Empty-leg %  Utilization  Revenue  Cost  Margin   │
│ Median with P10–P90 range across runs                             │
│                                                                 │
│ Animated placement map + play/scrub timeline                     │
│ Strategy comparison | Tail timeline | Event log | Assumptions    │
└───────────────────────────────────────────────────────────────────┘
```

Key behavior:

- The run button stays disabled until the configuration is valid.
- The active fleet map reuses the current movable, zoomable Company map
  behavior.
- Custom placement supports map selection and an accessible airport dropdown.
- Results lead with median and P10–P90, not a single lucky replay.
- Selecting a point or percentile opens that exact seeded replay.
- The event log explains why each opportunity was served, passed, delayed, or
  cancelled.
- A visible assumptions drawer accompanies every result and can recreate the
  run.

### Confidence presentation

The result header reads **Scenario only**. The assumptions panel breaks out
input confidence:

| Input | Display |
|---|---|
| T-100 lane density | High confidence — measured public data |
| Fleet last-known position | High confidence — public last-known observation |
| Dispatch availability | Low confidence — not observed |
| Offered trip volume and passed trips | Low confidence — user scenario |
| Revenue index | Low confidence — normalized assumption |
| Aircraft operating weights | Low confidence until sourced and reviewed |
| Weather frequency | Moderate after public weather calibration; otherwise low |
| Maintenance frequency | Low confidence without company records |
| Simulation result | Scenario only |

Permanent UI statement:

> We do not predict a mission. We compare placement policies against measured
> historical flow density and the assumptions shown here.

## 7. System architecture

Longer simulations should use the existing governed execution path rather
than run in the browser:

```text
Simulations tab
    → owner-gated Supabase RPC creates a simulation job
    → local CoS runner leases the job
    → SCKG builds one shared event tape and runs each strategy
    → summary rows return to Supabase
    → replay artifact is stored separately
    → dashboard polls or subscribes until the result is ready
```

Recommended durable records:

- `cos.simulation_runs`: owner, status, configuration, seed set, engine
  version, data-as-of dates, frozen fleet snapshot, progress, error, and
  aggregate result.
- `cos.simulation_cycle_results`: one compact KPI row per strategy and run.
- Supabase Storage replay artifact: hourly tail frames and event log. Avoid
  placing a large replay document in a relational row.

Recommended private RPCs:

- `api_simulation_create(config)`
- `api_simulation_state(run_id)`
- `api_simulation_result(run_id)`
- `api_simulation_cancel(run_id)`

All tables, functions, and artifacts remain owner-gated. The frozen input
snapshot and engine/config version make old results reproducible even after
fleet or model changes.

## 8. Delivery phases

### Phase 0 — reconcile the deferred engine

- Bring the useful work from `origin/packet/p8-simulator` onto a clean branch.
- Preserve the documented V1 validation failure as a visible finding until
  its cause is resolved; do not tune a parameter only to force a pass.
- Replace its assumed 20-tail envelope with the current, dynamically fetched
  fleet snapshot.
- Keep deterministic seeds, common random numbers, accounting conservation,
  and replay generation.

### Phase 1 — interactive placement MVP

- Add the **Simulations** tab and run form.
- Support day/week/month, run count, trip-volume inputs, and the four required
  placement strategies.
- Add active-fleet starting positions and custom per-tail assignment.
- Add empty-leg behavior and passed-trip reasons.
- Add the normalized revenue, cost, and margin indexes.
- Execute through the local runner and retain the result in Supabase.
- Render KPI distributions and one replay on the map.

### Phase 2 — disruption model and comparison UX

- Add rare maintenance and routine weather events.
- Add side-by-side strategies using identical event tapes.
- Add P10–P90 distributions, tail timelines, event inspection, saved
  scenarios, and run duplication.

### Phase 3 — calibration

- Add PEAK mission-log ingestion when available.
- Replace synthetic request timing, trip-volume assumptions, and passed-trip
  inference with observed distributions.
- Calibrate response deadlines, revenue/cost inputs, maintenance, and weather
  impacts from company data.
- Reassess confidence labels; do not automatically promote scenario output to
  a measured forecast.

### Phase 4 — optimization

- Add the existing coverage-optimal policy as an advanced strategy.
- Search candidate starting placements and return the best robust policy,
  including tradeoffs and uncertainty.

## 9. Validation and acceptance gates

Engine:

- Same seed and configuration produce byte-equivalent demand/event tapes.
- Every strategy in a comparison uses the same opportunity and disruption
  tape.
- No generated day exceeds 20 trip opportunities.
- A configured zero-trip probability produces and retains zero-trip days.
- Every opportunity is served, passed, or weather-cancelled exactly once.
- A tail can never fly two missions or occupy two states simultaneously.
- Deadhead, loaded, turnaround, maintenance, and weather durations cannot
  overlap illegally.
- Revenue minus cost equals margin for every mission and aggregate.
- Changing strategy cannot change a mission's revenue value.
- Historical lane draws reproduce configured T-100 lane shares within
  tolerance over sufficiently large samples.

Product:

- Active fleet is the default and historical aircraft are hidden initially.
- The run can be recreated from its frozen config, seeds, engine version, and
  fleet snapshot.
- Progress and terminal errors appear in the Simulations tab without a page
  refresh.
- A failed run never renders partial numbers as a completed result.
- Confidence and assumptions remain visible in screenshots and exported
  reports.
- Keyboard users can configure custom placements and control replay.

Performance targets for the MVP:

- 25-run day/week scenarios feel interactive.
- A 100-run standard scenario completes within a practical local-runner
  window and continuously reports progress.
- Large replay artifacts load on demand rather than blocking the initial
  results view.

## 10. Decisions intentionally deferred

- Exact quiet / normal / busy trip-volume defaults.
- Exact aircraft operating and fuel weights.
- Actual revenue or dollar cost.
- Crew scheduling and duty legality.
- Customer, booking, and trip-priority behavior.
- Actual maintenance rates and duration distributions.
- Severe-weather scenarios beyond routine delay and cancellation.

Those decisions require PEAK, dispatch, finance, maintenance, or externally
sourced calibration data. The MVP keeps each value editable and records it
with the run instead of hiding it in code.
