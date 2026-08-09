"""Prepare the in-database Plaid sync: account mapping, item list, and credentials.

Run once. After this the sync runs inside Postgres whenever the dashboard is opened, and
stays current whether or not this machine is switched on.

    python3 fin_setup_cloud_sync.py            # mapping and item list only
    python3 fin_setup_cloud_sync.py --secrets  # also copy credentials into the database

WHAT MOVES, AND WHAT THAT MEANS
-------------------------------
`--secrets` copies the Plaid client id, secret, and one access token per linked
institution out of the macOS Keychain and into the database, because a job running in
Supabase cannot reach your Keychain. That is a real change in where the risk sits: those
tokens can read your bank transactions, and they will live in Supabase as well as on this
Mac.

They are stored ENCRYPTED with pgcrypto in `fin.plaid_credentials`. Only the encryption
key goes into Vault. That split is deliberate: Supabase grants service_role -- the agent
runner's identity -- plaintext read on Vault, and the grant belongs to supabase_admin so
it cannot be revoked. Anything left in Vault is therefore permanently readable by the
runner. It has no access to `fin` at all, so it can obtain the key and never the
ciphertext, and one half on its own is useless.

Values are read and written by this script. They are never printed, never logged, and
never passed as command-line arguments, which would put them in your shell history and
the process table. The Keychain copies are left in place, so the local sync keeps working
and this is reversible: delete the rows in fin.plaid_credentials to undo it.
"""

from __future__ import annotations

import secrets as secrets_module
import sqlite3
import subprocess
import sys
from pathlib import Path

import psycopg

from fin_env import load_db_url

STORE = Path(__file__).with_name("plaid_store.sqlite")
KEYCHAIN_SERVICE = "financials-plaid"


def keychain(account: str) -> str | None:
    """Read one secret. Returns the value without ever displaying it."""
    r = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
        capture_output=True, text=True,
    )
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def local_store() -> tuple[list[tuple], list[tuple]]:
    if not STORE.exists():
        sys.exit(f"{STORE} not found - run plaid_sync.py sync locally first.")
    c = sqlite3.connect(STORE)
    c.row_factory = sqlite3.Row
    try:
        accounts = [
            (r["account_id"], r["item_id"], r["dashboard_account"], r["mask"] or "")
            for r in c.execute(
                "SELECT a.account_id, a.item_id, a.dashboard_account, a.mask "
                "FROM plaid_accounts a JOIN plaid_items i ON i.item_id = a.item_id "
                "WHERE i.env = 'production' AND a.dashboard_account <> ''")
        ]
        # Cursors are deliberately NOT copied. A cursor describes a position in a feed
        # whose rows are already in the local store, not in Supabase; reusing it would
        # make the cloud sync skip everything up to that point. Starting empty re-pulls
        # the history once, which is correct and idempotent.
        items = [
            (r["item_id"], r["institution_name"] or "")
            for r in c.execute("SELECT item_id, institution_name FROM plaid_items WHERE env = 'production'")
        ]
    finally:
        c.close()
    return accounts, items


def main() -> None:
    do_secrets = "--secrets" in sys.argv
    accounts, items = local_store()

    with psycopg.connect(load_db_url()) as conn, conn.cursor() as cur:
        cur.executemany(
            "insert into fin.plaid_accounts (account_id, item_id, dashboard_account, mask) "
            "values (%s,%s,%s,%s) on conflict (account_id) do update set "
            "item_id = excluded.item_id, dashboard_account = excluded.dashboard_account, "
            "mask = excluded.mask", accounts)
        cur.executemany(
            "insert into fin.plaid_items (item_id, institution) values (%s,%s) "
            "on conflict (item_id) do update set institution = excluded.institution", items)
        print(f"mapped {len(accounts)} accounts across {len(items)} institutions")
        for _, _, dash, mask in sorted(accounts, key=lambda a: a[2]):
            print(f"  {dash:<14} ****{mask or '????'}")

        if do_secrets:
            import plaid_sync
            cfg = plaid_sync.load_config()
            secrets: list[tuple[str, str]] = []
            if cfg.client_id and cfg.secret:
                secrets += [("plaid_client_id", cfg.client_id), ("plaid_secret", cfg.secret)]
            missing = []
            for item_id, _ in items:
                token = keychain(item_id)
                if token:
                    secrets.append((f"plaid_token_{item_id}", token))
                else:
                    missing.append(item_id)

            # The encryption key lives in Vault; the tokens live encrypted in `fin`.
            # Supabase grants service_role plaintext read on Vault and that grant cannot
            # be revoked by us, so the runner can obtain the key -- and nothing else,
            # because it has no access to `fin` at all. It never holds both halves.
            cur.execute("select 1 from vault.secrets where name = 'fin_credential_key'")
            if not cur.fetchone():
                key = secrets_module.token_urlsafe(48)
                cur.execute("select vault.create_secret(%s, %s)", (key, 'fin_credential_key'))
                print("created a new encryption key in Vault (fin_credential_key)")

            for name, value in secrets:
                cur.execute("select fin.set_credential(%s, %s)", (name, value))
            conn.commit()
            # Names only. The values are never echoed.
            print(f"stored {len(secrets)} credentials encrypted in fin.plaid_credentials: "
                  f"{', '.join(n for n, _ in secrets)}")
            if missing:
                print(f"WARNING no Keychain token for: {', '.join(missing)}")
        else:
            conn.commit()
            print("\nCredentials not copied. Re-run with --secrets once you have read the")
            print("note at the top of this file about moving bank tokens into Supabase.")


if __name__ == "__main__":
    main()
