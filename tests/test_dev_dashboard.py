import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOGIN = ROOT / "dev" / "login"
MIGRATION = ROOT / "supabase" / "migrations" / "20260712164133_add_control_dashboard_metrics.sql"


class DevDashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (LOGIN / "index.html").read_text(encoding="utf-8")
        cls.js = (LOGIN / "app.js").read_text(encoding="utf-8")
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_seven_operating_tabs_are_present(self):
        tabs = re.findall(r'data-tab="([^"]+)"', self.html)
        self.assertEqual(tabs, ["overview", "metrics", "work", "agents", "usage", "approvals", "system"])

    def test_dashboard_reads_the_owner_gated_supabase_contract(self):
        self.assertIn("sb.rpc('api_dashboard_state')", self.js)
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


if __name__ == "__main__":
    unittest.main()
