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

## Financials (`fin` schema)

Applied 2026-08-09 through the Supabase MCP. Local filenames match the live
versions exactly, so these three add no new drift:

- `20260809160558_fin_schema.sql`
- `20260809160923_fin_read_helpers.sql`
- `20260809161007_fin_insights_and_api.sql`

`fin` holds personal financial data and is deliberately separate from `cos`.

The runner authenticates as `service_role`, which has BYPASSRLS — so RLS does
**not** keep it out of this data. Grants do. `service_role` is never granted
USAGE on `fin` and never granted anything on its tables or functions, and the
migration adds explicit revokes plus closed default privileges. Verify with:

    select has_schema_privilege('service_role','fin','USAGE');   -- must be false

Only `fin.api_financial_state()` and `fin.api_set_category()` are executable,
by `authenticated` only, both gated on `cos.is_owner()`. The aggregation helpers
(`summary`, `cashflow`, `insights`, `monthly_summary`, `complete_months`,
`money0`) and the `v_transactions` view are granted to nobody and are reachable
only from those two entry points.

The `rls_enabled_no_policy` advisor notices on `fin.*` are expected and match
the `cos` tables: RLS on with no policies, access via owner-gated RPC only.

Ingest does not use `service_role` either. The `fin_ingest` role is created
NOLOGIN so no credential lands in a committed file; set its password out of band
and store it as a Supabase function secret.

Still to port: `extend_monthly_summary_with_actuals()` and
`reconcile_salary_rows()` from `build_financial_dashboard.py`. Until then
`fin.monthly_summary()` serves stored values, so a Review override that moves a
transaction into or out of `salary` will not move the Salary, Net Income,
Margin, or Total Savings rows.

### Exposed schemas

PostgREST will only route to `fin` if the schema is on its allowlist. This is
separate from database grants -- both must pass. Check the live value with:

    select s.setconfig from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';

It must contain `fin`:

    pgrst.db_schemas = public, graphql_public, audit, cos, fin

On 2026-08-09 the dashboard's Exposed Schemas control did not persist the
change -- Postgres still held the list without `fin`, so every Financials RPC
returned `PGRST106 Invalid schema: fin`. It was set directly instead:

    alter role authenticator set pgrst.db_schemas = 'public, graphql_public, audit, cos, fin';
    notify pgrst, 'reload config';
    notify pgrst, 'reload schema';

Both notifies are needed: the first reloads the schema allowlist, the second
rebuilds the function cache (without it the RPCs 404 with `PGRST202` even
though routing works).

CAUTION: the Supabase control plane keeps its own copy of this setting and may
re-apply it on a project restart or the next save on the API settings page. If
its copy still lacks `fin`, that reconcile silently breaks the Financials tab.
Re-save the value through the dashboard so both sides agree.
