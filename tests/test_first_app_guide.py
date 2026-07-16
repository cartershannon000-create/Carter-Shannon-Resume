import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "how-to-build-your-first-app" / "index.html"


class FirstAppGuideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = PAGE.read_text(encoding="utf-8")

    def test_page_and_structured_data_parse(self):
        parser = HTMLParser()
        parser.feed(self.page)
        parser.close()
        blocks = re.findall(
            r'<script type="application/ld\+json">\s*(.*?)\s*</script>',
            self.page,
            re.DOTALL,
        )
        self.assertEqual(len(blocks), 1)
        payload = json.loads(blocks[0])
        self.assertEqual(payload["@type"], "HowTo")
        self.assertEqual(len(payload["step"]), 6)

    def test_guide_covers_the_complete_workflow(self):
        for phrase in (
            "Do most of the thinking before the coding",
            "Prepare a safe place to build",
            "Give the AI a small set of living documents",
            "Plan, build, validate, save",
            "Build with an undo button",
            "Turn repeated instructions into a system",
        ):
            self.assertIn(phrase, self.page)

    def test_blueprint_is_complete_and_copyable(self):
        for phrase in (
            "SYSTEM_BLUEPRINT.md",
            "docs/UI_SPEC.md",
            "docs/DB_SCHEMA.md",
            "docs/API_FLOW.md",
            "data/conversation_logs.db",
            "python -m venv venv",
            "Never commit secrets",
            "data-copy-blueprint",
        ):
            self.assertIn(phrase, self.page)


if __name__ == "__main__":
    unittest.main()
