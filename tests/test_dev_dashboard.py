import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGIN = ROOT / "dev" / "login"
MIGRATION = ROOT / "supabase" / "migrations" / "20260712164133_add_control_dashboard_metrics.sql"
RECOVERY_MIGRATION = ROOT / "supabase" / "migrations" / "20260713143054_agent_failure_recovery_protocol.sql"
PROGRESS_MIGRATION = ROOT / "supabase" / "migrations" / "20260713150000_job_progress_live.sql"
START_PROVIDER_MIGRATION = ROOT / "supabase" / "migrations" / "20260714011441_selectable_start_provider.sql"
QUALITY_MIGRATION = ROOT / "supabase" / "migrations" / "20260714191119_delivery_quality_gate.sql"
QUALITY_SECURITY_MIGRATION = ROOT / "supabase" / "migrations" / "20260714233532_secure_quality_telemetry.sql"
OMNISUPPLY_MIGRATION = ROOT / "supabase" / "migrations" / "20260727181952_omnisupply_tables_and_state_rpc.sql"
OMNISUPPLY_SURFACES_MIGRATION = ROOT / "supabase" / "migrations" / "20260727201106_omnisupply_chat_reports_fleet.sql"
OMNISUPPLY_RPCS_MIGRATION = ROOT / "supabase" / "migrations" / "20260727201151_omnisupply_chat_reports_fleet_rpcs.sql"
FLEET_SWEEP_MIGRATION = ROOT / "supabase" / "migrations" / "20260728035347_fleet_sweep_in_database.sql"
PUBLISH_CONTRACT_MIGRATION = ROOT / "supabase" / "migrations" / "20260728170000_omnisupply_publish_contract.sql"
FLEET_SOURCE_MIGRATION = ROOT / "supabase" / "migrations" / "20260728171000_fleet_source_contract.sql"
FLEET_PROVENANCE_MIGRATION = ROOT / "supabase" / "migrations" / "20260728230000_fleet_position_provenance.sql"
FLEET_HISTORY_MIGRATION = ROOT / "supabase" / "migrations" / "20260728231500_fleet_service_history.sql"
CHAT_FAILURE_MIGRATION = ROOT / "supabase" / "migrations" / "20260730170000_chat_failure_visibility.sql"
CHAT_MANAGEMENT_MIGRATION = ROOT / "supabase" / "migrations" / "20260730210000_chat_management_and_reports.sql"
FLEET_ACTIVITY_MIGRATION = ROOT / "supabase" / "migrations" / "20260730230000_fleet_recent_activity_and_flightaware_sync.sql"
FIN_SCHEMA_MIGRATION = ROOT / "supabase" / "migrations" / "20260809160558_fin_schema.sql"
FIN_API_MIGRATION = ROOT / "supabase" / "migrations" / "20260809161007_fin_insights_and_api.sql"
FIN_FRAME = LOGIN / "financials-frame.html"


class DevDashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (LOGIN / "index.html").read_text(encoding="utf-8")
        cls.js = (LOGIN / "app.js").read_text(encoding="utf-8")
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.recovery_sql = RECOVERY_MIGRATION.read_text(encoding="utf-8")
        cls.progress_sql = PROGRESS_MIGRATION.read_text(encoding="utf-8")
        cls.start_provider_sql = START_PROVIDER_MIGRATION.read_text(encoding="utf-8")
        cls.quality_sql = QUALITY_MIGRATION.read_text(encoding="utf-8")
        cls.quality_security_sql = QUALITY_SECURITY_MIGRATION.read_text(encoding="utf-8")
        cls.omnisupply_sql = OMNISUPPLY_MIGRATION.read_text(encoding="utf-8")
        cls.omnisupply_surfaces_sql = OMNISUPPLY_SURFACES_MIGRATION.read_text(encoding="utf-8")
        cls.omnisupply_rpcs_sql = OMNISUPPLY_RPCS_MIGRATION.read_text(encoding="utf-8")
        cls.fleet_sweep_sql = FLEET_SWEEP_MIGRATION.read_text(encoding="utf-8")
        cls.publish_contract_sql = PUBLISH_CONTRACT_MIGRATION.read_text(encoding="utf-8")
        cls.fleet_source_sql = FLEET_SOURCE_MIGRATION.read_text(encoding="utf-8")
        cls.fleet_provenance_sql = FLEET_PROVENANCE_MIGRATION.read_text(encoding="utf-8")
        cls.fleet_history_sql = FLEET_HISTORY_MIGRATION.read_text(encoding="utf-8")
        cls.chat_failure_sql = CHAT_FAILURE_MIGRATION.read_text(encoding="utf-8")
        cls.chat_management_sql = CHAT_MANAGEMENT_MIGRATION.read_text(encoding="utf-8")
        cls.fleet_activity_sql = FLEET_ACTIVITY_MIGRATION.read_text(encoding="utf-8")

    def test_dashboard_tabs_are_grouped_by_application(self):
        tabs = re.findall(r'data-tab="([^"]+)"', self.html)
        self.assertEqual(
            tabs,
            [
                "overview", "clients", "finances", "calendar", "metrics",
                "work", "agents", "usage", "approvals", "system",
                "chats", "reports", "company", "simulations", "omni-system",
                "fin-overview", "fin-forecast", "fin-monthly", "fin-cashflow", "fin-analytics",
                "fin-review", "fin-amex", "fin-capital-one", "fin-checking",
                "fin-venmo", "fin-wells-fargo",
            ],
        )
        self.assertIn(
            "omnisupply:['chats','reports','company','simulations','omni-system']",
            self.js,
        )
        self.assertIn("financials:['fin-overview',", self.js)

    def test_every_routed_panel_has_a_lazy_renderer(self):
        app_tabs = self.js.split("const APP_TABS={", 1)[1].split("};", 1)[0]
        routed_tabs = set(re.findall(r"'([a-z-]+)'", app_tabs))
        fin_tabs = set(re.findall(r"'(fin-[a-z-]+)':", self.js))
        routed_panels = {"fin-dashboard" if tab in fin_tabs else tab for tab in routed_tabs}
        registry = self.js.split("const PANEL_RENDERERS={", 1)[1].split("};", 1)[0]
        registry_panels = set(re.findall(r"^\s{2}'?([a-z-]+)'?:", registry, re.MULTILINE))
        if "[FIN_PANEL]:" in registry:
            registry_panels.add("fin-dashboard")
        self.assertEqual(registry_panels, routed_panels)

    def test_lazy_renderer_keys_match_panel_markup(self):
        markup_panels = set(re.findall(r'data-panel="([^"]+)"', self.html))
        registry = self.js.split("const PANEL_RENDERERS={", 1)[1].split("};", 1)[0]
        registry_panels = set(re.findall(r"^\s{2}'?([a-z-]+)'?:", registry, re.MULTILINE))
        if "[FIN_PANEL]:" in registry:
            registry_panels.add("fin-dashboard")
        self.assertEqual(registry_panels, markup_panels)

    def test_navigation_binding_is_scoped_but_global_controls_are_not(self):
        binding = self.js.split("function bindNavigation(scope=document){", 1)[1].split(
            "/* The routing table", 1
        )[0]
        self.assertIn("$$('[data-omni-answer]',scope)", binding)
        self.assertIn("bindChatConversationControls(scope)", binding)
        self.assertIn("$$('[data-tab]').forEach", binding)
        self.assertIn("$$('[data-app-link]').forEach", binding)
        self.assertNotIn("$$('[data-tab]',scope)", binding)
        self.assertNotIn("$$('[data-app-link]',scope)", binding)
        self.assertIn("$('#refresh').addEventListener", self.js)
        self.assertIn("$('#signout').addEventListener", self.js)

    def test_tab_switches_are_instant(self):
        home = self.js.split("function showHome(", 1)[1].split("function activate", 1)[0]
        activate = self.js.split("function activate(", 1)[1].split("function selectApp", 1)[0]
        self.assertNotIn("behavior:'smooth'", home)
        self.assertNotIn("behavior:'smooth'", activate)
        self.assertIn("window.scrollTo(0,0)", home)
        self.assertIn("window.scrollTo(0,0)", activate)

    def test_chat_poll_uses_fast_healthy_interval_and_bounded_backoff(self):
        poll = self.js.split("async function startChatPoll", 1)[1].split(
            "async function refreshChatList", 1
        )[0]
        self.assertIn("let delay=1000,progressError=null", poll)
        self.assertIn(
            "delay=Math.min(10000,2500*(2**Math.min(chatPoll.retryCount,2)))",
            poll,
        )

    def test_load_marks_all_panels_dirty_before_rendering(self):
        load = self.js.split("async function load(){", 1)[1].split(
            "async function decideApproval", 1
        )[0]
        self.assertIn("markPanelsDirty();", load)
        self.assertLess(load.index("markPanelsDirty();"), load.index("render();"))

    def test_tab_badges_render_independently_of_lazy_panels(self):
        badges = self.js.split("function renderTabBadges(){", 1)[1].split(
            "function render(){", 1
        )[0]
        render = self.js.split("function render(){", 1)[1].split(
            "async function load(){", 1
        )[0]
        reload_office = self.js.split("async function reloadOffice(", 1)[1].split(
            "/* ── Finances", 1
        )[0]
        generate_report = self.js.split(
            "async function generateConversationReport(", 1
        )[1].split("function missingProviderChatRpc", 1)[0]
        render_clients = self.js.split("function renderClients(){", 1)[1].split(
            "function officeValue", 1
        )[0]
        render_reports = self.js.split("function renderReports(){", 1)[1].split(
            "/* ── Company Info", 1
        )[0]

        self.assertIn("renderTabBadges();", render)
        self.assertIn("renderTabBadges();", reload_office)
        self.assertIn("renderTabBadges();", generate_report)
        self.assertNotIn("#client-count", render_clients)
        self.assertNotIn("#report-count", render_reports)

        tab_rail = self.html.split('<nav class="tabs"', 1)[1].split("</nav>", 1)[0]
        count_ids = set(re.findall(r'id="([a-z-]+-count)"', tab_rail))
        # Chat intentionally retains its pre-existing refreshChatList ownership.
        self.assertEqual(count_ids - {"chat-count"}, set(re.findall(r"#([a-z-]+-count)", badges)))
        self.assertNotIn("#chat-count", badges)

    def test_financials_tabs_all_drive_the_single_iframe_panel(self):
        """Financials is the one app whose tabs do not each own a panel.

        All eleven switch content inside one iframe, so activate() has to resolve them to
        panel-fin-dashboard and post the frame's own tab name across. If FIN_TABS and the
        markup disagree the tab renders an empty frame, which looks like a data outage.
        """
        tabs = re.findall(r'data-tab="(fin-[a-z-]+)"', self.html)
        keys = re.findall(r"'(fin-[a-z-]+)':'([^']+)'", self.js)
        self.assertEqual(sorted(tabs), sorted(k for k, _ in keys))
        # Every financials tab button points at the shared panel, and it exists once.
        for tab in tabs:
            self.assertIn(
                f'aria-controls="panel-fin-dashboard" data-dashboard="financials" data-tab="{tab}"',
                self.html,
            )
        self.assertEqual(self.html.count('data-panel="fin-dashboard"'), 1)
        # The frame labels must match the payload's `accounts` array exactly.
        self.assertIn(("fin-cashflow", "Cash Flow"), keys)
        self.assertIn(("fin-wells-fargo", "Wells Fargo"), keys)

    def test_fin_schema_keeps_service_role_out_by_grant_not_rls(self):
        """The agent runner authenticates as service_role, which carries BYPASSRLS.

        RLS therefore cannot keep it out of the financial data -- only the absence of a
        grant can. If a future migration ever hands service_role USAGE on `fin`, the
        whole protection is gone with no other symptom, so it is pinned here.
        """
        sql = FIN_SCHEMA_MIGRATION.read_text(encoding="utf-8")
        self.assertIn("revoke all on schema fin from public, anon, service_role;", sql)
        self.assertIn("grant usage on schema fin to authenticated;", sql)
        self.assertNotIn("grant usage on schema fin to service_role", sql)
        for table in ("transactions", "category_overrides", "monthly_summary_rows", "plaid_items"):
            self.assertIn(f"alter table fin.{table} enable row level security;", sql)
        self.assertIn(
            "revoke all on all tables in schema fin from public, anon, authenticated, service_role;",
            sql,
        )
        # Anything added to `fin` later must start closed rather than inherit a grant.
        self.assertIn("alter default privileges in schema fin", sql)
        # Ingest gets its own identity, created without a password in the migration.
        self.assertIn("create role fin_ingest nologin;", sql)

    def test_fin_api_is_reachable_only_by_an_authenticated_owner(self):
        sql = FIN_API_MIGRATION.read_text(encoding="utf-8")
        for fn in ("api_financial_state()", "api_set_category(text, text, text)"):
            self.assertIn(f"revoke all on function fin.{fn} from public, anon, service_role;", sql)
            self.assertIn(f"grant execute on function fin.{fn} to authenticated;", sql)
        self.assertEqual(sql.count("if not cos.is_owner() then"), 2)
        # The aggregation helpers are internal; only the two api_ entry points are granted.
        for helper in ("insights()", "monthly_summary()"):
            self.assertIn(
                f"revoke all on function fin.{helper} from public, anon, authenticated, service_role;",
                sql,
            )

    def test_financials_frame_ships_without_any_transaction_data(self):
        """The frame is a committed, publicly served asset; the payload arrives at
        runtime over postMessage. An embedded payload would publish real transactions."""
        self.assertTrue(FIN_FRAME.exists(), "run fin_build_frame.py to generate the frame")
        frame = FIN_FRAME.read_text(encoding="utf-8")
        self.assertIn("let DATA = {transactions:[]", frame)
        self.assertNotIn("Plaid:", frame)
        self.assertIn("overrideBackend = 'parent'", frame)
        self.assertIn("fin-set-category", frame)
        # The local-only captions must not survive into the hosted build. Only the
        # user-visible strings matter here; two source comments still mention
        # serve_dashboard.py, which is accurate for the local build of the same file.
        self.assertNotIn("Remembered in this browser only", frame)
        self.assertNotIn("<code>python3 serve_dashboard.py</code>", frame)
        self.assertIn("Saved to <strong>Supabase</strong>", frame)

    def test_simulations_tab_is_an_explicit_browser_only_sandbox(self):
        self.assertIn('data-tab="simulations">Simulations</button>', self.html)
        self.assertIn('data-panel="simulations"', self.html)
        self.assertIn("const SIM_DEMO_ONLY=true", self.js)
        self.assertIn("function renderSimulations()", self.js)
        self.assertIn("function simStart()", self.js)
        self.assertIn("function simPause()", self.js)
        self.assertIn("function simTick()", self.js)
        self.assertIn("No live fleet, lane, weather, maintenance, revenue, cost, or Supabase data is used.", self.js)
        self.assertIn("['YIP','LRD','ELP','SDF','MCI','GSP','GSO'", self.js)
        self.assertNotIn("api_simulation_create", self.js)

    def test_omnisupply_system_map_preserves_the_whiteboard_flow(self):
        self.assertIn('data-tab="omni-system">System</button>', self.html)
        self.assertIn('data-panel="omni-system"', self.html)
        self.assertIn("function renderOmniSystem()", self.js)
        for label in (
            "CS-Ventures.us",
            "Supabase",
            "Local LLM runner",
            "Simulation environment",
            "Peak analysis",
            "The browser never commands the laptop directly",
        ):
            self.assertIn(label, self.js)
        for distinction in (
            "Black</strong> Existing today",
            "Blue</strong> New simulation idea",
            "Orange</strong> New learning idea",
            "What happens now",
            "What should happen: simulate choices",
            "What should happen later: learn from outcomes",
            "THE CURRENT SYSTEM STAYS IN PLACE",
        ):
            self.assertIn(distinction, self.js)

    def test_dashboard_reads_the_owner_gated_supabase_contract(self):
        self.assertIn("sb.rpc('api_dashboard_state')", self.js)
        self.assertIn("sb.rpc('api_quality_state')", self.js)
        self.assertNotIn("data/dashboard.json", self.js)
        self.assertIn("@supabase/supabase-js@2.110.2", self.js)

    def test_dynamic_content_is_escaped(self):
        self.assertIn("const esc=", self.js)
        self.assertIn("${esc(a.title||a.work_id)}", self.js)
        self.assertIn("${esc(task.objective)}", self.js)

    def test_omnisupply_reads_all_four_owner_gated_surfaces(self):
        for rpc in (
            "api_omnisupply_state",
            "api_chat_state",
            "api_reports_state",
            "api_fleet_state",
        ):
            self.assertIn(f"sb.rpc('{rpc}'", self.js)

    def test_omnisupply_figures_always_render_provenance(self):
        self.assertIn("${confidenceChip(f.basis)}", self.js)
        self.assertIn("${esc(f.source)} · as of ${esc(f.as_of)}", self.js)
        self.assertIn("measured:'High confidence'", self.js)
        self.assertIn("unvetted:'Moderate confidence'", self.js)
        self.assertIn(
            "a data-backed ad-hoc query that has not yet been reviewed",
            self.js,
        )
        self.assertNotIn("unvetted:'Unvetted'", self.js)

    def test_real_and_illustrative_answers_remain_separate(self):
        self.assertIn("Object.values(omniState.sections||{}).flat()", self.js)
        self.assertIn("...(omniState.illustrative||[])", self.js)
        self.assertIn("const illustrative=a.basis==='illustrative'", self.js)

    def test_omnisupply_database_contract_is_versioned_and_private(self):
        for table in ("omnisupply_snapshots", "omnisupply_answers"):
            self.assertIn(
                f"alter table cos.{table} enable row level security",
                self.omnisupply_sql,
            )
            self.assertIn(
                f"revoke all on table cos.{table} from public, anon, authenticated",
                self.omnisupply_sql,
            )
        for table in (
            "chat_conversations",
            "chat_messages",
            "reports",
            "fleet_aircraft",
            "fleet_positions",
        ):
            self.assertIn(
                f"alter table cos.{table} enable row level security",
                self.omnisupply_surfaces_sql,
            )
            self.assertIn(
                f"revoke all on table cos.{table} from public, anon, authenticated",
                self.omnisupply_surfaces_sql,
            )

    def test_omnisupply_rpcs_are_owner_gated_and_explicitly_granted(self):
        for rpc in (
            "api_chat_state",
            "api_chat_messages",
            "api_chat_send",
            "api_chat_archive",
            "api_reports_state",
            "api_fleet_state",
        ):
            self.assertIn(f"function cos.{rpc}", self.omnisupply_rpcs_sql)
        self.assertEqual(
            self.omnisupply_rpcs_sql.count(
                "if not cos.is_owner() then raise exception 'forbidden'"
            ),
            6,
        )
        self.assertNotIn("to anon", self.omnisupply_rpcs_sql)

    def test_chat_provider_selector_is_durable_and_owner_gated(self):
        migration = (
            ROOT / "supabase" / "migrations"
            / "20260730010000_chat_provider_selector.sql"
        ).read_text()
        self.assertIn("provider in ('claude', 'codex')", migration)
        self.assertIn("'provider', v_provider", migration)
        self.assertIn(
            "if not cos.is_owner() then raise exception 'forbidden'",
            migration,
        )
        self.assertIn("p_provider:selection.provider", self.js)
        self.assertIn("GPT-5.6 Sol", self.js)
        self.assertIn("missingProviderChatRpc(error)", self.js)
        self.assertIn(
            "This model is not enabled in production yet",
            self.js,
        )
        self.assertIn(
            "p_text:question,p_title:null",
            self.js,
        )

    def test_company_view_refreshes_active_fleet_on_demand(self):
        self.assertIn("sb.functions.invoke('fleet-refresh'", self.js)
        self.assertIn("if(tab==='company'&&state)refreshFleetOnView()", self.js)
        self.assertIn('id="fleet-refresh"', self.js)

    def test_company_fleet_uses_recent_activity_and_local_time(self):
        self.assertIn("interval '2 months'", self.fleet_activity_sql)
        self.assertIn("as active_recent", self.fleet_activity_sql)
        self.assertIn("interval '15 minutes'", self.fleet_activity_sql)
        self.assertNotIn("where f.active", self.fleet_activity_sql)
        self.assertIn("function isFleetActive(aircraft)", self.js)
        self.assertIn("new Intl.DateTimeFormat(undefined", self.js)
        self.assertIn("timeZoneName:'short'", self.js)
        self.assertIn('id="fleet-show-history"', self.js)

    def test_company_fleet_map_can_pan_zoom_and_fit_visible_aircraft(self):
        self.assertIn("function fittedFleetView(", self.js)
        self.assertIn("function bindFleetMapControls(scope=document)", self.js)
        self.assertIn("bindFleetMapControls(scope);", self.js)
        self.assertIn('data-fleet-zoom="in"', self.js)
        self.assertIn("map.onpointermove", self.js)
        self.assertIn("map.addEventListener('wheel'", self.js)

    def test_reviewed_flightaware_arrivals_are_seeded_with_provenance(self):
        for tail in ("N727US", "N831US", "N842US"):
            self.assertIn(tail, self.fleet_activity_sql)
            self.assertIn(
                f"https://www.flightaware.com/live/flight/{tail}/history/",
                self.fleet_activity_sql,
            )
        self.assertIn("'FlightAware', 'airport_last_arrival'", self.fleet_activity_sql)

    def test_fleet_sweep_is_server_scheduled_and_not_browser_callable(self):
        self.assertIn("create or replace function cos.fleet_sweep", self.fleet_sweep_sql)
        self.assertIn("'*/15 * * * *'", self.fleet_sweep_sql)
        self.assertIn("'select cos.fleet_sweep();'", self.fleet_sweep_sql)
        self.assertIn(
            "from public, anon, authenticated",
            self.fleet_sweep_sql,
        )

    def test_publish_contract_accepts_unvetted_without_opening_browser_tables(self):
        self.assertIn("'unvetted'", self.publish_contract_sql)
        self.assertIn("on schema cos to service_role", self.publish_contract_sql)
        self.assertIn("to service_role", self.publish_contract_sql)
        self.assertNotIn("to anon", self.publish_contract_sql)
        self.assertNotIn("to authenticated", self.publish_contract_sql)

    def test_fleet_position_and_roster_sources_are_not_conflated(self):
        self.assertIn("'source', 'airplanes.live ADS-B'", self.fleet_source_sql)
        self.assertIn(
            "'roster_source', 'OpenSky aircraft registry'",
            self.fleet_source_sql,
        )
        self.assertNotIn("'source', 'OpenSky Network ADS-B'", self.fleet_source_sql)

    def test_seeded_fleet_locations_keep_row_level_provenance(self):
        for column in ("source", "location_kind", "airport_icao", "source_url"):
            self.assertIn(f"add column if not exists {column}", self.fleet_provenance_sql)
        self.assertIn("p.source as position_source", self.fleet_provenance_sql)
        self.assertIn("p.location_kind", self.fleet_provenance_sql)
        self.assertIn("q.location_kind = 'adsb_fix'", self.fleet_provenance_sql)
        self.assertIn("latest confirmed FlightAware arrival", self.js)
        self.assertIn("a.position_source||a.status_source", self.js)

    def test_retired_and_donor_airframes_are_history_not_current_fleet(self):
        self.assertIn("service_status = 'retired'", self.fleet_history_sql)
        self.assertIn("USA Jet sunset its DC-9 program", self.fleet_history_sql)
        self.assertIn("where tail = 'N195US'", self.fleet_history_sql)
        self.assertIn("service_status = 'parts_donor'", self.fleet_history_sql)
        for tail in ("N912DL", "N915DE", "N917DL", "N959DL"):
            self.assertIn(tail, self.fleet_history_sql)
        self.assertIn("where f.active", self.fleet_history_sql)
        self.assertIn("cos.fleet_inventory_metrics", self.fleet_history_sql)
        self.assertIn("security_invoker = true", self.fleet_history_sql)
        self.assertIn("Show historical tails", self.js)
        self.assertIn("No flight evidence within 2 months", self.js)

    def test_private_ledgers_have_rls_and_no_direct_browser_grants(self):
        for table in ("control_owners", "continuity_tasks", "continuity_checkpoints"):
            self.assertIn(f"alter table cos.{table} enable row level security", self.sql)
            self.assertIn(f"revoke all on table cos.{table} from public, anon, authenticated", self.sql)

    def test_rpc_execution_is_explicitly_owner_surface_only(self):
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.sql)
        self.assertIn("revoke all on function cos.api_dashboard_state() from public, anon", self.sql)
        self.assertIn("grant execute on function cos.api_dashboard_state() to authenticated", self.sql)

    def test_every_performance_metric_has_a_plain_language_guide(self):
        expected = {
            "task_completion",
            "active_freshness",
            "blocker_rate",
            "verified_outcomes",
            "outcome_coverage",
            "retry_rate",
            "evidence_density",
            "claude_token_coverage",
            "codex_token_coverage",
            "cost_per_outcome",
            "runner_availability",
            "approval_latency",
        }
        guide_block = self.js.split("const METRIC_GUIDE={", 1)[1].split("};", 1)[0]
        documented = set(re.findall(r"^\s{2}([a-z_]+):\{definition:", guide_block, re.MULTILINE))
        self.assertEqual(documented, expected)

    def test_metric_cards_explain_formula_and_relevance(self):
        self.assertIn('class="metric-definition"', self.js)
        self.assertIn("<small>Numerator</small>", self.js)
        self.assertIn("<small>Denominator</small>", self.js)
        self.assertIn("Why it matters", self.js)
        self.assertIn("metric.key==='approval_latency'", self.js)

    def test_overview_and_usage_explain_totals_and_coverage(self):
        self.assertIn("How to read the overview", self.js)
        self.assertIn("How to interpret usage", self.js)
        self.assertIn("None — this is a total, not a ratio", self.js)
        self.assertIn("tokenized ÷", self.js)

    def test_approval_page_documents_bounded_agent_recovery(self):
        self.assertIn("Agent recovery protocol", self.js)
        self.assertIn("Choose the start model", self.js)
        self.assertIn("One quota-only handoff", self.js)
        self.assertIn("Pause and re-approve", self.js)
        self.assertIn("Approve retry", self.js)

    def test_execution_approval_selects_and_records_start_provider(self):
        self.assertIn("data-start-provider", self.js)
        self.assertIn('<option value="claude" selected>Claude</option>', self.js)
        self.assertIn('<option value="codex">Codex</option>', self.js)
        self.assertIn("p_start_provider:startProvider", self.js)
        self.assertIn("p_start_provider not in ('claude','codex')", self.start_provider_sql)
        self.assertIn("jsonb_build_array('codex','claude')", self.start_provider_sql)
        self.assertIn("payload_hash=chosen_hash", self.start_provider_sql)
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.start_provider_sql)
        self.assertIn("revoke all on function cos.api_decide_approval(text,boolean,text,text) from public,anon", self.start_provider_sql)

    def test_release_ready_work_can_be_approved_from_the_website(self):
        self.assertIn("const RELEASE_READY='READY_FOR_RELEASE_APPROVAL'", self.js)
        self.assertIn("Release approvals", self.js)
        self.assertIn("data-release-work", self.js)
        self.assertIn("Approve release", self.js)
        self.assertIn("sb.rpc('api_release',{p_work_id:workId", self.js)
        self.assertIn("It will not rerun an agent, merge a pull request, or deploy code", self.js)
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.sql)
        self.assertIn("revoke all on function cos.api_release(text,text) from public, anon", self.sql)
        self.assertIn("grant execute on function cos.api_release(text,text) to authenticated", self.sql)

    def test_delivery_quality_is_visible_and_enforced_server_side(self):
        self.assertIn("expected_benefits", self.quality_sql)
        self.assertIn("delivery_quality_reviews", self.quality_sql)
        self.assertIn("builder_provider <> reviewer_provider", self.quality_sql)
        self.assertIn("score >= 17", self.quality_sql)
        self.assertIn("release blocked: delivery quality evidence has not passed", self.quality_sql)
        self.assertIn("alter table cos.delivery_quality_reviews enable row level security", self.quality_sql)
        self.assertIn("revoke all on table cos.delivery_quality_reviews from public,anon,authenticated", self.quality_sql)
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.quality_sql)
        self.assertIn("qualityReview(workId)", self.js)
        self.assertIn("benefitList(contract,review=null)", self.js)
        self.assertIn("For quality-gated jobs, the database refuses release", self.js)

    def test_skill_effectiveness_shows_real_or_honest_empty_state(self):
        self.assertIn("Skill effectiveness vs no-skill baseline", self.js)
        self.assertIn("No comparable skill data yet", self.js)
        self.assertIn("no-skill observations automatically", self.js)
        self.assertIn("skill_weekly", self.quality_sql)
        self.assertIn("alter table cos.skill_invocation_events enable row level security", self.quality_security_sql)
        self.assertIn("revoke all on table cos.skill_invocation_events", self.quality_security_sql)
        self.assertIn("revoke all on table cos.weekly_skill_effectiveness", self.quality_security_sql)

    def test_recovery_migration_is_owner_gated_and_private(self):
        self.assertIn("gate_type in ('plan','recovery','action','release')", self.recovery_sql)
        self.assertIn("provider_order", self.recovery_sql)
        self.assertIn("notification_outbox", self.recovery_sql)
        self.assertIn("alter table cos.notification_outbox enable row level security", self.recovery_sql)
        self.assertIn("revoke all on table cos.notification_outbox from public, anon, authenticated", self.recovery_sql)
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.recovery_sql)

    def test_work_queue_offers_a_live_run_view(self):
        self.assertIn("openRunView", self.js)
        self.assertIn("sb.rpc('api_job_progress'", self.js)
        self.assertIn('data-run="${esc(w.work_id)}"', self.js)
        self.assertIn("Watch live", self.js)
        # Poller stops on terminal states and closes with the panel.
        self.assertIn("RUN_ACTIVE", self.js)
        self.assertIn("stopRunPoll();$('#drill').classList.remove('open')", self.js)

    def test_job_progress_is_private_and_owner_gated(self):
        self.assertIn("alter table cos.job_progress enable row level security", self.progress_sql)
        self.assertIn("revoke all on table cos.job_progress from public, anon, authenticated", self.progress_sql)
        self.assertIn("if not cos.is_owner() then raise exception 'forbidden'", self.progress_sql)
        self.assertIn("revoke all on function cos.api_job_progress(text,integer) from public, anon", self.progress_sql)
        self.assertIn("grant execute on function cos.api_job_progress(text,integer) to authenticated", self.progress_sql)

    def test_chat_failures_and_progress_are_job_specific_and_owner_gated(self):
        self.assertIn("q.state = 'FAILED'", self.chat_failure_sql)
        self.assertIn("'failure_kind', q.failure_kind", self.chat_failure_sql)
        self.assertIn(
            "function cos.api_chat_job_progress",
            self.chat_failure_sql,
        )
        self.assertIn(
            "if not cos.is_owner() then raise exception 'forbidden'",
            self.chat_failure_sql,
        )
        self.assertIn(
            "revoke all on function cos.api_chat_job_progress(text, integer)",
            self.chat_failure_sql,
        )
        self.assertIn("sb.rpc('api_chat_job_progress'", self.js)
        self.assertIn("Technical details", self.js)

    def test_chat_polling_has_one_owner_and_recovers_after_browser_interruptions(self):
        send_chat = self.js[
            self.js.index("async function sendChat(text)"):
            self.js.index("/* ── Reports", self.js.index("async function sendChat(text)"))
        ]
        self.assertIn("await openConversation(data.conversation_id)", send_chat)
        self.assertNotIn("startChatPoll(data.job_id", send_chat)
        self.assertIn("chatPollIsActive(token,jobId,conversationId)", self.js)
        self.assertIn("chatPoll.timer=setTimeout(tick,delay)", self.js)
        self.assertIn("Connection interrupted — retrying automatically", self.js)
        self.assertIn("window.addEventListener('focus',resumeChatPoll)", self.js)
        self.assertIn("document.addEventListener('visibilitychange'", self.js)

    def test_chat_management_is_searchable_reversible_and_owner_gated(self):
        for rpc in (
            "api_chat_set_archived",
            "api_chat_delete",
            "api_report_from_conversation",
        ):
            self.assertIn(f"function cos.{rpc}", self.chat_management_sql)
            self.assertIn(f"sb.rpc('{rpc}'", self.js)
        self.assertEqual(
            self.chat_management_sql.count(
                "if not cos.is_owner() then raise exception 'forbidden'"
            ),
            4,
        )
        self.assertIn("archived_conversations", self.chat_management_sql)
        self.assertIn("a running conversation cannot be deleted", self.chat_management_sql)
        self.assertIn("on delete set null", self.chat_management_sql.lower())
        self.assertIn('id="chat-search"', self.js)
        self.assertIn('data-chat-view="archived"', self.js)
        self.assertIn("Generate report", self.js)
        self.assertIn("function setChatActionButtonBusy(button,label)", self.js)
        self.assertIn("button.closest('.chat-list-actions')?'…':label", self.js)

    def test_conversation_report_generation_updates_instead_of_duplicating(self):
        self.assertIn(
            "where r.conversation_id = p_conversation_id",
            self.chat_management_sql,
        )
        self.assertIn("update cos.reports", self.chat_management_sql)
        self.assertIn("'section_count', jsonb_array_length(v_sections)", self.chat_management_sql)


if __name__ == "__main__":
    unittest.main()
