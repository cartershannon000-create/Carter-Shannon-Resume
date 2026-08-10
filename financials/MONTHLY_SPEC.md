# Monthly tab — compute post-workbook months in SQL

## The bug, concretely

`fin.monthly_summary()` serves values written to `fin.monthly_summary_rows` at backfill
time. Python used to recompute them on every build; that recomputation was never ported.
It stayed invisible until the Review tab was used in production on 2026-08-09, when three
category overrides moved money and the Monthly tab did not follow:

| row | Monthly shows | actual | off by |
|---|---|---|---|
| Travel | $0.00 | $130.00 | −$130 |
| Service | $85.98 | $55.98 | +$30 |
| Clothing | $0.00 | $30.00 | −$30 |
| Donations | $50.00 | $80.00 | −$30 |
| Bet | $59.74 | $29.74 | +$30 |

Every other tab recomputes from `fin.v_transactions` and is correct. Monthly is the only
one reading storage. It is also the only reason `fin_parity.py` still fails.

## What to port

Two functions in `build_financial_dashboard.py`:

### `extend_monthly_summary_with_actuals()`

Fills months that the budget workbook has no column for — everything after its last month
— with actuals computed from transactions. For each such month:

```
total        = sum of cost over categories that are NOT internal and NOT rent
rent_val     = -cost of category 'rent'
salary_val   = -cost of category 'salary'
k401         = 779.17 if month < '2025-07' else 830.50
ira          = 141.67 if month < '2025-07' else 151.00
total_inv    = k401 + ira
net_income   = salary_val - total + rent_val
margin       = net_income / salary_val, or 0 when salary is 0
annual_salary= 85000.00 if month < '2025-07' else 90600.00
```

Row values by label: `Total`, `Rent`, `Salary`, `Net Income`, `Margin`, `401k`, `IRA`,
`Additional Savings` (always 0), `Total Inv Savings` (= total_inv), `Total Savings`
(= net_income + total_inv). Rows with `style = 'spacer-row'` are skipped. The single
unlabelled row of `kind = 'integer'` takes `annual_salary`. Every other row takes the
cost of the category matching its lowercased label.

An `event` row is inserted immediately before `Total` if absent — `event` is a real spend
category with no workbook row, and without it the category rows stop reconciling to Total.

`mom` stays in the spend pool with its negative value and pulls Total down. That is how
the workbook has always carried it and must not be "corrected".

### `reconcile_salary_rows()`

Forces the `Salary` row to equal actual salary transactions, because the workbook folded
tax refunds and deposited cheques into salary in some months. Then recomputes the rows
that depend on it: `Net Income`, `Margin`, `Total Savings`. Applies to workbook months
too, not only computed ones. Skips a month when the difference is within $0.02.

## Move the constants into `fin.config`

The 401k, IRA and annual-salary figures step at 2025-07 and are currently hard-coded in
Python. Put them in a table so a pay change is a row, not a code edit:

```sql
create table fin.compensation (
  effective_from text primary key,   -- 'YYYY-MM', applies from this month onward
  annual_salary numeric(14,2) not null,
  k401_monthly numeric(14,2) not null,
  ira_monthly numeric(14,2) not null
);
-- seed: ('2025-01', 85000.00, 779.17, 141.67), ('2025-07', 90600.00, 830.50, 151.00)
```

Look up by the greatest `effective_from` that is `<= month`.

## Shape

`fin.monthly_summary()` keeps its current return shape exactly — `{months, rows}` with
each row `{label, style, kind, values}`. The frame is unchanged. Workbook months continue
to come from `fin.monthly_summary_rows`; only months beyond the workbook are computed,
and the salary reconciliation is applied across both.

## Verification — must hold on live data

- `python3 fin_parity.py` reports **PASS workbook_monthly**. That is the whole test: it
  diffs against the Python implementation this is porting, field by field at zero
  tolerance, and it currently fails on exactly these rows.
- August's Travel row reads $130.00, Clothing $30.00, Donations $80.00, Service $55.98,
  Bet $29.74 — i.e. the overrides are reflected.
- Setting a category override through the Review tab changes the Monthly figures on the
  next load, with no local rebuild.
- Workbook months are byte-identical to what is stored today; this must not disturb
  history.
