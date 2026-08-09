-- Personal financial dashboard, migrated off local SQLite.
--
-- `fin` is deliberately separate from `cos`. The control plane's agent runner
-- authenticates as service_role, which carries BYPASSRLS -- so RLS alone would not
-- keep the runner out of this data. It is kept out by GRANTS instead: service_role
-- is never granted USAGE on this schema and never granted anything on its tables,
-- and the revokes below are explicit so a future default-privilege change cannot
-- silently open a door. Owner-gated SECURITY DEFINER RPCs are the only read path.
--
-- Ingest (the Plaid Edge Function) does NOT use service_role either, for the same
-- reason. It authenticates as fin_ingest, a role whose entire surface is execute on
-- one append-only function. See the ingest section at the bottom.

create schema if not exists fin;

-- ---------------------------------------------------------------------------
-- Reference data
--
-- These were module constants in build_financial_dashboard.py. They live in tables
-- because the aggregation RPC joins against them; keeping them as SQL literals
-- would mean editing a 400-line function to reclassify one category.
-- ---------------------------------------------------------------------------

-- Display names for categories. Anything absent falls back to title-cased slug,
-- matching category_label()'s behaviour.
create table if not exists fin.category_labels (
  category text primary key,
  label text not null
);

insert into fin.category_labels (category, label) values
  ('alc','Alcohol'), ('bar','Bars'), ('bet','Betting'), ('cash','Cash'),
  ('check','Checks'), ('clothing','Clothing'), ('donations','Donations'),
  ('fee','Fees'), ('food','Food'), ('gift','Gifts'), ('event','Events'),
  ('golf','Golf'), ('grocery','Groceries'), ('haircut','Haircuts'),
  ('living','Living'), ('metro','Metro'), ('mom','Mom'),
  ('payment','Card payments'), ('rent','Rent'), ('salary','Salary'),
  ('service','Services'), ('spotify','Spotify'), ('stock','Investments'),
  ('additional savings','Additional Savings'), ('tax','Taxes'),
  ('travel','Travel'), ('uber','Uber'), ('utilities','Utilities'),
  ('venmo','Venmo transfers')
on conflict (category) do update set label = excluded.label;

-- Which categories are "internal" (not real spend). A category with no row here is
-- ordinary spend.
--
-- `mom` is deliberately absent. It is a contra-expense: money from Mom reimbursing
-- spend already booked elsewhere. Its costs are negative, so leaving it in the
-- ordinary spend pool lets it offset those categories and reduce the month's total,
-- which is how the budget workbook has always carried it. This nets negative on
-- purpose -- do not "fix" it by classifying it as income or a transfer.
create table if not exists fin.category_classes (
  category text primary key,
  class text not null check (class in ('income','transfer','savings'))
);

insert into fin.category_classes (category, class) values
  ('salary','income'),
  ('payment','transfer'), ('venmo','transfer'), ('capone','transfer'),
  ('amex','transfer'), ('wells','transfer'),
  ('stock','savings'), ('additional savings','savings')
on conflict (category) do update set class = excluded.class;

-- Cash vs card. The cash-flow model needs to know which account IS the checking
-- balance and which accounts defer spend into a later card payment.
create table if not exists fin.account_roles (
  account text primary key,
  role text not null check (role in ('cash','card'))
);

insert into fin.account_roles (account, role) values
  ('Checking','cash'),
  ('Amex','card'), ('Capital One','card'), ('Wells Fargo','card')
on conflict (account) do update set role = excluded.role;

-- Single-row settings. The balance anchor is the one hand-verified number the whole
-- cash-flow model hangs off: no balance is recorded in the transaction history, so
-- the stock is derived by walking flows outward from this point in both directions.
--
-- Validated end to end: walking forward lands on 5301.28 at 2026-07-31, matching the
-- real account, which is what proves the 05/29-06/09 gap in the Checking exports is
-- genuinely empty rather than missing data. Note the P&L-to-cash bridge canNOT prove
-- that -- both sides are computed from the same rows, so it is an identity that
-- closes even when data is absent. It checks classification, not coverage.
create table if not exists fin.config (
  id boolean primary key default true check (id),
  anchor_account text not null,
  anchor_as_of date not null,
  anchor_balance numeric(14,2) not null,
  plaid_takeover_date date
);

insert into fin.config (id, anchor_account, anchor_as_of, anchor_balance, plaid_takeover_date)
values (true, 'Checking', date '2026-03-31', 5842.31, date '2026-08-01')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table if not exists fin.transactions (
  id text primary key,
  account text not null,
  txn_date date not null,
  -- Built from extract() rather than to_char(), which is only STABLE (it depends on
  -- DateStyle/lc_time) and so cannot back a generated column.
  month text generated always as (
    lpad(extract(year from txn_date)::text, 4, '0') || '-' ||
    lpad(extract(month from txn_date)::text, 2, '0')
  ) stored,
  description text not null,
  -- Category as ingested. The effective category (after a Review override) is
  -- resolved in the read RPC, so an override never destroys what the rules inferred.
  category text not null default 'uncategorized',
  amount numeric(14,2) not null,
  cost numeric(14,2) not null,
  type text not null default '',
  status text not null default '',
  source text not null,
  native_category text not null default '',
  -- counterparty distinguishes four roommates sending the same amount with the same
  -- note on the same day; occurrence distinguishes genuine repeat charges (two Metro
  -- taps) from one charge appearing in two overlapping exports. Both were previously
  -- collapsed into a single row by the dedupe.
  counterparty text not null default '',
  occurrence integer not null default 1,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_month_idx on fin.transactions (month);
create index if not exists transactions_account_month_idx on fin.transactions (account, month);
create index if not exists transactions_category_month_idx on fin.transactions (category, month);
create index if not exists transactions_needs_review_idx on fin.transactions (needs_review) where needs_review;
create index if not exists transactions_date_idx on fin.transactions (txn_date desc);

-- Review-tab write-back. Kept separate from transactions so re-running ingest cannot
-- clobber a manual decision, and so the original inferred category stays visible.
create table if not exists fin.category_overrides (
  tx_id text primary key references fin.transactions(id) on delete cascade,
  category text not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- Budget workbook rows (the Monthly tab's planned figures), keyed by position so the
-- workbook's own row ordering and styling survive the round trip.
create table if not exists fin.monthly_summary_rows (
  row_order integer not null,
  month text not null,
  label text not null default '',
  style text not null default '',
  kind text not null default 'money',
  value numeric(14,2),
  primary key (row_order, month)
);

-- Plaid sync state for the Edge Function, replacing plaid_store.sqlite.
-- Access tokens are NOT here -- they live in Supabase secrets. This table holds only
-- the per-item cursor and sync bookkeeping, so a leak of it reveals no bank access.
create table if not exists fin.plaid_items (
  item_id text primary key,
  institution text not null default '',
  cursor text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lockdown
--
-- Every table: RLS on with no policies, and all privileges revoked from every role
-- the outside world can reach -- including service_role, whose BYPASSRLS makes the
-- grant the only thing standing between the agent runner and this data.
-- ---------------------------------------------------------------------------

alter table fin.category_labels enable row level security;
alter table fin.category_classes enable row level security;
alter table fin.account_roles enable row level security;
alter table fin.config enable row level security;
alter table fin.transactions enable row level security;
alter table fin.category_overrides enable row level security;
alter table fin.monthly_summary_rows enable row level security;
alter table fin.plaid_items enable row level security;

revoke all on all tables in schema fin from public, anon, authenticated, service_role;
revoke all on all sequences in schema fin from public, anon, authenticated, service_role;
revoke all on all functions in schema fin from public, anon, authenticated, service_role;
revoke all on schema fin from public, anon, service_role;

-- PostgREST needs USAGE on the schema to route an RPC call to it. USAGE alone confers
-- nothing on the tables above -- those revokes stand, and RLS is on regardless. This
-- is granted to `authenticated` only; service_role is excluded on the line above and
-- stays excluded.
grant usage on schema fin to authenticated;

-- Anything created in `fin` later starts closed rather than inheriting a default grant.
alter default privileges in schema fin
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema fin
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema fin
  revoke all on functions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ingest identity
--
-- The Plaid Edge Function must WRITE here, but Edge Functions default to
-- service_role -- the one identity that must never reach this schema. So ingest gets
-- its own role whose entire authority is execute on one append-only function: it can
-- add transactions and advance a cursor, and it cannot read a single row back.
--
-- NOLOGIN on purpose. The password is set out of band (never in a committed
-- migration) with:
--     alter role fin_ingest with login password '<generated>';
-- and stored as a Supabase function secret.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fin_ingest') then
    create role fin_ingest nologin;
  end if;
end
$$;

revoke all on all tables in schema fin from fin_ingest;
revoke all on all functions in schema fin from fin_ingest;
grant usage on schema fin to fin_ingest;

comment on schema fin is
  'Personal financial data. Owner-gated read RPCs only. service_role is intentionally '
  'granted nothing here -- its BYPASSRLS means grants, not RLS, are the control. '
  'Ingest authenticates as fin_ingest (execute on fin.ingest_transactions only).';
