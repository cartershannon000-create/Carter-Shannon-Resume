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


if __name__ == "__main__":
    unittest.main()
