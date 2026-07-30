# Supabase migration safety

The live project and this directory have historical migration-version drift.
Do not run `supabase db push` or repair migration history by assumption.

The four OmniSupply migrations applied on 2026-07-27 and 2026-07-28 are now
captured locally with their live version IDs:

- `20260727181952_omnisupply_tables_and_state_rpc.sql`
- `20260727201106_omnisupply_chat_reports_fleet.sql`
- `20260727201151_omnisupply_chat_reports_fleet_rpcs.sql`
- `20260728035347_fleet_sweep_in_database.sql`

Six forward fixes are tracked locally and require production-state verification:

- `20260728170000_omnisupply_publish_contract.sql`
- `20260728171000_fleet_source_contract.sql`
- `20260728230000_fleet_position_provenance.sql`
- `20260728231500_fleet_service_history.sql`
- `20260730010000_chat_provider_selector.sql`
- `20260730020000_fleet_refresh_and_snapshot_retention.sql`

Before deployment:

1. Compare `supabase migration list --linked` with this directory.
2. Review the SQL diff and back up the affected schema.
3. Apply only the reviewed forward migrations through the approved human-gated
   migration path.
4. Re-run Supabase security advisors and the dashboard test suite.
5. Do not mark history repaired until every older live version has a reviewed
   local counterpart or an explicitly documented supersession.

The OmniSupply tables deliberately use RLS with no direct app policies. Browser
access is through owner-gated `SECURITY DEFINER` RPCs with an empty
`search_path`. Anonymous users have neither schema access nor function grants.

## Fleet refresh

The dashboard's on-view fleet refresh is owned here:

- `functions/fleet-refresh/index.ts` contains the authenticated Edge Function.
- `migrations/20260730020000_fleet_refresh_and_snapshot_retention.sql`
  contains its database view, debounce RPC, and bounded snapshot-retention RPC.

Deploy the migration through the reviewed migration path before deploying the
function. The function must keep JWT verification enabled and also validates
that the caller is present in `cos.control_owners`.

The upstream ADS-B feed remains disabled until both
`AIRPLANES_LIVE_TERMS_REVIEWED=true` and `AIRPLANES_LIVE_API_BASE_URL` are set
in the Supabase function environment after a terms/licensing review. Do not
commit those values.
