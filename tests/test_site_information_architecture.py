import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO = ROOT / "portfolio" / "index.html"
SERVICES = ROOT / "services" / "index.html"
GUIDE = ROOT / "how-to-build-your-first-app" / "index.html"
EXPECTED_NAV = (
    ('href="/"', "Home"),
    ('href="/about/"', "About"),
    ('href="/services/"', "Services"),
    ('href="/portfolio/"', "Portfolio"),
)


class SiteInformationArchitectureTests(unittest.TestCase):
    def test_services_page_owns_the_four_service_lines(self):
        page = SERVICES.read_text(encoding="utf-8")
        for phrase in (
            "What we do for clients",
            "AI &amp; Automation",
            "Product Design &amp; Build",
            "Analytics &amp; Financial Modeling",
            "Strategy &amp; Go-to-Market",
        ):
            self.assertIn(phrase, page)
        self.assertNotIn('class="port-entries"', page)

    def test_portfolio_has_three_tabs_and_eleven_slides(self):
        page = PORTFOLIO.read_text(encoding="utf-8")
        parser = HTMLParser()
        parser.feed(page)
        parser.close()
        self.assertEqual(page.count('role="tab"'), 3)
        self.assertEqual(page.count('role="tabpanel"'), 3)
        self.assertEqual(page.count('class="work-card"'), 11)
        for label in ("Agents &amp; AI", "Apps &amp; Websites", "Trainings &amp; Papers"):
            self.assertIn(label, page)
        block = re.search(
            r'id="panel-training".*?</section>', page, re.DOTALL
        ).group(0)
        self.assertIn("How to Build Your First App", block)
        self.assertIn("AI-to-EBITDA Strategy", block)
        self.assertIn("Process Automation for SMBs", block)

    def test_services_and_portfolio_structured_data_parse(self):
        for path in (SERVICES, PORTFOLIO):
            page = path.read_text(encoding="utf-8")
            blocks = re.findall(
                r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
                page,
                re.DOTALL,
            )
            self.assertGreaterEqual(len(blocks), 1)
            for block in blocks:
                json.loads(block)

    def test_guide_points_back_to_trainings_and_papers(self):
        page = GUIDE.read_text(encoding="utf-8")
        self.assertIn('href="/portfolio/#trainings-papers"', page)
        self.assertIn("Trainings &amp; Papers", page)

    def test_all_public_pages_use_the_four_link_navigation(self):
        public_pages = sorted(
            path
            for path in ROOT.rglob("*.html")
            if "dev" not in path.relative_to(ROOT).parts
        )
        self.assertGreater(len(public_pages), 15)
        for path in public_pages:
            page = path.read_text(encoding="utf-8")
            match = re.search(
                r'<nav class="csv-nav"[^>]*>(.*?)</nav>', page, re.DOTALL
            )
            self.assertIsNotNone(match, path.relative_to(ROOT))
            nav = match.group(1)
            self.assertEqual(nav.count("<a "), 4, path.relative_to(ROOT))
            cursor = -1
            for href, label in EXPECTED_NAV:
                position = nav.find(href)
                self.assertGreater(position, cursor, path.relative_to(ROOT))
                self.assertIn(label, nav)
                cursor = position


if __name__ == "__main__":
    unittest.main()
