# Handover — financials migration to Supabase

Written 2026-08-10 at the end of the session that did the migration. `README.md` covers
how to operate the thing; this covers what state it is in, what was decided and why, and
the traps that cost real time.

## Where it stands

Live at `cs-ventures.us/dev/login` → **Financials**. Everything below is verified against
the production database, not a local copy.

| | |
|---|---|
| `fin` schema | `service_role` locked out by grants, not RLS |
| Read path | all aggregation in SQL; `fin_parity.py` passes all four blocks |
| Ingest | Plaid sync runs inside Postgres, on tab view; no laptop involved |
| Credentials | split so the agent runner can never hold both halves |
| Dashboard | branded, tabs native to the console, sync-on-view |
| Forecast | committed/variable split, day-type rates, accuracy snapshots |
| Monthly | computed live, so Review overrides flow through |

Working tree is clean and everything is pushed to `main`. `~/financials` is the **stale**
original — 800 lines behind and missing the whole forecast tab. Do not build from it.
`~/Documents/Code/Financials-p` was an intermediate step, local-only, never pushed, and is
redundant.

## Decisions, and why they went that way

**Aggregation is SQL, not a payload pushed from the Mac.** The deciding factor was Review
write-back: changing a category has to move the summary, the cash-flow bridge and the
insights. With a precomputed payload that either does nothing until a local rebuild, or
you reimplement the aggregation in browser JS — paying the port cost anyway, in a worse
language, with no parity test.

**The dashboard runs in a same-origin iframe.** Its markup uses `id="app"` and `id="tabs"`,
which collide head-on with the console's, and its 243 lines of CSS use bare selectors that
would bleed everywhere. `fin_build_frame.py` takes `render_html()`'s exact output and
rewires it, so the deployed UI cannot drift from the version validated locally. The
console's tab bar drives it over `postMessage`.

**`service_role` is kept out by GRANTS.** It carries `BYPASSRLS`, so RLS alone would not
stop the agent runner. It is never granted `USAGE` on `fin`. This is the one invariant
with a test pinning it.

**Credentials are split.** Supabase grants `service_role` plaintext read on Vault, and
that grant belongs to `supabase_admin` — `postgres` cannot revoke it. Anything left in
Vault is permanently readable by the runner. So the encryption key is in Vault (useless
alone) and the pgcrypto ciphertext is in `fin.plaid_credentials`, which the runner cannot
reach.

**Sync on view, not cron.** The data has exactly one consumer. A timer spends Plaid calls
whether or not anyone is looking and still serves stale data at the moment they are. This
also matches the console's existing `refreshFleetOnView`.

**Only settled charges enter the model.** Pending amounts are provisional — a tip changes
them, an authorisation and its reversal both appear. Pending rows are still *staged*,
which is what lets a charge be recognised when it posts.

## Open items

Nothing is known-broken. These are worth doing:

1. **Nobody has looked at the Forecast tab in a browser.** Every number is verified against
   the database and the frame's JS parses, but the committed table, the stepped chart and
   the accuracy block have never been seen rendered. Most likely place for a visual bug.
2. **Seasonality is inert until 2027.** A calendar month needs a full trailing 12-month
   window to count, and history starts 2025-01. Correct behaviour, but do not describe
   summer spend as modelled.
3. **The accuracy loop corrects nothing yet**, by design — it needs two completed months.
   Its value today is the record. The real test is next month: compare what it predicted
   on the 9th against what landed.
4. **Account tabs are hardcoded** in `dev/login/index.html` and `FIN_TABS` in `app.js`.
   Linking a new institution needs a line in each. A test catches them disagreeing, not one
   being missing.
5. **No `CLAUDE.md` in this repo.** Worth running `/init` — a lot of the reasoning lives in
   commit messages and would otherwise be rediscovered the hard way.
6. `/chs.product-team-loop` was requested for one backlog cycle and never run.

## Traps that cost real time

**Codex's sandbox has no network.** Across five runs, its "validated on live data" claims
covered only the Python it could run locally. One shipped SQL with an ambiguous
`month_start` that failed on first execution. Three completed their edits on disk but
never exited — check `git status` and grep for expected markers rather than waiting, then
kill the process. Apply its migrations and re-run the real checks yourself.

**The parity harness proves agreement, not correctness.** It shows Python and SQL match. It
caught a $1,880 error in the derived checking balance when Venmo was miscategorised as a
cash account, and it is the reason the Monthly tab bug was findable. It cannot tell you
either implementation is right.

**PostgREST needs the schema on its exposed list, separate from database grants.** Both
must pass. The dashboard toggle did not persist; it was set directly on the `authenticator`
role. If Supabase's control plane ever re-applies its own copy, `fin` drops off and the tab
breaks with nothing in the logs. Re-saving it through the dashboard is still outstanding.

**`build-site.sh` publishes only git-tracked files and excludes `financials/` by name.**
Without that exclusion `build_financial_dashboard.py` would be served publicly, and
`CATEGORY_RULES` in it lists every merchant in the transaction history.

**Verify claims against the live database.** Every defect that mattered this session —
$1,880 in the balance, a $0 rent forecast, a $12,716 high band, five stale Monthly rows,
nine missing Amex charges — looked plausible and passed a casual read. None were found by
reasoning; all were found by running the numbers.

## Quick verification

```bash
cd financials
python3 fin_parity.py          # must PASS all four blocks
```

```sql
select has_schema_privilege('service_role','fin','USAGE');   -- must be false
select fin.api_integrity();                                  -- 0 missing, 0 duplicates
select institution, last_synced_at, last_error from fin.plaid_items order by institution;
```
