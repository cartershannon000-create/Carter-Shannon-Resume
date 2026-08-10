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

## Status

Everything below is live and verified against the production database.

- **Ingest** — Plaid sync runs inside Postgres, triggered when the dashboard is opened.
  Nothing local is involved.
- **Read path** — all aggregation is SQL. `fin_parity.py` diffs it against the Python
  reference field by field at zero tolerance and passes on all four blocks.
- **Monthly** — months beyond the budget workbook are computed live, so a Review override
  moves them. Compensation constants live in `fin.compensation`, not in code.
- **Forecast** — committed/variable split with day-type rates. See `FORECAST_SPEC.md`,
  which also records the models that were tried and rejected.
- **Accuracy** — every forecast is snapshotted. Corrections are disabled below two
  completed months, so today they do nothing by design.

### Things to know

- **Seasonality is inert until 2027.** A calendar month needs a full trailing 12-month
  window to count as an observation and history starts 2025-01. Correct, but do not
  describe summer spend as modelled yet.
- **`food` forecasts negative.** Venmo reimbursements offset it. Consistent with every
  other tab; flagged as `net_negative` rather than hidden with an absolute.
- **Account tabs are hardcoded** in `dev/login/index.html` and `FIN_TABS`. Linking a new
  institution needs a line in each. A test catches them disagreeing, not one being missing.
- **The parity harness proves agreement, not correctness.** It shows Python and SQL match.
  Whether either is right is what the forecast snapshots are for — next month, compare
  what was predicted on the 9th against what landed.
- **Verify Codex against the live database.** Its sandbox has no network, so its
  "validated on live data" claims cover Python only.
