# Forecast tab — build specification

Add a **Forecast** tab to the financial dashboard, positioned directly after Overview.
It projects this month's spend from what has been spent so far.

## Why the obvious approach is wrong

A naive run-rate — `spend_to_date / days_elapsed * days_in_month` — is wrong for this
data and must not be used as the primary method. Spending here is lumpy: rent lands once
on the 1st, subscriptions monthly, food almost daily. On the 5th of the month a run-rate
sees rent and forecasts five rents. On the 25th it has already seen everything and
forecasts no more.

## Method

Build a **per-category cumulative month profile** from the ~20 months of history in
`fin.transactions`:

- For each category and each historical month, compute cumulative spend by day-of-month
  `d`, divided by that month's final total for the category. That gives, for each day
  `d`, the fraction of a typical month's spend that has landed by then.
- Take the **median** fraction across historical months as the profile `p(cat, d)`.
- Forecast for the current month: `spend_to_date(cat) / p(cat, today)`.
  Clamp `p` to a floor (e.g. 0.05) so an early-month divide does not explode.

This self-corrects for timing: rent's profile jumps to ~1.0 by day 2, so seeing rent on
the 3rd forecasts one rent, not ten.

### High / medium / low

Do **not** use an arbitrary ±%. Use each category's own observed variance: across
historical months compute the ratio `final_total / spend_by_day_d`. Then

- **medium** = median ratio × spend-to-date
- **low** = 25th percentile ratio × spend-to-date
- **high** = 75th percentile ratio × spend-to-date

### Thin history

A category with fewer than 3 historical months has no usable profile. Fall back to a
simple run-rate for it and set `"basis": "run_rate"` on that row (versus `"profile"`).
The UI must show that distinction rather than implying false precision.

### Sanity requirements

- Rent and other fixed categories must not produce absurd bands. Check `rent` explicitly.
- A category with zero spend so far this month forecasts 0, not a divide-by-zero.
- Internal categories (anything in `fin.category_classes`) are NOT spend and must be
  excluded, matching `fin.summary()`'s treatment.
- `mom` is a contra-expense with negative cost and must be left in the spend pool, as
  everywhere else.

## Deliverables

### 1. SQL — new migration file in `supabase/migrations/`

`fin.forecast()` returning `jsonb`, `language sql`, `stable`, `set search_path = ''`,
revoked from `public, anon, authenticated, service_role` like every other helper.

Shape:

```json
{
  "month": "2026-08",
  "day_of_month": 9,
  "days_in_month": 31,
  "total": {"spent": 1234.56, "low": 3100.00, "medium": 3400.00, "high": 3900.00,
            "basis": "profile"},
  "categories": [
    {"category": "food", "label": "Food", "spent": 412.00,
     "low": 900.0, "medium": 1050.0, "high": 1240.0,
     "basis": "profile", "months_of_history": 19}
  ],
  "cumulative": [
    {"day": 1, "actual": 1800.0, "low": null, "medium": null, "high": null},
    {"day": 9, "actual": 1234.56, "low": 1234.56, "medium": 1234.56, "high": 1234.56},
    {"day": 31, "actual": null, "low": 3100.0, "medium": 3400.0, "high": 3900.0}
  ]
}
```

`cumulative` is the chart series for the TOTAL: `actual` runs day 1 to today and is null
after; the three forecast series are null before today and join at today's actual value
so the lines meet rather than jumping. Per-category series are derived client-side from
`categories` plus the same profile shape — or add a `cumulative` array per category if
that is cleaner; either is acceptable, but the chart must be able to show one category.

Add `'forecast', fin.forecast()` to `fin.api_financial_state()`.

### 2. Python — `build_financial_dashboard.py`

- Add `build_forecast(transactions)` producing the identical structure, so
  `fin_parity.py` can diff it. Add `"forecast"` to `build_payload()`'s dict.
- Add `"Forecast"` to the `accounts` list in `build_payload()`, **immediately after
  `"Overview"`**: `["Overview", "Forecast", "Monthly", "Cash Flow", "Analytics", "Review"]`.
- Add `renderForecast()` to the JS inside `render_html()` and route to it from the tab
  dispatch, matching how `renderOverview()` / `renderAnalytics()` are wired.

### 3. Chart

A line chart of cumulative spend for the month: solid line for actual to date, then three
lines (low / medium / high) continuing to month end. Reuse the existing `lineChart()`
helper in the template if it fits; otherwise follow its conventions exactly (same axis
treatment, same tooltip behaviour, same colour tokens).

Colours must come from the existing CSS custom properties — `--accent`, `--muted`,
`--gold`, `--danger` — never hard-coded hex. The page is themed by
`fin_build_frame.py`, which overrides those tokens; a literal colour will not follow.

Plus a **category selector** so the same chart can show one category instead of the
total, and a table of per-category `spent / low / medium / high` with the `basis` shown.

### 4. Wiring — `dev/login/`

- `index.html`: add `<button ... data-dashboard="financials" data-tab="fin-forecast">Forecast</button>`
  immediately after the `fin-overview` button, `aria-controls="panel-fin-dashboard"`.
- `app.js`: add `'fin-forecast':'Forecast'` to `FIN_TABS` and `'fin-forecast'` to
  `APP_TABS.financials`, positioned after `'fin-overview'`.
- `tests/test_dev_dashboard.py`: the expected tab list in
  `test_dashboard_tabs_are_grouped_by_application` is order-sensitive — add
  `"fin-forecast"` in the right position.

## Constraints

- **Do not** run `supabase db push` or apply migrations. Write the `.sql` file only; it
  is applied through a reviewed path.
- **Do not** touch anything under `financials/` other than
  `build_financial_dashboard.py` and this spec.
- **Do not** regenerate `dev/login/financials-frame.html` — it is produced by
  `fin_build_frame.py` after the Python changes land.
- `python3 -m pytest tests/ -q` must pass except the pre-existing
  `test_home_restores_featured_media_before_services_and_links_to_services` failure.
- Match the surrounding code's style: this codebase comments the *why*, not the *what*,
  and explains non-obvious decisions in full sentences. Follow that.

---

# CORRECTION — the model above is wrong. Replace it.

Verified against live data and it fails on the obvious case. Rent is $1,470 every month
without fail; August's has not landed by day 9. `spent / profile(d)` forecasts **$0** for
it, because zero divided by anything is zero. The same division blew the total's high
band out to $12,716 against a ~$3,900 typical month.

Multiplicative is the wrong shape. Use **additive**: forecast what is still to come and
add it to what has been spent. It cannot explode, and it works when spend-to-date is zero.

## Replacement method

For each category, over every complete historical month:

- `final_total` — the category's total spend that month
- `cum_at_d` — its cumulative spend by day-of-month `d` (today's day)
- `remaining_at_d = final_total - cum_at_d`

Then:

```
typical_total   = percentile_cont(0.50) of final_total
remaining(p)    = greatest(percentile_cont(p) of remaining_at_d, 0)

-- A category that lands in almost every month but has not appeared yet this month is
-- late, not absent. remaining_at_d cannot see that, because historically it had already
-- landed by now, so it reports nothing left to come. Rent is the case that matters.
regular         = (months_with_any_spend / months_of_history) >= 0.8
floor_remaining = case when regular then greatest(typical_total - spent_to_date, 0) else 0 end

medium = spent_to_date + greatest(remaining(0.50), floor_remaining)
low    = spent_to_date + greatest(remaining(0.25), floor_remaining * 0.9)
high   = spent_to_date + greatest(remaining(0.75), floor_remaining * 1.1)
```

`low <= medium <= high` must hold; clamp if the percentiles cross.

The month total is the **sum of the per-category forecasts**, not a forecast computed on
the total. Bands summed across categories are conservative — every category will not
simultaneously hit its 75th percentile — but that is the honest reading and far better
than the current 19x.

## Negative categories

`food` currently forecasts about -$620, because Venmo reimbursements net against it. That
is arithmetically consistent with the rest of the dashboard and must NOT be "fixed" by
taking absolutes. But a negative forecast reads as broken, so:

- keep the signed number, and
- set `"net_negative": true` on any category whose `spent` or `medium` is below zero, and
- have the UI label those rows as net of reimbursements rather than showing a bare
  negative next to real spend.

## Verification — these must hold on the live data

- `rent` forecasts medium in the $1,400-$1,550 band, NOT 0
- total `high` is below $8,000 (a typical month is ~$3,900; 19x is a bug, 2x is a band)
- `low <= medium <= high` for every category and for the total
- a category with no history at all still returns numbers rather than null

Keep everything else in the original spec: the tab position, the chart, the category
selector, the `basis` field, the wiring, and the constraints.

---

# ADDENDUM 2 — separate committed spend from variable spend

The additive model works, but it treats every category as one undifferentiated pool. A
Spotify subscription and a night at a bar are not the same kind of future spend: one is
known to the cent and certain to arrive, the other is a distribution. Averaging them
together widens the band around things that are not uncertain and hides the fact that
some of next week's spend is already committed.

Split the forecast into **committed** and **variable**, and show both.

## Detecting committed spend

Do this at the MERCHANT level, not the category level. `build_insights()` already
normalises merchants for its recurring-charge detection — reuse that exact normalisation
so the two features cannot disagree about what "the same merchant" means:

```
lower(description) -> strip [^a-z0-9 ] -> drop \m[0-9a-z]{5,}\M tokens -> first 3 words
```

A merchant+amount pair is **committed** when, over the trailing 6 complete months:

- it appears in at least 3 distinct months, AND
- it appears in at least 60% of those months, AND
- the charge amount is stable: `stddev / median <= 0.15`, or the amounts are identical

Store, per committed item: normalised merchant, category, `expected_amount` (median),
`expected_day` (median day-of-month), and `months_seen`.

Rent qualifies naturally under this rule, so the 80%-of-months category floor from the
previous correction becomes redundant for anything the merchant rule catches. Keep the
category floor only as a fallback for categories with committed spend the merchant rule
missed, and do not let both fire for the same money — double-counting rent would be worse
than the bug this replaces.

## Forecasting with the split

For the current month, for each committed item:

- **already charged this month** — it is in `spent`; add nothing
- **not yet charged** — add `expected_amount` to `committed_remaining`
- if `expected_day < today` and it has not arrived, still count it, and mark
  `"overdue": true`. It is late, not cancelled. That is the rent case generalised.

Variable forecasting is the existing additive percentile model, but computed on history
with committed-merchant charges REMOVED, so a subscription's certainty does not inflate
the variable band.

```
medium = spent + committed_remaining + variable_medium
low    = spent + committed_remaining + variable_low
high   = spent + committed_remaining + variable_high
```

`committed_remaining` sits in all three bands unchanged — that is the point. It is not
uncertain, so it must not widen the band.

## Payload additions

On the top-level object:

```json
"committed": {
  "remaining": 1512.00,
  "charged_so_far": 45.98,
  "items": [
    {"merchant": "Spotify Usa", "category": "spotify", "label": "Spotify",
     "expected_amount": 11.99, "expected_day": 14, "months_seen": 6,
     "status": "due"}
  ]
}
```

`status` is one of `charged` (already seen this month), `due` (expected later this
month), `overdue` (expected day has passed and it has not arrived).

Each category row gains `"committed": n` and `"variable_medium": n` so the table can show
the split per category.

## UI

On the Forecast tab, above the chart:

- two figures side by side — **Committed** (with a count of items) and **Variable**
  (with its low-high range) — so the certain and uncertain parts of the month are legible
  at a glance
- a small table of committed items with merchant, expected amount, expected day, and
  status; `overdue` rows visually marked

In the cumulative chart, the committed portion should be visible as a distinct band or
line rather than blended into the forecast lines, so the shape of "what is already
spoken for" is readable.

## Verification — must hold on live data

- `rent` appears as a committed item at ~$1,470, status `overdue` (August's had not
  arrived by the 9th), and is NOT also counted by the category floor
- Known subscriptions appear as committed items with sane expected days
- `committed_remaining + spent <= medium` and the band width equals the variable band
  width — committed spend must not widen it
- The total medium stays in the $3,500-$5,000 range for August; a large jump means
  something is being double-counted

---

# ADDENDUM 3 — two defects in the committed/variable split

Verified against live data. The split works — rent is caught once, at $1,470, and
committed spend correctly does not widen the band. Two things are wrong.

## Defect 1: merchant labels are unreadable

The committed items currently render as:

```
To Phil S  $1470.00      Adw  $26.36      Ca  $16.86      36  $10.59
```

`Adw`, `Ca`, `36` are not merchants. Reusing `build_insights()`'s normaliser was my
instruction and it was wrong for this: it drops every alphanumeric token of 5+ characters
to strip order ids, which also deletes real merchant names — `SPOTIFY` is seven
characters. That is harmless when the string is only ever a grouping key, which is all
insights uses it for. Here it is shown to the user.

**Separate the grouping key from the display label.**

- **Grouping key** — keep exactly as it is. It works, and changing it would silently
  regroup existing recurring detections.
- **Display label** — a new field, `merchant_label`, resolved in this order:
  1. the transaction's `counterparty` when non-empty (this is Plaid's `merchant_name`,
     which is already clean: "Spotify", "Uber")
  2. otherwise the description, whitespace-collapsed, with trailing digit runs and
     obvious reference numbers removed, truncated to ~28 characters, title-cased
  Pick the most common non-empty value across that merchant's charges, not the latest.

The UI must show `merchant_label`. Keep `merchant` in the payload for debugging.

Rent showing as "To Phil S" is correct and should stay — that is what the transaction
says. Verify it renders as something recognisable, not as "To Phil S" becoming "".

## Defect 2: the variable forecast is roughly 20% too high

Total medium came out at **$5,096.34**. Recent complete months were $3,949, $4,231,
$3,989 and $4,617. Worse, the variable remainder alone is **$2,890**, which is larger
than a typical month's entire variable spend once rent is excluded (~$2,700) — and that
is supposed to be what is LEFT after nine days, not the whole month.

The likely cause is that committed charges are not being removed from the historical
series the variable percentiles are computed from, so committed money is counted twice:
once in `committed_remaining` and again inside the variable distribution.

Removing them must happen **before** `final_total` and `cum_at_d` are computed, for every
historical month, not subtracted from the result afterwards. A charge belongs to a
committed merchant if its grouping key matches a currently-committed merchant, regardless
of which month it falls in.

Add an explicit guard so this cannot regress silently: expose
`"variable_excluded_from_history": <count>` on the top-level `committed` object — the
number of historical charges removed. If that is 0 while committed items exist, the
exclusion is not working.

## Verification — must hold on live data

- committed items display recognisable names; no single-token labels like `Ca` or `36`
- `variable_excluded_from_history` is well above 0
- total medium lands in **$3,600–$5,000** (recent months $3,949–$4,617, with $674 spent
  by day 9)
- the variable remainder alone is **below $2,700**
- rent still appears exactly once, with category `variable_medium` of 0
- band width still equals the variable band width
