"""Push the categorisation rules into Postgres, and prove the two agree.

The rules are authored in build_financial_dashboard.py -- CATEGORY_RULES, the alias map,
OVERRIDE_RULES, the Plaid taxonomy tables, and the workbook's Description->Category
sheet. The monthly review skill appends to those. This copies them into `fin` so the
scheduled sync can classify a transaction without Python running anywhere.

Keeping Python as the author and Postgres as a replica is deliberate: a second,
hand-maintained copy of 31 ordered rules drifts the first time somebody edits one, and
the failure is silent -- new transactions land in a different category than identical
old ones.

    python3 fin_sync_rules.py            # push, then verify
    python3 fin_sync_rules.py --verify   # verify only, change nothing

Verification runs both implementations over every distinct description in the local
database and reports any disagreement. Order matters in these rules, so a mismatch means
the SQL is wrong, not merely different.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import psycopg

import build_financial_dashboard as bfd
from fin_env import load_db_url

DB_PATH = Path(__file__).with_name("financials.sqlite")


def workbook_mapping() -> dict[str, str]:
    import openpyxl
    wb = openpyxl.load_workbook(bfd.WORKBOOK, data_only=True, read_only=True)
    try:
        return bfd.build_mapping(wb)
    finally:
        wb.close()


def push(conn: psycopg.Connection) -> None:
    mapping = workbook_mapping()
    with conn.cursor() as cur:
        cur.execute("delete from fin.category_rules")
        cur.executemany(
            "insert into fin.category_rules (seq, category, match_type, terms) values (%s,%s,%s,%s)",
            [(i, r["cat"], "all" if "all" in r else "any", list(r.get("all") or r["any"]))
             for i, r in enumerate(bfd.CATEGORY_RULES, start=1)],
        )

        cur.execute("delete from fin.override_rules")
        cur.executemany(
            "insert into fin.override_rules (seq, category, terms) values (%s,%s,%s)",
            [(i, r["cat"], list(r["any"])) for i, r in enumerate(bfd.OVERRIDE_RULES, start=1)],
        )

        # canonical_category()'s alias map is a literal inside the function, so it is read
        # back out of the source rather than duplicated here.
        import inspect, re
        aliases = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', inspect.getsource(bfd.canonical_category)))
        cur.execute("delete from fin.category_aliases")
        cur.executemany("insert into fin.category_aliases (alias, category) values (%s,%s)",
                        list(aliases.items()))

        cur.execute("delete from fin.plaid_category_map")
        cur.executemany(
            "insert into fin.plaid_category_map (level, plaid_category, category) values (%s,%s,%s)",
            [("detailed", k, v) for k, v in bfd.PLAID_CATEGORY_BY_DETAILED.items()]
            + [("primary", k, v) for k, v in bfd.PLAID_CATEGORY_BY_PRIMARY.items()],
        )

        cur.execute("delete from fin.description_map")
        cur.executemany("insert into fin.description_map (description_key, category) values (%s,%s)",
                        list(mapping.items()))

        print(f"pushed {len(bfd.CATEGORY_RULES)} rules, {len(bfd.OVERRIDE_RULES)} overrides, "
              f"{len(aliases)} aliases, "
              f"{len(bfd.PLAID_CATEGORY_BY_DETAILED) + len(bfd.PLAID_CATEGORY_BY_PRIMARY)} plaid mappings, "
              f"{len(mapping)} workbook descriptions")


def verify(conn: psycopg.Connection) -> int:
    """Run both categorisers over every real description and diff the answers."""
    sq = sqlite3.connect(DB_PATH)
    sq.row_factory = sqlite3.Row
    rows = [(r["description"], r["native_category"] or "", r["account"], r["counterparty"] or "")
            for r in sq.execute("SELECT DISTINCT description, native_category, account, counterparty FROM transactions")]
    sq.close()

    mapping = workbook_mapping()
    mismatches = []
    with conn.cursor() as cur:
        for desc, native, account, party in rows:
            py = bfd.infer_category(desc, native, mapping)
            cur.execute("select fin.infer_category(%s, %s)", (desc, native))
            sql = cur.fetchone()[0]
            if py != sql:
                mismatches.append((desc[:64], native[:24], py, sql))

    print(f"compared {len(rows)} distinct descriptions")
    if mismatches:
        print(f"MISMATCH on {len(mismatches)}:")
        for desc, native, py, sql in mismatches[:25]:
            print(f"  {desc!r:66} native={native!r:26} python={py:<16} sql={sql}")
        if len(mismatches) > 25:
            print(f"  ... and {len(mismatches) - 25} more")
    else:
        print("PASS - the SQL categoriser agrees with Python on every description")
    return len(mismatches)


def main() -> None:
    verify_only = "--verify" in sys.argv
    with psycopg.connect(load_db_url()) as conn:
        if not verify_only:
            push(conn)
            conn.commit()
        bad = verify(conn)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
