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

    def test_seven_operating_tabs_are_present(self):
        tabs = re.findall(r'data-tab="([^"]+)"', self.html)
        self.assertEqual(tabs, ["overview", "metrics", "work", "agents", "usage", "approvals", "system"])

    def test_dashboard_reads_the_owner_gated_supabase_contract(self):
        self.assertIn("sb.rpc('api_dashboard_state')", self.js)
        self.assertIn("sb.rpc('api_quality_state')", self.js)
        self.assertNotIn("data/dashboard.json", self.js)
        self.assertIn("@supabase/supabase-js@2.110.2", self.js)

    def test_dynamic_content_is_escaped(self):
        self.assertIn("const esc=", self.js)
        self.assertIn("${esc(a.title||a.work_id)}", self.js)
        self.assertIn("${esc(task.objective)}", self.js)

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


if __name__ == "__main__":
    unittest.main()
