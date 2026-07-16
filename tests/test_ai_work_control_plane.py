import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "ai-work-control-plane" / "index.html"
PORTFOLIO = ROOT / "portfolio" / "index.html"


class AiWorkControlPlanePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")
        cls.portfolio = PORTFOLIO.read_text(encoding="utf-8")

    def test_html_and_structured_data_parse(self):
        HTMLParser().feed(self.page)
        blocks = re.findall(
            r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
            self.page,
            re.DOTALL,
        )
        self.assertEqual(len(blocks), 1)
        payload = json.loads(blocks[0])
        self.assertEqual(payload["name"], "AI Work Control Plane")
        self.assertEqual(payload["applicationCategory"], "BusinessApplication")

    def test_public_page_covers_the_operating_story(self):
        for phrase in (
            "Manage the work, not the chat",
            "Intent &amp; decisions",
            "State &amp; policy",
            "Specialized workers",
            "Evidence &amp; measurement",
            "What it enables",
        ):
            self.assertIn(phrase, self.page)

    def test_metrics_explain_calculation_and_relevance(self):
        for metric in (
            "Verified completion rate",
            "First-pass acceptance",
            "Approval turnaround",
            "Active-work age",
            "Controlled recovery rate",
            "Human-control coverage",
            "Usage coverage",
            "Modeled cost per verified outcome",
        ):
            self.assertIn(metric, self.page)
        self.assertGreaterEqual(self.page.count("Numerator"), 6)
        self.assertGreaterEqual(self.page.count("Denominator"), 6)
        self.assertEqual(self.page.count("Why it matters:"), 8)
        self.assertIn("no numerator or denominator", self.page)

    def test_page_omits_operational_security_details(self):
        for forbidden in (
            "Supabase",
            "Claude",
            "Codex",
            "Anthropic",
            "OpenAI",
            "psycopg",
            "job_queue",
            "approval_requests",
            "notification_outbox",
            "127.0.0.1",
            "localhost",
        ):
            self.assertNotIn(forbidden, self.page)
        self.assertIn("Operational vendors, infrastructure, credentials", self.page)

    def test_portfolio_lists_and_links_all_eleven_entries(self):
        self.assertIn('"numberOfItems": 11', self.portfolio)
        self.assertEqual(self.portfolio.count('class="work-card"'), 11)
        self.assertIn("AI Work Control Plane", self.portfolio)
        self.assertIn('href="/ai-work-control-plane/"', self.portfolio)
        self.assertIn('href="/how-to-build-your-first-app/"', self.portfolio)
        self.assertIn('href="/decks/pe-ai-ebitda-strategy/"', self.portfolio)
        self.assertIn('href="/decks/process-automation-smb/"', self.portfolio)


if __name__ == "__main__":
    unittest.main()
