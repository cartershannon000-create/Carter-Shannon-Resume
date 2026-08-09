# Plaid live feed

Pulls transactions and balances straight from the banks instead of downloading
CSVs by hand. `plaid_sync.py` owns the connection and writes to
`plaid_store.sqlite`; `build_financial_dashboard.py` reads that store as just
another source, categorised by the same rules as everything else.

## Sandbox does not give you your money

Sandbox only serves fake test banks ("First Platypus Bank"). It is for proving
the pipeline works. Real balances need Plaid's **Trial plan** — free, up to 10
live Items, includes OAuth banks like Wells Fargo, Capital One and Amex. Your
setup is 4–5 accounts, so it fits.

Because of that, **sandbox data can never reach the dashboard.** The build reads
`production` rows only. Sync and `preview` sandbox all you want; it stops there.

## Setup

```bash
export PLAID_CLIENT_ID=...          # Plaid dashboard -> Developers -> Keys
export PLAID_SECRET=...             # the secret for the environment you want
export PLAID_ENV=sandbox            # or production
```

Or write `plaid_config.json` (gitignored):

```json
{"client_id": "...", "secret": "...", "env": "sandbox"}
```

## Prove it works on sandbox

```bash
python3 plaid_sync.py link --instant   # fake bank, no browser
python3 plaid_sync.py sync
python3 plaid_sync.py status
python3 plaid_sync.py preview          # how these rows WOULD land in the dashboard
```

`link` without `--instant` opens the real Plaid Link UI at
`http://127.0.0.1:8777`. In sandbox, log in with `user_good` / `pass_good` and
any 6-digit MFA code.

## Go live

1. Request Trial or Production access in the Plaid dashboard.
2. `export PLAID_ENV=production` and swap in the production secret.
3. `python3 plaid_sync.py link` once per bank — Wells Fargo, Capital One, Amex,
   Venmo. Desktop Chrome handles the banks' OAuth pop-ups without any redirect
   URI registered; that is only needed for mobile webviews.
4. `python3 plaid_sync.py status` and confirm every account maps to the right
   dashboard account. The guesser knows that Wells Fargo *checking* is
   `Checking` while the Wells Fargo *card* is `Wells Fargo`, but check it.
   Fix anything wrong with `map`; an `UNMAPPED` account is silently excluded.
5. `python3 plaid_sync.py sync`
6. `python3 plaid_sync.py preview` — check the signs and the date ranges before
   letting any of it near the dashboard.
7. Set the takeover date in `build_financial_dashboard.py`:

   ```python
   PLAID_TAKEOVER_DATE: date | None = date(2026, 8, 1)
   ```

8. `python3 build_financial_dashboard.py`

Then the monthly routine is `plaid_sync.py sync` and rebuild. No more downloads.

## The takeover date, and why it exists

Plaid and the CSV exports describe the same charge with different words. The
build's dedupe fingerprints on the description, so it cannot tell they are the
same thing — the charge would land twice and every total would be wrong.

`PLAID_TAKEOVER_DATE` is the hard line. On and after it, accounts Plaid covers
belong to Plaid and their CSV rows are dropped. Before it, the CSVs stand
untouched and Plaid is ignored. Accounts Plaid does *not* cover are unaffected
at every date.

Pick a date at a month boundary after your last complete CSV import, and
**leave the old CSVs in `Source data/`** — they are still the source of truth
for everything before the line.

While `PLAID_TAKEOVER_DATE` is `None`, Plaid contributes nothing at all. An
unconfigured live feed changes no number in the dashboard.

## How Plaid rows get categorised

Two passes, in this order:

1. **Your description rules** (`CATEGORY_RULES`) run first and alone. They are
   tuned to the merchants that actually appear on your statements and they beat
   any generic taxonomy — "uber eats" still lands in Food rather than Uber.
2. Only if nothing matched, **Plaid's category is translated** through
   `PLAID_CATEGORY_BY_DETAILED` / `PLAID_CATEGORY_BY_PRIMARY`.

Plaid's raw taxonomy is never used as a category. It has 104 values, and letting
them through would invent categories like "General Merchandise Gifts And
Novelties" that the budget comparison and the Review tab cannot place. Of the
104, 72 translate to a real category and 32 deliberately land in
`uncategorized` so they show up in Review.

Those 32 are not an oversight. They are the values where a wrong guess does real
damage rather than just mis-bucketing an expense — `INCOME_*`, `TRANSFER_IN_*`,
`TRANSFER_OUT_ACCOUNT_TRANSFER`, `LOAN_PAYMENTS_*` — because those drive income,
savings and card-payment accounting and would quietly distort the cash flow
bridge. Plus `MEDICAL_*` and `ENTERTAINMENT_*`, which have no equivalent in the
budget. Categorise them once in the Review tab and the override sticks forever;
`category_overrides` survives every rebuild.

## Where the secrets live

Access tokens are long-lived bank credentials. They go in the macOS Keychain
(`security find-generic-password -s financials-plaid`). Only if the Keychain is
unavailable do they fall back into `plaid_store.sqlite`, which is gitignored and
chmod 600, and `status` says so when that happens.

`plaid_config.json` and `plaid_store.sqlite` are both gitignored. Keep it that
way.

## Commands

| command | what it does |
|---|---|
| `link` | connect an account (browser); `--instant` for a sandbox fake |
| `link --update <item_id>` | re-authenticate an existing bank (see below) |
| `sync` | pull new transactions and balances; `--reset` re-pulls all history |
| `status` | what is linked, how fresh, balances, transaction counts |
| `preview` | how the rows map into dashboard accounts, signs and totals |
| `map` | point a Plaid account at a dashboard account |
| `unlink <item_id>` | forget an item locally and release it at Plaid |

## Notes

- **Pending transactions are excluded.** They change amount and id when they
  post, which would churn dashboard rows. `preview --pending` to see them.
- **Same-day duplicate charges survive**, unlike the CSV path — Plaid gives each
  a unique id. That fixes the known `Source data/README.md` limitation where two
  identical Metro fares collapse into one.
- **Balances are captured on every sync** but are not yet wired into the cash
  flow model. `OPENING_BALANCE_ANCHOR` is still the hand-validated anchor from
  2026-03-31. Once a few live balances have been confirmed against the real
  account, that anchor can move to a Plaid balance and stop being manual.
- **Re-authentication:** banks expire logins every few months. `sync` reports
  `ITEM_LOGIN_REQUIRED` and prints the exact command, which is
  `link --update <item_id>` — **not** a plain `link`. Update mode repairs the
  connection you already have; a plain `link` would add a *second* item for the
  same bank, so every transaction would arrive twice under two item ids and you
  would burn another slot against the 10-Item limit.
