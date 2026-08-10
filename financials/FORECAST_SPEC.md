# Forecast — how it works, and what was tried and rejected

The Forecast tab projects the current month's spend. This describes what is built as of
2026-08-10. It replaces an earlier version of this file that grew by addendum; that
version opened with a model which is wrong and corrected it 130 lines later, so anyone
reading top-down implemented the broken one first.

Implemented in `fin.forecast()`, mirrored in `build_financial_dashboard.py`'s
`build_forecast()`. The two are diffed field by field at zero tolerance by `fin_parity.py`.

## The shape of the problem

Spending here is lumpy and not uniform across a week. Rent lands once near month end,
subscriptions on fixed dates, bar spend almost entirely at weekends. Any model that
smooths across the month gets all three wrong at once.

## The model

### 1. Committed spend — known, and therefore not uncertain

Detected per MERCHANT, not per category. A merchant+amount pair is committed when, over
the trailing 6 complete months, it appears in at least 3 distinct months, in at least 60%
of them, with a stable amount (`stddev / median <= 0.15`).

Grouping uses the same normalisation as `build_insights()`'s recurring detection, so the
two features cannot disagree about what "the same merchant" is:

    lower(description) -> strip [^a-z0-9 ] -> drop \m[0-9a-z]{5,}\M -> first 3 words

**That string is a grouping key only.** It drops any token of 5+ characters to strip order
ids, which also deletes real merchant names — SPOTIFY is seven characters. Display uses a
separate `merchant_label`, resolved from the transaction's `counterparty` (Plaid's
`merchant_name`, already clean) and falling back to a cleaned description. Showing the
grouping key produced items reading `Adw`, `Ca`, `36`.

Per item: `charged` if already seen this month, `due` if expected later, `overdue` if its
expected day has passed and it has not arrived. Overdue means late, not cancelled — it
still counts.

`committed_remaining` enters the low, medium and high bands **unchanged**. That is the
point: it is not uncertain, so it must not widen them.

### 2. Variable spend — by day type

Committed charges are removed from history **before** any total is computed, otherwise
that money is counted twice: once in `committed_remaining` and again inside the variable
distribution. `committed.variable_excluded_from_history` exposes the count as a guard — if
it reads 0 while committed items exist, the exclusion has silently stopped working.

Rates are per calendar day, bucketed weekend (Sat/Sun) versus weekday (Mon-Fri):

    variable_remaining(p) = weekday_rate(p) * weekdays_remaining
                          + weekend_rate(p) * weekend_days_remaining

Day counts come from real calendar dates after today, not `days_remaining * 5/7`.

**Rates must be computed over every calendar day, including zero-spend days.** A Tuesday
with no bar spend is evidence about Tuesdays. Averaging only over days that had
transactions inflates every rate badly, and plausibly.

Summing percentiles across day types is conservative — not every remaining day lands at
the 75th percentile — and that is accepted rather than convolved properly.

Live rates show the split is doing real work rather than fitting noise: bar $1.38 weekday
against $22.77 weekend, food $13.08 against $39.67, groceries inverting at $11.40 against
$7.22.

### 3. Seasonality — implemented, currently inert

A calendar month counts as an observation only once it has a full trailing 12-month window
behind it. History starts 2025-01, so August 2025 has eight. **Every factor is therefore
exactly 1.0 and seasonality is doing nothing until 2027.** That is correct behaviour, not
a gap — but do not describe summer bar spend as modelled today.

When it engages: shrunk by `n/(n+1)`, clamped to `[0.5, 2.0]`, and only for categories
with 12+ months of history. One prior August is close to noise; undamped would be worse
than ignoring seasonality entirely. Applied to the day-type rates, not the final total.

### 4. Accuracy loop — recording now, correcting later

`fin.forecast_snapshots` records what was predicted, keyed on
`(month, day_of_month, category, model_version)`. Day of month is in the key because a
forecast made on the 5th and one on the 25th are different predictions; `model_version` is
there so a model change is not scored against predictions from a different model.

`fin.forecast_accuracy()` scores completed months only, reporting **bias** (median
percentage error) and **calibration** (in-band rate, target 50% for a 25th-75th band)
separately — they are different failures, and correcting one with the other makes both
worse.

Corrections are shrunk by `n/(n+3)`, clamped, applied only to the variable medium, and
**disabled entirely below 2 completed months**. Today that means every factor is exactly
1.0 and the forecast is unchanged. The failure mode for a learning loop on thin data is
confidently overfitting one unusual month; sitting inert for three months is the better
error.

Capture is `fin.capture_forecast_snapshot()`, volatile, called from
`fin.api_sync_plaid_on_view()` after a successful sync and debounced to once a day.
`fin.forecast()` is STABLE and cannot write.

## Presentation

Rent is excluded from the **aggregate chart only**. It lands as one step of ~$1,470 and
flattens the variable spend the chart exists to show. It remains in the headline totals
and both tables, and selecting it in the category picker still draws it. The chart carries
a caption naming the excluded amount, read from the payload, because a chart ending $1,470
below the headline is otherwise a discrepancy that reads as a bug.

`food` forecasts negative, because Venmo reimbursements offset it. That is consistent with
every other tab and is **not** corrected by taking absolutes; it carries `net_negative` and
the UI labels those rows as net of reimbursements.

## Rejected approaches, and why

**Naive run-rate** (`spend_to_date / days_elapsed * days_in_month`). On the 5th it has seen
rent and forecasts five rents; on the 25th it has seen everything and forecasts no more.

**Multiplicative profile** (`spend_to_date / fraction_of_month_typically_landed`). Failed
the most obvious case in the dataset: rent is $1,470 every month, August's had not arrived
by the 9th, so spend-to-date was zero — and zero divided by anything is zero. It forecast
no rent at all. The same division blew the total's high band to $12,716 against a ~$3,900
typical month. Additive was the fix: forecast what is still to come and add it to what has
been spent. It cannot explode and it works when nothing has been spent yet.

**Category-level "regular" floor as the primary fixed-cost mechanism.** Superseded by
merchant-level detection, which catches subscriptions the category rule missed. It
survives only as a fallback, and must never fire for money the merchant rule already
claimed — double-counting rent would be worse than the bug it replaced.

## Verification

`python3 fin_parity.py` must report PASS on all four blocks. Beyond that, the checks that
have actually caught defects:

- rent forecasts ~$1,470, appears exactly once, and its category `variable_medium` is 0
- total medium sits near the recent monthly range ($3,949-$4,617); a large excursion means
  something is double-counted
- `bar` and `food` weekend rates exceed their weekday rates
- `weekdays_remaining + weekend_days_remaining` equals the days actually left after today
- `committed.variable_excluded_from_history` is above 0
- committed items display recognisable names
- `low <= medium <= high` for every category and the total
- with under 2 completed months, every `bias_factor` and `band_scale` is exactly 1.0

**Verify against the live database, not a local copy.** Codex's sandbox has no network;
across five runs its "validated on live data" claims covered only the Python half, and one
round shipped SQL with an ambiguous `month_start` that failed on first execution. Three of
those runs also completed their edits on disk but never exited.
