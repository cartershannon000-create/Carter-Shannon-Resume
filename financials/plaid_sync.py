#!/usr/bin/env python3
"""Pull transactions and balances from Plaid into a local store.

Why this is a separate file and a separate database
---------------------------------------------------
``build_financial_dashboard.py`` rebuilds ``financials.sqlite`` from scratch on
every run -- the transactions table is wiped and rewritten. Plaid state must not
live there: access tokens and sync cursors are not regenerable, and losing a
cursor means re-downloading history and re-deriving ids. So everything Plaid
owns lives in ``plaid_store.sqlite``, which nothing else writes to, and the
dashboard build treats that store as just another read-only source -- the same
way it treats a CSV in "Source data".

The two-step shape (sync here, read there) also means a bank outage or an
expired login can never break a dashboard build. The build reads whatever was
last synced.

Usage
-----
    python3 plaid_sync.py link            # connect an account (opens a browser)
    python3 plaid_sync.py link --instant  # sandbox only: connect a fake bank, no browser
    python3 plaid_sync.py sync            # pull new transactions + balances
    python3 plaid_sync.py status          # what is linked, how fresh, what it holds
    python3 plaid_sync.py preview         # how these rows will land in the dashboard
    python3 plaid_sync.py map             # point a Plaid account at a dashboard account
    python3 plaid_sync.py unlink <item>   # forget an item and its transactions

Credentials
-----------
Read from the environment, or from ``plaid_config.json`` (gitignored):

    PLAID_CLIENT_ID   from the Plaid dashboard
    PLAID_SECRET      the secret for the environment you are pointing at
    PLAID_ENV         sandbox (default) | production

Access tokens are long-lived bank credentials. They go in the macOS Keychain
when it is available; the sqlite fallback is only used when it is not, and it
warns when it does.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STORE_PATH = ROOT / "plaid_store.sqlite"
CONFIG_PATH = ROOT / "plaid_config.json"

API_HOSTS = {
    "sandbox": "https://sandbox.plaid.com",
    "production": "https://production.plaid.com",
}

KEYCHAIN_SERVICE = "financials-plaid"
LINK_PORT = 8777

# How far back to pull on the first sync of a new item. Plaid returns up to 24
# months for most institutions; the dashboard only models 2025 onward.
INITIAL_DAYS_REQUESTED = 730

# Dashboard account names, as used by build_financial_dashboard.py. A Plaid
# account must map to one of these to reach the dashboard.
DASHBOARD_ACCOUNTS = ["Checking", "Wells Fargo", "Capital One", "Amex", "Venmo"]

# Best-guess mapping from a linked Plaid account to a dashboard account.
# "Wells Fargo" in the dashboard means the Wells credit card specifically --
# the Wells checking account is called "Checking" -- so institution alone is
# not enough to decide and the account type has to break the tie.
def guess_dashboard_account(institution: str, acct_type: str, subtype: str, name: str) -> str:
    inst = (institution or "").lower()
    blob = f"{acct_type} {subtype} {name}".lower()
    is_credit = "credit" in acct_type.lower() or "credit" in subtype.lower()
    if "wells" in inst:
        return "Wells Fargo" if is_credit else "Checking"
    if "capital one" in inst:
        return "Capital One"
    if "american express" in inst or "amex" in inst:
        return "Amex"
    if "venmo" in inst or "paypal" in inst:
        return "Venmo"
    # Sandbox institutions are all "First Platypus Bank" and friends; fall back
    # to the account shape so `link --instant` produces something previewable.
    if is_credit:
        return "Capital One"
    if "checking" in blob:
        return "Checking"
    return ""


# Sign conventions. Plaid is uniform: a positive amount means money left the
# account (a purchase), negative means money came in. The dashboard is not
# uniform -- each account inherited the sign convention of its bank's CSV
# export -- so `amount` has to be flipped per account to match the rows already
# in the database. `cost` is the one field that means the same thing
# everywhere: positive is money spent.
#
# Only Checking's `amount` is load-bearing (build_cashflow walks it as the bank
# delta). The card accounts' `amount` is display-only, but it still has to match
# its CSV neighbours or the transaction table shows the same charge with two
# different signs depending on where it was imported from.
AMOUNT_IS_NEGATIVE_FOR_SPEND = {"Checking", "Wells Fargo", "Venmo"}


class PlaidError(RuntimeError):
    def __init__(self, payload: dict[str, Any], status: int):
        self.payload = payload
        self.status = status
        self.code = payload.get("error_code", "")
        self.type = payload.get("error_type", "")
        message = payload.get("error_message") or json.dumps(payload)
        super().__init__(f"[{status} {self.code or self.type or 'error'}] {message}")


# --- config -------------------------------------------------------------------


class Config:
    def __init__(self, client_id: str, secret: str, env: str):
        self.client_id = client_id
        self.secret = secret
        self.env = env

    @property
    def host(self) -> str:
        return API_HOSTS[self.env]

    @property
    def is_sandbox(self) -> bool:
        return self.env == "sandbox"


def load_config(required: bool = True) -> Config:
    data: dict[str, Any] = {}
    if CONFIG_PATH.exists():
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    client_id = os.environ.get("PLAID_CLIENT_ID") or data.get("client_id", "")
    secret = os.environ.get("PLAID_SECRET") or data.get("secret", "")
    env = (os.environ.get("PLAID_ENV") or data.get("env") or "sandbox").strip().lower()

    if env not in API_HOSTS:
        raise SystemExit(f"PLAID_ENV must be one of {', '.join(API_HOSTS)}; got {env!r}")
    if required and not (client_id and secret):
        raise SystemExit(
            "Missing Plaid credentials.\n"
            "  Set PLAID_CLIENT_ID and PLAID_SECRET in the environment, or write "
            f"{CONFIG_PATH.name}:\n"
            '  {"client_id": "...", "secret": "...", "env": "sandbox"}'
        )
    return Config(client_id, secret, env)


# --- api ----------------------------------------------------------------------


def api(cfg: Config, path: str, payload: dict[str, Any], *, retries: int = 0) -> dict[str, Any]:
    """POST to Plaid and return the decoded body, raising PlaidError on failure."""
    body = json.dumps({**payload, "client_id": cfg.client_id, "secret": cfg.secret}).encode()
    request = urllib.request.Request(
        f"{cfg.host}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"error_message": raw}
            error = PlaidError(parsed, exc.code)
            # A freshly linked item has no transactions ready yet. Plaid says so
            # explicitly rather than returning an empty page, so wait it out.
            retryable = error.code in {"PRODUCT_NOT_READY", "RATE_LIMIT_EXCEEDED"}
            if retryable and attempt < retries:
                attempt += 1
                delay = min(2 ** attempt, 15)
                print(f"  {error.code}, retrying in {delay}s ({attempt}/{retries})")
                time.sleep(delay)
                continue
            raise error


# --- secrets ------------------------------------------------------------------


def keychain_available() -> bool:
    if sys.platform != "darwin" or os.environ.get("PLAID_NO_KEYCHAIN"):
        return False
    return subprocess.run(["which", "security"], capture_output=True).returncode == 0


def secret_store(item_id: str, token: str) -> bool:
    """Save an access token in the Keychain. Returns False if unavailable."""
    if not keychain_available():
        return False
    result = subprocess.run(
        ["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
         "-a", item_id, "-w", token],
        capture_output=True,
    )
    return result.returncode == 0


def secret_fetch(item_id: str) -> str:
    if not keychain_available():
        return ""
    result = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", item_id, "-w"],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def secret_forget(item_id: str) -> None:
    if keychain_available():
        subprocess.run(
            ["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", item_id],
            capture_output=True,
        )


# --- store --------------------------------------------------------------------


def connect_store() -> sqlite3.Connection:
    conn = sqlite3.connect(STORE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_store(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS plaid_items (
            item_id TEXT PRIMARY KEY,
            env TEXT NOT NULL,
            institution_id TEXT NOT NULL DEFAULT '',
            institution_name TEXT NOT NULL DEFAULT '',
            -- Empty when the token lives in the Keychain, which is the normal case.
            access_token TEXT NOT NULL DEFAULT '',
            cursor TEXT NOT NULL DEFAULT '',
            linked_at TEXT NOT NULL DEFAULT '',
            last_synced_at TEXT NOT NULL DEFAULT '',
            last_error TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS plaid_accounts (
            account_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            official_name TEXT NOT NULL DEFAULT '',
            mask TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT '',
            subtype TEXT NOT NULL DEFAULT '',
            -- Which dashboard account this feeds. Empty means "not mapped", and
            -- an unmapped account is deliberately excluded from the dashboard
            -- rather than guessed at.
            dashboard_account TEXT NOT NULL DEFAULT '',
            current_balance REAL,
            available_balance REAL,
            balance_as_of TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS plaid_transactions (
            transaction_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            date TEXT NOT NULL,
            authorized_date TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            merchant_name TEXT NOT NULL DEFAULT '',
            amount REAL NOT NULL,
            iso_currency TEXT NOT NULL DEFAULT 'USD',
            pending INTEGER NOT NULL DEFAULT 0,
            pending_transaction_id TEXT NOT NULL DEFAULT '',
            category_primary TEXT NOT NULL DEFAULT '',
            category_detailed TEXT NOT NULL DEFAULT '',
            payment_channel TEXT NOT NULL DEFAULT '',
            raw_json TEXT NOT NULL DEFAULT '',
            first_seen_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_plaid_tx_account ON plaid_transactions(account_id);
        CREATE INDEX IF NOT EXISTS idx_plaid_tx_date ON plaid_transactions(date);
        """
    )
    conn.commit()
    try:
        STORE_PATH.chmod(0o600)
    except OSError:
        pass


def item_token(row: sqlite3.Row) -> str:
    return secret_fetch(row["item_id"]) or row["access_token"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- link ---------------------------------------------------------------------


LINK_PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Connect an account</title>
<style>
  body { font: 16px -apple-system, system-ui, sans-serif; margin: 0;
         display: grid; place-items: center; min-height: 100vh; background: #0f1115; color: #e7e9ee; }
  .card { text-align: center; max-width: 30rem; padding: 2rem; }
  button { font: inherit; padding: .75rem 1.5rem; border-radius: .5rem; border: 0;
           background: #4a7dff; color: #fff; cursor: pointer; }
  #status { margin-top: 1.5rem; color: #99a; min-height: 3rem; white-space: pre-line; }
  code { color: #8fd; }
</style>
<div class="card">
  <h1>Connect an account</h1>
  <p>Environment: <code>__ENV__</code></p>
  <button id="go">Open Plaid Link</button>
  <div id="status"></div>
</div>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
  const status = document.getElementById('status');
  const handler = Plaid.create({
    token: "__LINK_TOKEN__",
    onSuccess: async (public_token, metadata) => {
      status.textContent = 'Exchanging token\\u2026';
      const res = await fetch('/exchange', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({public_token, metadata}),
      });
      const body = await res.json();
      status.textContent = body.ok
        ? 'Linked ' + body.institution + '\\n' + body.accounts + '\\n\\nYou can close this tab and return to the terminal.'
        : 'Failed: ' + body.error;
    },
    onExit: (err) => {
      status.textContent = err ? ('Exited: ' + (err.display_message || err.error_message)) : 'Closed without linking.';
      fetch('/exit', {method: 'POST'});
    },
  });
  document.getElementById('go').onclick = () => handler.open();
  handler.open();
</script>
"""


def create_link_token(cfg: Config, access_token: str = "") -> str:
    """Create a link token. Passing an access_token puts Link in update mode.

    Update mode repairs the item you already have. Re-running the normal flow
    against a bank that only needs a fresh login would instead create a second
    item for it: the same transactions arriving twice under two item ids, and
    one more slot burned against the Trial plan's limit of 10.
    """
    payload: dict[str, Any] = {
        "user": {"client_user_id": "financials-local"},
        "client_name": "Financial Dashboard",
        "country_codes": ["US"],
        "language": "en",
    }
    if access_token:
        payload["access_token"] = access_token
    else:
        payload["products"] = ["transactions"]
        payload["transactions"] = {"days_requested": INITIAL_DAYS_REQUESTED}
    response = api(cfg, "/link/token/create", payload)
    return response["link_token"]


def register_item(conn: sqlite3.Connection, cfg: Config, access_token: str, item_id: str) -> tuple[str, list[str]]:
    """Persist a newly linked item plus its accounts. Returns (institution, account lines)."""
    institution_id = ""
    institution_name = ""
    try:
        item = api(cfg, "/item/get", {"access_token": access_token})
        institution_id = item.get("item", {}).get("institution_id") or ""
        if institution_id:
            info = api(cfg, "/institutions/get_by_id", {
                "institution_id": institution_id,
                "country_codes": ["US"],
            })
            institution_name = info.get("institution", {}).get("name", "")
    except PlaidError as exc:
        print(f"  could not read institution: {exc}")

    stored_in_keychain = secret_store(item_id, access_token)
    if not stored_in_keychain:
        print("  ! Keychain unavailable; storing the access token in plaid_store.sqlite "
              "(gitignored, chmod 600).")

    conn.execute(
        """
        INSERT INTO plaid_items (item_id, env, institution_id, institution_name,
                                 access_token, cursor, linked_at)
        VALUES (?, ?, ?, ?, ?, '', ?)
        ON CONFLICT(item_id) DO UPDATE SET
            env=excluded.env,
            institution_id=excluded.institution_id,
            institution_name=excluded.institution_name,
            access_token=excluded.access_token
        """,
        (item_id, cfg.env, institution_id, institution_name,
         "" if stored_in_keychain else access_token, now_iso()),
    )

    lines = refresh_accounts(conn, cfg, item_id, access_token, institution_name)
    conn.commit()
    return institution_name or institution_id or item_id, lines


def refresh_accounts(
    conn: sqlite3.Connection,
    cfg: Config,
    item_id: str,
    access_token: str,
    institution_name: str,
) -> list[str]:
    """Upsert accounts and balances for an item. Returns human-readable lines."""
    response = api(cfg, "/accounts/balance/get", {"access_token": access_token}, retries=3)
    as_of = now_iso()
    lines: list[str] = []
    for acct in response.get("accounts", []):
        account_id = acct["account_id"]
        acct_type = acct.get("type", "") or ""
        subtype = acct.get("subtype", "") or ""
        name = acct.get("name", "") or ""
        balances = acct.get("balances", {}) or {}

        existing = conn.execute(
            "SELECT dashboard_account FROM plaid_accounts WHERE account_id = ?",
            (account_id,),
        ).fetchone()
        # Never re-guess over a mapping that is already set; `map` is the only
        # thing that changes it once a human has looked at it.
        mapped = existing["dashboard_account"] if existing else ""
        if not mapped:
            mapped = guess_dashboard_account(institution_name, acct_type, subtype, name)

        conn.execute(
            """
            INSERT INTO plaid_accounts (account_id, item_id, name, official_name, mask,
                                        type, subtype, dashboard_account,
                                        current_balance, available_balance, balance_as_of)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                name=excluded.name,
                official_name=excluded.official_name,
                mask=excluded.mask,
                type=excluded.type,
                subtype=excluded.subtype,
                dashboard_account=excluded.dashboard_account,
                current_balance=excluded.current_balance,
                available_balance=excluded.available_balance,
                balance_as_of=excluded.balance_as_of
            """,
            (account_id, item_id, name, acct.get("official_name") or "", acct.get("mask") or "",
             acct_type, subtype, mapped,
             balances.get("current"), balances.get("available"), as_of),
        )
        label = mapped or "UNMAPPED"
        current = balances.get("current")
        shown = f"${current:,.2f}" if isinstance(current, (int, float)) else "n/a"
        lines.append(f"{name} ({subtype}) ****{acct.get('mask') or '????'}  -> {label}  {shown}")
    return lines


class LinkHandler(BaseHTTPRequestHandler):
    link_token = ""
    env = ""
    result: dict[str, Any] = {}
    done = threading.Event()

    def log_message(self, *args):  # keep the terminal clean
        pass

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/oauth"):
            page = LINK_PAGE.replace("__LINK_TOKEN__", self.link_token).replace("__ENV__", self.env)
            self._send(200, page.encode(), "text/html; charset=utf-8")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if self.path == "/exit":
            self._send(200, b'{"ok":true}', "application/json")
            LinkHandler.done.set()
            return
        if self.path != "/exchange":
            self._send(404, b'{"ok":false}', "application/json")
            return
        try:
            public_token = json.loads(raw)["public_token"]
            LinkHandler.result = {"public_token": public_token}
            payload = json.dumps({
                "ok": True,
                "institution": "your account",
                "accounts": "Return to the terminal to finish.",
            }).encode()
            self._send(200, payload, "application/json")
        except Exception as exc:  # noqa: BLE001 - surfaced to the browser
            LinkHandler.result = {"error": str(exc)}
            self._send(200, json.dumps({"ok": False, "error": str(exc)}).encode(), "application/json")
        LinkHandler.done.set()


def run_link_browser_flow(cfg: Config, link_token: str, timeout: int) -> str:
    """Serve Plaid Link on localhost and return the public token it produces."""
    LinkHandler.link_token = link_token
    LinkHandler.env = cfg.env
    LinkHandler.done = threading.Event()
    LinkHandler.result = {}

    server = ThreadingHTTPServer(("127.0.0.1", LINK_PORT), LinkHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{LINK_PORT}/"
    print(f"Opening {url} -- complete the flow in your browser.")
    if cfg.is_sandbox:
        print("Sandbox credentials: user_good / pass_good  (any 6-digit MFA code)")
    webbrowser.open(url)

    try:
        finished = LinkHandler.done.wait(timeout=timeout)
    except KeyboardInterrupt:
        server.shutdown()
        raise SystemExit("Cancelled.")
    server.shutdown()

    if not finished:
        raise SystemExit(f"Timed out after {timeout}s waiting for Link.")
    if "public_token" not in LinkHandler.result:
        raise SystemExit(LinkHandler.result.get("error", "Link closed without connecting an account."))
    return LinkHandler.result["public_token"]


def cmd_link(args: argparse.Namespace) -> int:
    cfg = load_config()
    conn = connect_store()
    ensure_store(conn)

    if args.update:
        item = conn.execute(
            "SELECT * FROM plaid_items WHERE item_id = ?", (args.update,)
        ).fetchone()
        if not item:
            raise SystemExit(f"No such item: {args.update}. See `status` for item ids.")
        token = item_token(item)
        if not token:
            raise SystemExit(f"No access token stored for {args.update}.")

        print(f"Re-authenticating {item['institution_name'] or args.update} (update mode)...")
        run_link_browser_flow(cfg, create_link_token(cfg, access_token=token), args.timeout)
        # Update mode repairs the existing item in place; the public token it
        # hands back is not exchanged and the access token never changes.
        lines = refresh_accounts(conn, cfg, item["item_id"], token, item["institution_name"])
        conn.execute(
            "UPDATE plaid_items SET last_error = '' WHERE item_id = ?", (item["item_id"],)
        )
        conn.commit()
        print(f"\nRepaired {item['institution_name'] or args.update}")
        for line in lines:
            print(f"  {line}")
        print("\nNext: python3 plaid_sync.py sync")
        return 0

    if args.instant:
        if not cfg.is_sandbox:
            raise SystemExit("--instant only works in sandbox (it mints a fake public token).")
        print(f"Creating a sandbox item at {args.institution}...")
        created = api(cfg, "/sandbox/public_token/create", {
            "institution_id": args.institution,
            "initial_products": ["transactions"],
            "options": {"webhook": "https://example.com/unused"},
        })
        public_token = created["public_token"]
    else:
        print(f"Creating a link token ({cfg.env})...")
        public_token = run_link_browser_flow(cfg, create_link_token(cfg), args.timeout)

    print("Exchanging the public token...")
    exchanged = api(cfg, "/item/public_token/exchange", {"public_token": public_token})
    access_token = exchanged["access_token"]
    item_id = exchanged["item_id"]

    institution, lines = register_item(conn, cfg, access_token, item_id)
    print(f"\nLinked {institution} (item {item_id})")
    for line in lines:
        print(f"  {line}")
    unmapped = [line for line in lines if "-> UNMAPPED" in line]
    if unmapped:
        print("\n  Unmapped accounts are excluded from the dashboard. Fix with:")
        print("    python3 plaid_sync.py map")
    print("\nNext: python3 plaid_sync.py sync")
    return 0


# --- sync ---------------------------------------------------------------------


def sync_item(conn: sqlite3.Connection, cfg: Config, row: sqlite3.Row, *, reset: bool) -> tuple[int, int, int]:
    access_token = item_token(row)
    if not access_token:
        raise PlaidError({"error_message": f"no access token stored for item {row['item_id']}"}, 0)

    cursor = "" if reset else (row["cursor"] or "")
    added = modified = removed = 0
    now = now_iso()

    while True:
        payload: dict[str, Any] = {"access_token": access_token, "count": 500}
        if cursor:
            payload["cursor"] = cursor
        response = api(cfg, "/transactions/sync", payload, retries=6)

        for tx in response.get("added", []):
            upsert_transaction(conn, row["item_id"], tx, now, first_seen=True)
            added += 1
        for tx in response.get("modified", []):
            upsert_transaction(conn, row["item_id"], tx, now, first_seen=False)
            modified += 1
        for tx in response.get("removed", []):
            conn.execute(
                "DELETE FROM plaid_transactions WHERE transaction_id = ?",
                (tx["transaction_id"],),
            )
            removed += 1

        cursor = response.get("next_cursor", cursor)
        if not response.get("has_more"):
            break

    conn.execute(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = ?, last_error = '' WHERE item_id = ?",
        (cursor, now, row["item_id"]),
    )
    conn.commit()
    return added, modified, removed


def upsert_transaction(
    conn: sqlite3.Connection,
    item_id: str,
    tx: dict[str, Any],
    now: str,
    *,
    first_seen: bool,
) -> None:
    pfc = tx.get("personal_finance_category") or {}
    conn.execute(
        """
        INSERT INTO plaid_transactions (
            transaction_id, account_id, item_id, date, authorized_date, name, merchant_name,
            amount, iso_currency, pending, pending_transaction_id,
            category_primary, category_detailed, payment_channel, raw_json,
            first_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
            account_id=excluded.account_id,
            date=excluded.date,
            authorized_date=excluded.authorized_date,
            name=excluded.name,
            merchant_name=excluded.merchant_name,
            amount=excluded.amount,
            pending=excluded.pending,
            pending_transaction_id=excluded.pending_transaction_id,
            category_primary=excluded.category_primary,
            category_detailed=excluded.category_detailed,
            payment_channel=excluded.payment_channel,
            raw_json=excluded.raw_json,
            updated_at=excluded.updated_at
        """,
        (
            tx["transaction_id"], tx["account_id"], item_id,
            tx.get("date", ""), tx.get("authorized_date") or "",
            tx.get("name") or "", tx.get("merchant_name") or "",
            float(tx.get("amount") or 0.0), tx.get("iso_currency_code") or "USD",
            1 if tx.get("pending") else 0, tx.get("pending_transaction_id") or "",
            pfc.get("primary") or "", pfc.get("detailed") or "",
            tx.get("payment_channel") or "",
            json.dumps(tx, separators=(",", ":")),
            now if first_seen else "", now,
        ),
    )


def cmd_sync(args: argparse.Namespace) -> int:
    cfg = load_config()
    conn = connect_store()
    ensure_store(conn)

    items = conn.execute(
        "SELECT * FROM plaid_items WHERE env = ? ORDER BY institution_name", (cfg.env,)
    ).fetchall()
    if not items:
        print(f"No items linked in {cfg.env}. Run: python3 plaid_sync.py link")
        return 1

    failures = 0
    for row in items:
        label = row["institution_name"] or row["item_id"]
        print(f"Syncing {label}...")
        try:
            added, modified, removed = sync_item(conn, cfg, row, reset=args.reset)
            access_token = item_token(row)
            lines = refresh_accounts(conn, cfg, row["item_id"], access_token, row["institution_name"])
            conn.commit()
            print(f"  +{added} added, ~{modified} modified, -{removed} removed")
            for line in lines:
                print(f"  {line}")
        except PlaidError as exc:
            failures += 1
            conn.execute(
                "UPDATE plaid_items SET last_error = ? WHERE item_id = ?",
                (str(exc), row["item_id"]),
            )
            conn.commit()
            print(f"  FAILED: {exc}")
            if exc.code in {"ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "ITEM_LOCKED"}:
                # Update mode, not a fresh link -- a second link would duplicate
                # the item rather than repair it.
                print(f"  Re-authenticate: python3 plaid_sync.py link --update {row['item_id']}")

    total = conn.execute("SELECT COUNT(*) FROM plaid_transactions").fetchone()[0]
    print(f"\nStore now holds {total} Plaid transactions ({STORE_PATH.name})")
    if cfg.is_sandbox:
        print("Sandbox data is fake and is NOT read by the dashboard build. "
              "See `preview` to check the mapping.")
    return 1 if failures else 0


# --- read side (shared with the dashboard build) --------------------------------


def load_dashboard_rows(env: str | None = None, *, include_pending: bool = False) -> list[dict[str, Any]]:
    """Return Plaid transactions shaped for build_financial_dashboard.py.

    Imported by the dashboard build. Returns an empty list when no store exists,
    so a repo without Plaid configured behaves exactly as it did before.
    """
    if not STORE_PATH.exists():
        return []
    conn = connect_store()
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"plaid_transactions", "plaid_accounts", "plaid_items"} <= tables:
            return []
        query = """
            SELECT t.*, a.dashboard_account, a.mask, i.env, i.institution_name
            FROM plaid_transactions t
            JOIN plaid_accounts a ON a.account_id = t.account_id
            JOIN plaid_items i ON i.item_id = t.item_id
            WHERE a.dashboard_account <> ''
        """
        params: list[Any] = []
        if env:
            query += " AND i.env = ?"
            params.append(env)
        if not include_pending:
            query += " AND t.pending = 0"
        query += " ORDER BY t.date DESC"
        rows = [dict(r) for r in conn.execute(query, params)]
    finally:
        conn.close()

    out: list[dict[str, Any]] = []
    for row in rows:
        account = row["dashboard_account"]
        plaid_amount = float(row["amount"])
        cost = round(plaid_amount, 2)
        amount = round(-plaid_amount if account in AMOUNT_IS_NEGATIVE_FOR_SPEND else plaid_amount, 2)
        out.append({
            "transaction_id": row["transaction_id"],
            "account": account,
            "date": row["date"],
            # Plaid's `name` is the raw bank descriptor, which is what the
            # dashboard's CATEGORY_RULES were written against. merchant_name is
            # cleaner but too clean -- "Uber" loses the "uber eats" that the
            # rules use to separate a ride from a delivery.
            "description": row["name"] or row["merchant_name"] or "Plaid transaction",
            "merchant_name": row["merchant_name"],
            "amount": amount,
            "cost": cost,
            # Kept separate, and deliberately NOT collapsed into one "native
            # category" string: the dashboard translates these through its own
            # table and needs to fall back from detailed to primary itself.
            "category_primary": row["category_primary"],
            "category_detailed": row["category_detailed"],
            "native_category": row["category_detailed"] or row["category_primary"],
            "pending": bool(row["pending"]),
            "env": row["env"],
            "institution": row["institution_name"],
            "mask": row["mask"],
        })
    return out


def load_balances(env: str | None = None) -> list[dict[str, Any]]:
    if not STORE_PATH.exists():
        return []
    conn = connect_store()
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"plaid_accounts", "plaid_items"} <= tables:
            return []
        query = """
            SELECT a.*, i.env, i.institution_name
            FROM plaid_accounts a JOIN plaid_items i ON i.item_id = a.item_id
        """
        params: list[Any] = []
        if env:
            query += " WHERE i.env = ?"
            params.append(env)
        return [dict(r) for r in conn.execute(query, params)]
    finally:
        conn.close()


# --- status / preview / map / unlink -------------------------------------------


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config(required=False)
    if not STORE_PATH.exists():
        print(f"No store yet ({STORE_PATH.name}). Run: python3 plaid_sync.py link")
        return 1
    conn = connect_store()
    ensure_store(conn)

    print(f"Environment: {cfg.env}    store: {STORE_PATH.name}")
    items = conn.execute("SELECT * FROM plaid_items ORDER BY env, institution_name").fetchall()
    if not items:
        print("No linked items.")
        return 1

    for item in items:
        marker = "*" if item["env"] == cfg.env else " "
        print(f"\n{marker} {item['institution_name'] or '(unknown)'}  [{item['env']}]  {item['item_id']}")
        print(f"    linked {item['linked_at'] or '?'}    last sync {item['last_synced_at'] or 'never'}")
        if item["last_error"]:
            print(f"    last error: {item['last_error']}")
        if item["access_token"]:
            print("    ! access token stored in sqlite (Keychain was unavailable)")
        accounts = conn.execute(
            "SELECT * FROM plaid_accounts WHERE item_id = ? ORDER BY name", (item["item_id"],)
        ).fetchall()
        for acct in accounts:
            count, first, last = conn.execute(
                "SELECT COUNT(*), MIN(date), MAX(date) FROM plaid_transactions WHERE account_id = ?",
                (acct["account_id"],),
            ).fetchone()
            balance = acct["current_balance"]
            shown = f"${balance:,.2f}" if isinstance(balance, (int, float)) else "n/a"
            target = acct["dashboard_account"] or "UNMAPPED (excluded)"
            print(f"    {acct['name']} ****{acct['mask'] or '????'} ({acct['subtype']}) -> {target}")
            print(f"        balance {shown}    {count} tx    {first or '-'} .. {last or '-'}")
    return 0


def cmd_preview(args: argparse.Namespace) -> int:
    cfg = load_config(required=False)
    rows = load_dashboard_rows(env=args.env or cfg.env, include_pending=args.pending)
    if not rows:
        print("Nothing to preview. Link and sync first, or check `status` for unmapped accounts.")
        return 1

    print(f"{len(rows)} transactions would map into the dashboard as:\n")
    print(f"{'DATE':<12} {'ACCOUNT':<13} {'AMOUNT':>10} {'COST':>10}  DESCRIPTION")
    for row in rows[: args.limit]:
        print(f"{row['date']:<12} {row['account']:<13} {row['amount']:>10.2f} "
              f"{row['cost']:>10.2f}  {row['description'][:44]}")
    if len(rows) > args.limit:
        print(f"... and {len(rows) - args.limit} more (--limit to see more)")

    by_account: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_account.setdefault(row["account"], []).append(row)
    print("\nPer account:")
    for account, group in sorted(by_account.items()):
        dates = sorted(r["date"] for r in group)
        spend = sum(r["cost"] for r in group if r["cost"] > 0)
        print(f"  {account:<13} {len(group):>4} tx  {dates[0]} .. {dates[-1]}  "
              f"outflow ${spend:,.2f}")

    balances = [b for b in load_balances(env=args.env or cfg.env) if b["dashboard_account"]]
    if balances:
        print("\nBalances:")
        for b in balances:
            current = b["current_balance"]
            shown = f"${current:,.2f}" if isinstance(current, (int, float)) else "n/a"
            print(f"  {b['dashboard_account']:<13} {shown:>14}   as of {b['balance_as_of'][:19]}")
    return 0


def cmd_map(args: argparse.Namespace) -> int:
    conn = connect_store()
    ensure_store(conn)
    accounts = conn.execute(
        """
        SELECT a.*, i.institution_name, i.env FROM plaid_accounts a
        JOIN plaid_items i ON i.item_id = a.item_id ORDER BY i.institution_name, a.name
        """
    ).fetchall()
    if not accounts:
        print("No accounts linked yet.")
        return 1

    if args.account_id and args.dashboard_account:
        target = args.dashboard_account
        if target not in DASHBOARD_ACCOUNTS and target != "":
            print(f"Warning: {target!r} is not one of the dashboard's existing accounts "
                  f"({', '.join(DASHBOARD_ACCOUNTS)}). It will appear as a new account tab.")
        updated = conn.execute(
            "UPDATE plaid_accounts SET dashboard_account = ? WHERE account_id = ?",
            (target, args.account_id),
        ).rowcount
        conn.commit()
        print(f"Updated {updated} account.")
        return 0 if updated else 1

    print("Linked Plaid accounts:\n")
    for acct in accounts:
        print(f"  {acct['account_id']}")
        print(f"      {acct['institution_name']} / {acct['name']} ****{acct['mask'] or '????'} "
              f"({acct['type']}/{acct['subtype']}) [{acct['env']}]")
        print(f"      -> {acct['dashboard_account'] or 'UNMAPPED (excluded from dashboard)'}")
    print(f"\nDashboard accounts: {', '.join(DASHBOARD_ACCOUNTS)}")
    print("Set one with:")
    print("  python3 plaid_sync.py map --account-id <id> --dashboard-account 'Checking'")
    print("Exclude one with an empty name:")
    print("  python3 plaid_sync.py map --account-id <id> --dashboard-account ''")
    return 0


def cmd_unlink(args: argparse.Namespace) -> int:
    cfg = load_config(required=False)
    conn = connect_store()
    ensure_store(conn)
    item = conn.execute("SELECT * FROM plaid_items WHERE item_id = ?", (args.item_id,)).fetchone()
    if not item:
        print(f"No such item: {args.item_id}")
        return 1

    counts = conn.execute(
        "SELECT COUNT(*) FROM plaid_transactions WHERE item_id = ?", (args.item_id,)
    ).fetchone()[0]
    print(f"About to forget {item['institution_name'] or args.item_id}: "
          f"{counts} transactions and its access token.")
    if not args.yes:
        if input("Type 'yes' to confirm: ").strip().lower() != "yes":
            print("Aborted.")
            return 1

    # Tell Plaid to release it too, so a Trial-plan Item slot is freed.
    token = item_token(item)
    if token and cfg.client_id and cfg.secret:
        try:
            api(cfg, "/item/remove", {"access_token": token})
            print("  removed at Plaid")
        except PlaidError as exc:
            print(f"  could not remove at Plaid ({exc}); continuing with local cleanup")

    conn.execute("DELETE FROM plaid_transactions WHERE item_id = ?", (args.item_id,))
    conn.execute("DELETE FROM plaid_accounts WHERE item_id = ?", (args.item_id,))
    conn.execute("DELETE FROM plaid_items WHERE item_id = ?", (args.item_id,))
    conn.commit()
    secret_forget(args.item_id)
    print("Forgotten locally.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_link = sub.add_parser("link", help="connect an account through Plaid Link")
    p_link.add_argument("--instant", action="store_true",
                        help="sandbox only: mint a test item without a browser")
    p_link.add_argument("--update", metavar="ITEM_ID",
                        help="re-authenticate an existing item instead of adding a new one")
    p_link.add_argument("--institution", default="ins_109508",
                        help="sandbox institution id for --instant (default: First Platypus Bank)")
    p_link.add_argument("--timeout", type=int, default=300, help="seconds to wait for the browser flow")
    p_link.set_defaults(func=cmd_link)

    p_sync = sub.add_parser("sync", help="pull new transactions and balances")
    p_sync.add_argument("--reset", action="store_true",
                        help="drop saved cursors and re-pull full history")
    p_sync.set_defaults(func=cmd_sync)

    p_status = sub.add_parser("status", help="show linked items, accounts and freshness")
    p_status.set_defaults(func=cmd_status)

    p_preview = sub.add_parser("preview", help="show how Plaid rows map into the dashboard")
    p_preview.add_argument("--limit", type=int, default=25)
    p_preview.add_argument("--pending", action="store_true", help="include pending transactions")
    p_preview.add_argument("--env", default="", help="preview a specific environment")
    p_preview.set_defaults(func=cmd_preview)

    p_map = sub.add_parser("map", help="point a Plaid account at a dashboard account")
    p_map.add_argument("--account-id")
    p_map.add_argument("--dashboard-account")
    p_map.set_defaults(func=cmd_map)

    p_unlink = sub.add_parser("unlink", help="forget an item, its transactions and its token")
    p_unlink.add_argument("item_id")
    p_unlink.add_argument("--yes", action="store_true")
    p_unlink.set_defaults(func=cmd_unlink)

    args = parser.parse_args()
    try:
        return args.func(args)
    except PlaidError as exc:
        print(f"Plaid error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
