"""Parity gate: does the SQL read path produce the same numbers as the Python build?

The cash-flow bridge in particular was tuned by hand and validated to the cent against
the real bank balance, so "close enough" is not a passing result for it. This diffs the
two payloads field by field and exits non-zero on any mismatch.

    python3 fin_backfill.py --commit    # load the same rows Python is about to compute
    python3 fin_parity.py

Both sides must be computed from the same row set, so run the backfill immediately
before this -- the loader seeds Postgres from the same financials.sqlite that
build_payload() reads back after it writes.

The SQL side calls the aggregation helpers directly rather than
fin.api_financial_state(), because the entry point is gated on cos.is_owner() and a
direct psql connection has no auth.uid(). The helpers are what the entry point calls,
so the numbers under test are identical.
"""

from __future__ import annotations

import sys
from decimal import Decimal

from pathlib import Path

import psycopg

import build_financial_dashboard as bfd
from fin_env import load_db_url

DB_PATH = Path(__file__).with_name("financials.sqlite")
TOLERANCE = 0.0  # exact match required; these are rounded to cents on both sides


def norm(value):
    """Make Python floats and Postgres numerics comparable at cent precision."""
    if isinstance(value, (Decimal, float, int)) and not isinstance(value, bool):
        return round(float(value), 2)
    return value


def diff(path: str, py, sql, out: list[str]) -> None:
    if isinstance(py, dict) and isinstance(sql, dict):
        for key in sorted(set(py) | set(sql)):
            if key not in py:
                out.append(f"{path}.{key}: missing in Python, SQL={sql[key]!r}")
            elif key not in sql:
                out.append(f"{path}.{key}: missing in SQL, Python={py[key]!r}")
            else:
                diff(f"{path}.{key}", py[key], sql[key], out)
    elif isinstance(py, list) and isinstance(sql, list):
        if len(py) != len(sql):
            out.append(f"{path}: length {len(py)} (Python) vs {len(sql)} (SQL)")
        for i, (a, b) in enumerate(zip(py, sql)):
            diff(f"{path}[{i}]", a, b, out)
    else:
        a, b = norm(py), norm(sql)
        if isinstance(a, float) and isinstance(b, float):
            if abs(a - b) > TOLERANCE:
                out.append(f"{path}: Python={a} SQL={b} (delta {round(a - b, 4)})")
        elif a != b:
            out.append(f"{path}: Python={a!r} SQL={b!r}")


def fetch_sql(url: str) -> dict:
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("select fin.summary(), fin.cashflow(), fin.insights(), fin.monthly_summary()")
        summary, cashflow, insights, monthly = cur.fetchone()
    for name, value in (("summary", summary), ("cashflow", cashflow)):
        if value is None:
            sys.exit(f"fin.{name}() returned NULL -- is the backfill loaded?")
    return {
        "summary": summary,
        "cashflow": cashflow,
        "insights": insights,
        "workbook_monthly": monthly,
    }


def pull_overrides(url: str) -> int:
    """Copy Review-tab decisions down from Supabase before comparing.

    Category overrides are now made in the hosted dashboard, so Supabase is their source
    of truth and the local database only learns of them here. Without this the harness
    reports a mismatch for every category the owner has corrected since the last run --
    which looks like a porting bug and is really just the two stores disagreeing about
    something only one of them was told.
    """
    import sqlite3
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("select tx_id, category, note from fin.category_overrides")
        rows = cur.fetchall()
    sq = sqlite3.connect(DB_PATH)
    try:
        sq.executemany(
            "INSERT INTO category_overrides (tx_id, category, note) VALUES (?,?,?) "
            "ON CONFLICT(tx_id) DO UPDATE SET category=excluded.category, note=excluded.note",
            rows)
        sq.commit()
    finally:
        sq.close()
    return len(rows)


def main() -> None:
    url = load_db_url()

    print(f"pulled {pull_overrides(url)} category overrides down from Supabase")
    print("building the Python payload ...")
    py = bfd.build_payload()
    print("reading the SQL payload ...")
    sql = fetch_sql(url)

    # Sanity check that both sides are looking at the same rows before comparing any
    # aggregate -- a row-count gap would make every downstream diff meaningless noise.
    py_n = py["summary"]["overall"]["transaction_count"]
    sql_n = sql["summary"]["overall"]["transaction_count"]
    if py_n != sql_n:
        sys.exit(f"Row counts differ: Python {py_n}, SQL {sql_n}. Re-run fin_backfill.py first.")
    print(f"both sides: {py_n} transactions\n")

    blocks = {
        "cashflow": ("cashflow", "cashflow"),
        "summary": ("summary", "summary"),
        "insights": ("insights", "insights"),
        "workbook_monthly": ("workbook_monthly", "workbook_monthly"),
    }

    failures = 0
    for label, (py_key, sql_key) in blocks.items():
        out: list[str] = []
        diff(label, py[py_key], sql[sql_key], out)
        if out:
            failures += 1
            print(f"FAIL {label}: {len(out)} difference(s)")
            for line in out[:40]:
                print(f"     {line}")
            if len(out) > 40:
                print(f"     ... and {len(out) - 40} more")
        else:
            print(f"PASS {label}")
        print()

    if failures:
        sys.exit(f"{failures} block(s) differ")
    print("Full parity. The SQL read path reproduces the Python payload exactly.")


if __name__ == "__main__":
    main()
