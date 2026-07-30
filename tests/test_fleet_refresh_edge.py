from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FUNCTION = ROOT / "supabase" / "functions" / "fleet-refresh"
SOURCE = (FUNCTION / "index.ts").read_text()
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260730020000_fleet_refresh_and_snapshot_retention.sql"
).read_text()


def test_edge_function_is_packaged_with_strict_deno_config():
    assert (FUNCTION / "deno.json").is_file()
    assert '"strict": true' in (FUNCTION / "deno.json").read_text()
    assert 'Deno.serve(async (request)' in SOURCE


def test_edge_function_requires_an_authenticated_owner():
    assert "supabase.auth.getUser" in SOURCE
    assert '.from("control_owners")' in SOURCE
    assert '{ error: "unauthorized" }' in SOURCE
    assert '{ error: "forbidden" }' in SOURCE


def test_edge_function_filters_to_current_inventory_and_debounces():
    assert '.from("fleet_aircraft")' in SOURCE
    assert '.eq("active", true)' in SOURCE
    assert '.eq("service_status", "current_inventory")' in SOURCE
    assert '"claim_fleet_refresh"' in SOURCE
    assert "p_min_interval_seconds: 60" in SOURCE


def test_edge_function_requires_terms_gate_and_one_roster_request():
    assert 'requiredEnv("AIRPLANES_LIVE_TERMS_REVIEWED")' in SOURCE
    assert 'requiredEnv("AIRPLANES_LIVE_API_BASE_URL")' in SOURCE
    assert "encodeURIComponent(roster.join(\",\"))" in SOURCE
    assert SOURCE.count("await fetch(") == 1


def test_migration_limits_live_view_and_snapshot_retention():
    assert "create or replace view cos.fleet_last_known" in MIGRATION
    assert "a.service_status = 'current_inventory'" in MIGRATION
    assert "create or replace function cos.claim_fleet_refresh" in MIGRATION
    assert "create or replace function cos.prune_omnisupply_snapshots" in MIGRATION
    assert "recent_rank > p_keep_recent" in MIGRATION
    assert "and not is_current" in MIGRATION
