# financials

The pipeline behind the **Financials** tab at `cs-ventures.us/dev/login`.

This directory is **never published**. `build-site.sh` excludes it by name, and it stages
from `git ls-files`, so nothing here reaches the web even by accident. That matters:
`CATEGORY_RULES` in `build_financial_dashboard.py` is a list of every merchant Carter
shops at, and `PLAID.md` documents the bank setup.

**The code here is tracked. None of the data it operates on ever is.** `financials.sqlite`,
`plaid_store.sqlite`, `plaid_config.json`, the budget workbook, and `Source data/` are all
gitignored. If you are adding a file and are unsure which side of the line it falls on,
assume it is data and leave it out.

## What deploys

Only `../dev/login/financials-frame.html`, which is generated from this code and ships
with an empty payload, plus the control-plane wiring in `../dev/login/app.js` and the
`fin` migrations in `../supabase/migrations/`.

## How data reaches the dashboard

```
Plaid  ─┐
CSV/xlsx├─→ build_financial_dashboard.py ─→ financials.sqlite
Workbook┘        (categorisation, dedupe)         │
                                                  │  fin_backfill.py
                                                  ▼
                                          Supabase  fin.transactions
                                                  │
                                    fin.api_financial_state()   ← all aggregation is SQL
                                                  │   summary · cashflow · insights
                                                  ▼
                              ../dev/login/app.js ──postMessage──→ financials-frame.html
                                                  ▲
                                    fin.api_set_category()  ← Review tab write-back
```

The aggregation that used to run in Python — monthly summary, the stock-and-flow cash
model, insights — now runs in Postgres. That is what lets a category override in the
Review tab move the summary, the cash-flow bridge, and the insights without a rebuild.

**Nothing here runs in the cloud yet.** `plaid_sync.py` reads access tokens from the macOS
Keychain on this machine, so the dashboard is only as current as the last manual run:

```bash
python3 plaid_sync.py sync          # pull new transactions from the banks
python3 build_financial_dashboard.py    # categorise, dedupe → financials.sqlite
python3 fin_backfill.py --commit    # push to Supabase
```

Moving that to a Supabase Edge Function is what `fin_ingest` and `fin.plaid_items` exist
for, and until it is done, closing this laptop stops the data updating.

## Setup

Needs `psycopg` (v3) and `openpyxl`. The database connection string goes in a gitignored
`.env` beside these scripts:

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
```

Take the URI from the Supabase dashboard under **Connect → Session pooler**. Direct
connection is IPv6-only and will hang from a typical home network.

## Operations

**Regenerate the deployed UI** — after any change to `render_html()`:

```bash
python3 fin_build_frame.py
```

Takes `render_html()`'s exact output and rewires it for the control plane: strips the
embedded payload, defers `init()` until the parent posts data, and adds a `parent`
override backend beside the existing `local` and `server` ones. Writes to
`../dev/login/financials-frame.html`, **which must be committed** — `build-site.sh`
publishes only tracked files, so an uncommitted frame 404s in production. The generator
refuses to write if a transaction leaks into the output.

**Check the SQL still matches the Python** — after touching either side:

```bash
python3 fin_parity.py
```

Diffs `build_payload()` against the SQL helpers field by field at zero tolerance. The
cash-flow bridge is the one that matters: it hangs off a single hand-verified balance and
is validated to the cent against the real account, so anything other than `PASS cashflow`
means the port is wrong.

## Security model

`fin` is separate from `cos`, enforced by **grants, not RLS**. The agent runner
authenticates as `service_role`, which carries `BYPASSRLS` — row level security alone
would not keep it out. It is never granted `USAGE` on the schema:

```sql
select has_schema_privilege('service_role','fin','USAGE');   -- must be false
```

Every table has RLS on with no policies. The only reachable entry points are
`fin.api_financial_state()` and `fin.api_set_category()`, executable by `authenticated`
only and both gated on `cos.is_owner()`. See `../supabase/README.md` for the PostgREST
exposed-schemas requirement, which is a separate gate from these grants.

## Known gaps

- `plaid_sync.py` runs locally against the macOS Keychain, so nothing updates while this
  machine is off.
- `extend_monthly_summary_with_actuals()` and `reconcile_salary_rows()` are not ported to
  SQL. `fin.monthly_summary()` serves stored values, so the Salary, Net Income, Margin,
  and Total Savings rows go stale if a Review override moves a transaction into or out of
  `salary`, or when a new month arrives with no workbook column.
- The Review tab's "Saved overrides" count reads 0 on load, because overrides are resolved
  server-side and baked into the payload. In-session edits count correctly.

## Autonomous sync (added 2026-08-09)

The sync runs **inside Postgres**, triggered when the dashboard is opened, so it stays
current whether or not this machine is on:

```
open the Financials tab (or press Refresh)
  -> fin.api_sync_plaid_on_view()   owner-gated, debounced 15 min (60s on Refresh)
  -> fin.sync_plaid()
       reads credentials from fin.plaid_credentials (pgcrypto), key from Vault
       POST production.plaid.com/transactions/sync  (cursor paging, http extension)
       upserts fin.plaid_transactions            <- raw staging, mirrors plaid_store.sqlite
  -> fin.rebuild_plaid_transactions()
       derives fin.transactions from the WHOLE staging table
```

The two-step shape is deliberate. `/transactions/sync` is incremental, but
`fin.transactions` is keyed on a fingerprint rather than Plaid's `transaction_id`, and
`occurrence` is computed by ranking identical rows across the entire feed. Deriving from
the full staging table each time makes the whole thing idempotent: a repeated or
overlapping run cannot double-count.

There is no Edge Function and no `fin_ingest` password. The functions are SECURITY
DEFINER owned by `postgres`; `service_role` is granted nothing, as everywhere else here.

### One-time setup

```bash
python3 fin_setup_cloud_sync.py             # account mapping + item list
python3 fin_setup_cloud_sync.py --secrets   # copy credentials into Vault
```

`--secrets` moves the Plaid client id, secret, and one access token per institution out
of the macOS Keychain into the database. Read the note at the top of that file first:
those tokens can read your bank transactions and will then live in Supabase, not only on
this Mac. The Keychain copies stay, so it is reversible — delete the rows in
`fin.plaid_credentials` to undo it.

**Why the credentials are not simply in Vault.** Supabase grants `service_role` — the
agent runner's identity — plaintext read on `vault.decrypted_secrets`, and that grant is
owned by `supabase_admin`, so `postgres` cannot revoke it. Anything left in Vault is
permanently readable by the runner, which for bank tokens is a worse exposure than the
transaction data itself. So the halves are split: the encryption key in Vault, which the
runner can read and which is useless alone, and the pgcrypto ciphertext in
`fin.plaid_credentials`, which it has no schema access to reach. Verify with:

```sql
select has_schema_privilege('service_role','fin','USAGE');            -- must be false
select has_table_privilege('service_role','fin.plaid_credentials','SELECT');  -- false
``` Until they exist, the cron job fails every run and records why
in `fin.plaid_items.last_error`, and the tab keeps rendering the last known state.

### Why on view rather than on a schedule

This data has exactly one consumer: a dashboard someone looks at. A cron job spends Plaid
calls whether or not anyone is watching, and still serves data up to its interval stale at
the moment they are. On view, nothing is fetched when nobody is looking, and what you see
was fetched seconds ago. It also matches the console's existing `refreshFleetOnView`.

The cached payload renders first and the sync runs behind it, so a slow bank never blocks
the page. `fin.api_sync_plaid_on_view` carries its own `statement_timeout` of 55s because
`authenticator` runs with 8s, which four banks paged over HTTP would exceed.

### Checking on it

```sql
select institution, last_synced_at, last_error from fin.plaid_items order by institution;
select fin.api_sync_plaid_on_view(1);   -- force a sync now, as the owner
```

### Categorisation

`fin.category_rules` and friends are a replica, not the source. Rules are authored in
`build_financial_dashboard.py` (the monthly review skill appends to `CATEGORY_RULES`) and
pushed with:

```bash
python3 fin_sync_rules.py     # push, then verify against Python
```

Verification runs both implementations over every distinct description in the local
database. It currently agrees on all 1,433. **Run it after adding any rule** — otherwise
new transactions get classified by rules the cloud has never seen.
