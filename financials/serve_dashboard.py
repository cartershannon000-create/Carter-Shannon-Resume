#!/usr/bin/env python3
"""Serve the financial dashboard with a write-back API for category overrides.

Why this exists: financial_dashboard.html is a single static file. Opened via
file:// the browser is sandboxed and cannot touch financials.sqlite, so category
edits can only land in localStorage -- per-browser, and invisible to the builder.

Served from here, the page gets a real endpoint and every category change is
written straight into the ``category_overrides`` table. That table is the one
build_financial_dashboard.py already reads (apply_db_category_overrides) and
deliberately never clears on rebuild, so edits made here outlive every rebuild
and take precedence over CATEGORY_RULES.

Usage:
    python3 serve_dashboard.py            # http://127.0.0.1:8765
    python3 serve_dashboard.py --port 9000
    python3 serve_dashboard.py --no-browser

The dashboard still works when opened directly as a file; it falls back to
localStorage when this API is not reachable.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "financials.sqlite"
DASHBOARD = "financial_dashboard.html"
API_PATH = "/api/overrides"

# Only categories the dashboard itself offers are accepted, so a stray request
# cannot write a junk category into the table the builder trusts.
VALID_CATEGORIES = {
    "additional savings", "alc", "amex", "bar", "bet", "capone", "cash", "check",
    "clothing", "donations", "event", "fee", "food", "gift", "golf", "grocery",
    "haircut", "living", "metro", "mom", "payment", "rent", "salary", "service",
    "spotify", "stock", "tax", "travel", "uber", "uncategorized", "utilities",
    "venmo", "wells",
}

_db_lock = threading.Lock()


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS category_overrides (
            tx_id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def read_overrides() -> dict[str, str]:
    if not DB_PATH.exists():
        return {}
    with _db_lock, sqlite3.connect(DB_PATH) as conn:
        ensure_table(conn)
        return {row[0]: row[1] for row in conn.execute("SELECT tx_id, category FROM category_overrides")}


def write_override(tx_id: str, category: str) -> str:
    """Upsert an override, or delete it when the category is cleared."""
    with _db_lock, sqlite3.connect(DB_PATH) as conn:
        ensure_table(conn)
        if not category or category == "uncategorized":
            conn.execute("DELETE FROM category_overrides WHERE tx_id = ?", (tx_id,))
            return "deleted"
        conn.execute(
            """
            INSERT INTO category_overrides (tx_id, category, note, updated_at)
            VALUES (?, ?, 'dashboard', CURRENT_TIMESTAMP)
            ON CONFLICT(tx_id) DO UPDATE SET
                category = excluded.category,
                note = excluded.note,
                updated_at = CURRENT_TIMESTAMP
            """,
            (tx_id, category),
        )
        return "saved"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):  # quieter: skip static asset noise
        if API_PATH in self.path:
            super().log_message(fmt, *args)

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.split("?")[0] == API_PATH:
            try:
                self._json(read_overrides())
            except Exception as exc:  # surface DB problems to the page
                self._json({"error": str(exc)}, 500)
            return
        if self.path in ("/", ""):
            self.path = f"/{DASHBOARD}"
        super().do_GET()

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != API_PATH:
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            tx_id = str(payload.get("tx_id") or "").strip()
            category = str(payload.get("category") or "").strip().lower()
            if not tx_id:
                self._json({"error": "tx_id is required"}, 400)
                return
            if category and category not in VALID_CATEGORIES:
                self._json({"error": f"unknown category: {category}"}, 400)
                return
            result = write_override(tx_id, category)
            self._json({"status": result, "tx_id": tx_id, "category": category})
        except Exception as exc:
            self._json({"error": str(exc)}, 500)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = parser.parse_args()

    if not (ROOT / DASHBOARD).exists():
        raise SystemExit(f"{DASHBOARD} not found -- run: python3 build_financial_dashboard.py")

    url = f"http://127.0.0.1:{args.port}/{DASHBOARD}"
    existing = len(read_overrides()) if DB_PATH.exists() else 0
    print(f"Dashboard:        {url}")
    print(f"Database:         {DB_PATH}")
    print(f"Saved overrides:  {existing}")
    print("Category edits in the browser now write to category_overrides and survive rebuilds.")
    print("Ctrl-C to stop.")

    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    # Localhost only -- this writes to your ledger and must not be reachable off-box.
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
