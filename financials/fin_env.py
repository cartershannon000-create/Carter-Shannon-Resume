"""Load SUPABASE_DB_URL from a gitignored .env so the connection string never has to be
pasted into a shell command or a chat message.

The file sits next to this one and holds a single line:

    SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres

An existing environment variable always wins, so CI or a one-off export still works.
"""

from __future__ import annotations

import os
from pathlib import Path

ENV_PATH = Path(__file__).with_name(".env")


def load_db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if url:
        return url

    if not ENV_PATH.exists():
        raise SystemExit(
            f"No SUPABASE_DB_URL, and {ENV_PATH} does not exist.\n"
            "Create it with one line:\n"
            "    SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres\n"
            "Get the URI from the Supabase dashboard: Connect -> Session pooler."
        )

    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == "SUPABASE_DB_URL":
            return value.strip().strip("'\"")

    raise SystemExit(f"{ENV_PATH} has no SUPABASE_DB_URL line.")
