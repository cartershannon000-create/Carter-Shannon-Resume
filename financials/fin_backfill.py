"""One-time backfill of financials.sqlite into the Supabase `fin` schema.

Run once to seed the migrated dashboard, and again only if the historical data is
rebuilt from source. Ongoing rows come from the Plaid Edge Function, not from here.

Put the connection string in a gitignored .env next to this file (see fin_env.py),
then:

    python3 fin_backfill.py            # dry run: reports what it would write
    python3 fin_backfill.py --commit   # actually writes

Note on categories: financials.sqlite stores the EFFECTIVE category, because the
Python build applied overrides before writing. The originally inferred category is
therefore not recoverable for historical rows, and fin.transactions.category is
seeded with the effective value. The single existing override is loaded too, so the
read path's coalesce lands on the same answer either way. New rows from Plaid will
carry a true inferred category with overrides layered on top.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import psycopg

from fin_env import load_db_url

DB_PATH = Path(__file__).with_name("financials.sqlite")

TX_COLUMNS = (
    "id, account, txn_date, description, category, amount, cost, type, status, "
    "source, native_category, counterparty, occurrence, needs_review"
)


def read_sqlite() -> tuple[list[tuple], list[tuple], list[tuple]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        transactions = [
            (
                r["id"], r["account"], r["date"], r["description"], r["category"],
                r["amount"], r["cost"], r["type"], r["status"], r["source"],
                r["native_category"], r["counterparty"], r["occurrence"],
                bool(r["needs_review"]),
            )
            for r in conn.execute("SELECT * FROM transactions")
        ]
        overrides = [
            (r["tx_id"], r["category"], r["note"])
            for r in conn.execute("SELECT * FROM category_overrides")
        ]
        monthly = [
            (r["row_order"], r["month"], r["label"], r["style"], r["kind"], r["value"])
            for r in conn.execute("SELECT * FROM monthly_summary_rows")
        ]
    finally:
        conn.close()
    return transactions, overrides, monthly


def main() -> None:
    commit = "--commit" in sys.argv
    url = load_db_url()

    transactions, overrides, monthly = read_sqlite()
    print(f"sqlite: {len(transactions)} transactions, {len(overrides)} overrides, "
          f"{len(monthly)} monthly summary rows")

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Overrides reference transactions, so they load second and clear first.
            cur.execute("delete from fin.category_overrides")
            cur.execute("delete from fin.transactions")
            cur.execute("delete from fin.monthly_summary_rows")

            with cur.copy(f"copy fin.transactions ({TX_COLUMNS}) from stdin") as copy:
                for row in transactions:
                    copy.write_row(row)

            with cur.copy("copy fin.category_overrides (tx_id, category, note) from stdin") as copy:
                for row in overrides:
                    copy.write_row(row)

            with cur.copy(
                "copy fin.monthly_summary_rows (row_order, month, label, style, kind, value) from stdin"
            ) as copy:
                for row in monthly:
                    copy.write_row(row)

            cur.execute("select count(*) from fin.transactions")
            n_tx = cur.fetchone()[0]
            cur.execute("select count(*) from fin.category_overrides")
            n_ovr = cur.fetchone()[0]
            cur.execute("select count(*) from fin.monthly_summary_rows")
            n_month = cur.fetchone()[0]

            # The generated `month` column must agree with what Python computed, or
            # every monthly aggregate downstream is silently keyed differently.
            cur.execute("""
                select count(*) from fin.transactions
                where month <> to_char(txn_date, 'YYYY-MM')
            """)
            month_mismatch = cur.fetchone()[0]

            print(f"loaded: {n_tx} transactions, {n_ovr} overrides, {n_month} monthly rows")
            print(f"month-column mismatches: {month_mismatch}")

            if n_tx != len(transactions) or month_mismatch:
                conn.rollback()
                sys.exit("Counts or month derivation did not line up; rolled back.")

            if commit:
                conn.commit()
                print("committed")
            else:
                conn.rollback()
                print("dry run, rolled back. Re-run with --commit to write.")


if __name__ == "__main__":
    main()
