# Item-Level Spend Linking — Implementation Plan

Link merchant charges (Amazon, Walmart, Harris Teeter, Target, Uber Eats) to the
**actual items purchased**, so the dashboard can drill from a single opaque charge
(e.g. `AMAZON RETAIL -35.74`) down to its line items and real sub-categories.

---

## 1. The core constraint

Every existing feed — `CreditCard.csv`, `activity.csv`, `Checking.csv`, Venmo — is
**merchant-level**. A transaction is a settled total; the bank never sees the cart.
Item detail exists **only** in the merchant's own order/receipt history.

So this is not a parsing problem on current data. It needs two new pieces:

1. **A second data source per merchant** — the itemized order/receipt export.
2. **A reconciliation step** — fuzzy-match each itemized order back to the bank charge
   already in `transactions`.

### Current spend at target merchants (baseline)

| Merchant   | Txns | Spend     |
|------------|------|-----------|
| Amazon     | 38   | $1,084.35 |
| Walmart    | 8    | $106.72   |
| Uber Eats  | 2    | $72.96    |
| Harris Teeter / Target | TBD | TBD |

Amazon dominates — it's the primary payoff and the proof case for the architecture.

---

## 2. Intake model (manual, file-based)

User manually exports/downloads receipts and drops them into a new folder, mirroring
the existing `Source data/` flow.

```
Source data/
  orders/
    amazon/        Retail.OrderHistory.*.csv   (Amazon "Request Your Information")
    walmart/       *.csv | *.pdf | *.html        (purchase history export / receipt)
    harris-teeter/ *.pdf | *.html | *.txt         (emailed/printed receipts)
    target/        *.csv | *.pdf                  (order history / receipt)
    uber-eats/     *.pdf | *.html | *.txt         (emailed receipts)
```

Design the parser layer so **each merchant has its own adapter** and new files are
picked up automatically on the next dashboard build (idempotent — re-running must not
duplicate orders; dedupe on `order_id` or a content hash).

### Per-merchant source format notes

- **Amazon** — `Request Your Information → Your Orders`. Emailed zip (hours–1 day).
  `Retail.OrderHistory.*.csv` is fully structured: order id, order date, item name,
  ASIN, category, qty, unit price, order total. **Cleanest source.**
- **Walmart** — purchase history export (CSV) or per-order receipt (PDF/HTML).
- **Harris Teeter** — typically only emailed/printed receipts → PDF/HTML/text; needs
  text extraction + line-item parsing. Itemization quality varies.
- **Target** — order history export (online orders) or receipt PDF.
- **Uber Eats** — emailed receipt (PDF/HTML) per order; itemized.

Where a format is unstructured (PDF/HTML receipts), the adapter extracts text and
parses line items; the existing `chs.doc-parser` skill can do the heavy extraction at
zero model cost if needed.

---

## 3. Data model (new tables)

Added in `ensure_database()` (`build_financial_dashboard.py:659`), alongside
`transactions`.

```sql
CREATE TABLE orders (
    order_id     TEXT PRIMARY KEY,   -- merchant order id, or hash if absent
    merchant     TEXT NOT NULL,      -- amazon | walmart | harris_teeter | target | uber_eats
    order_date   TEXT NOT NULL,
    order_total  REAL NOT NULL,
    item_count   INTEGER NOT NULL DEFAULT 0,
    source_file  TEXT NOT NULL,      -- provenance
    raw_hash     TEXT NOT NULL       -- idempotent re-ingest guard
);

CREATE TABLE order_items (
    id           TEXT PRIMARY KEY,   -- hash(order_id + line)
    order_id     TEXT NOT NULL REFERENCES orders(order_id),
    item_name    TEXT NOT NULL,
    item_category TEXT NOT NULL DEFAULT '',  -- mapped to dashboard categories
    qty          REAL NOT NULL DEFAULT 1,
    unit_price   REAL NOT NULL DEFAULT 0,
    line_total   REAL NOT NULL DEFAULT 0
);

CREATE TABLE tx_order_link (
    tx_id        TEXT NOT NULL REFERENCES transactions(id),
    order_id     TEXT NOT NULL REFERENCES orders(order_id),
    match_method TEXT NOT NULL,      -- exact | amount_date | manual
    confidence   REAL NOT NULL,      -- 0..1
    PRIMARY KEY (tx_id, order_id)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_orders_merchant_date ON orders(merchant, order_date);
CREATE INDEX idx_tx_order_link_tx ON tx_order_link(tx_id);
```

Item categories reuse the existing dashboard category vocabulary (see
`CATEGORY_RULES` / `canonical_category` at `build_financial_dashboard.py:140`) so
item-level rollups are consistent with transaction-level ones.

---

## 4. The matcher (the hard part)

`match_orders_to_transactions()` links `orders` → `transactions`, writing
`tx_order_link`. Amazon is the difficult case: one card charge ≠ one order. Common
patterns:

- One order → multiple charges (split shipments).
- Multiple orders → one charge (batched settlement).
- Charge amount = a shipment subtotal, not the order total.

Matching strategy, in confidence order:

1. **Exact** — order_total == |amount| and same merchant within ±1 day → confidence 1.0.
2. **Amount + date window** — |amount| matches an order (or a shipment subtotal)
   within ±3 days → confidence ~0.8.
3. **Combination** — sum of N small orders == one charge, or one order split across
   N charges → confidence ~0.6.
4. **Unmatched** — flag like the existing `needs_review` pattern; surface in the
   dashboard for one-click manual linking (writes `match_method='manual'`,
   confidence 1.0).

Matcher must be **re-runnable**: clear/recompute non-manual links each build, preserve
manual links.

---

## 5. Pipeline integration

Existing flow:
`parse_recent_csvs()` / `parse_workbook_transactions()` → `write_database()` → `render_html()`

New lane:

1. **`parse_orders()`** module — dispatches to per-merchant adapters, returns
   `Order` + `OrderItem` records. (New, mirrors `parse_recent_csvs` at line 360.)
2. **`write_orders()`** — upsert into `orders` / `order_items` (idempotent on `raw_hash`).
3. **`match_orders_to_transactions()`** — runs after both transactions and orders are
   in the DB.
4. **`render_html()`** (line 982) — drill-down UI.
5. **`main()`** (line 2288) — wire steps 1–3 in.

---

## 6. Dashboard UX (drill-down)

- Linked transactions (Amazon/Walmart/etc.) get an expand affordance → shows itemized
  lines with item, qty, price, sub-category.
- New **"What did I actually buy"** view: item-category rollup across linked orders
  (e.g. Amazon $1,084 → Household $420 / Electronics $260 / Groceries $180 / …).
- **Coverage indicator**: % of merchant spend that is item-linked vs. still opaque, so
  it's clear how complete the picture is.
- **Unmatched queue**: orders/charges the matcher couldn't link, with manual-link action.

---

## 7. Phased delivery

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **0** | Schema (`orders`, `order_items`, `tx_order_link`) + `Source data/orders/` folders | Tables exist, build still green |
| **1** | **Amazon** adapter + matcher + drill-down UI | Amazon charges itemized, coverage % shown |
| **2** | **Uber Eats** + **Target** adapters (receipt text → items) | Delivery/Target linked |
| **3** | **Walmart** + **Harris Teeter** adapters | Grocery itemized |
| **4** | Item-category rollup view + unmatched manual-link queue | Full "what did I buy" view |

Each phase reuses the same tables and matcher — later merchants are just new adapters.

---

## 8. Open questions / risks

- **Receipt formats** (Harris Teeter, Uber Eats, Walmart) are unstructured; parser
  robustness depends on actual sample files. Validate adapters against real drops.
- **Amazon partial-shipment matching** will leave a residue of unmatched charges →
  manual-link queue is required, not optional.
- **Item → category mapping** needs a rules pass (Amazon's own category field helps;
  grocery items may need keyword rules like the existing `CATEGORY_RULES`).
- **Refunds/returns** appear as negative items / credits — must net correctly against
  the charge.

---

## 9. Immediate next step

User drops first real sample files into `Source data/orders/<merchant>/`.
Start with **Amazon** (Phase 1) since it's the biggest spend and the cleanest format —
it proves the schema, matcher, and drill-down end to end before the messier receipt
adapters in Phases 2–3.
