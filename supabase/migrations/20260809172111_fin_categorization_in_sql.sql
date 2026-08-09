-- Categorisation moved out of Python and into the database, so transactions can be
-- classified by a scheduled job with no laptop involved.
--
-- The rules are DATA, not code. build_financial_dashboard.py remains the place they are
-- authored (the monthly review skill appends to CATEGORY_RULES there), and
-- fin_sync_rules.py pushes them here. That keeps one source of truth: a second hand
-- written copy of 31 ordered rules would drift the first time one was edited.

create table if not exists fin.category_rules (
  seq integer primary key,                 -- first match wins, so order is meaningful
  category text not null,
  match_type text not null check (match_type in ('any','all')),
  terms text[] not null check (cardinality(terms) > 0)
);

create table if not exists fin.category_aliases (
  alias text primary key,
  category text not null
);

create table if not exists fin.override_rules (
  seq integer primary key,
  category text not null,
  terms text[] not null check (cardinality(terms) > 0)
);

-- Plaid's own taxonomy, consulted only when the description rules find nothing.
create table if not exists fin.plaid_category_map (
  level text not null check (level in ('detailed','primary')),
  plaid_category text not null,
  category text not null,
  primary key (level, plaid_category)
);

-- Budget workbook Description -> Category overrides, keyed on the uppercased,
-- whitespace-collapsed description exactly as norm_key() produces it.
create table if not exists fin.description_map (
  description_key text primary key,
  category text not null
);

-- clean_text + norm_key + lower(), collapsed into the one form every lookup uses.
create or replace function fin.norm_text(v text)
returns text language sql immutable set search_path = '' as $fn$
  select lower(btrim(regexp_replace(coalesce(v, ''), '\s+', ' ', 'g')))
$fn$;

create or replace function fin.canonical_category(v text)
returns text language sql stable set search_path = '' as $fn$
  select coalesce(
    (select a.category from fin.category_aliases a where a.alias = fin.norm_text(v)),
    nullif(fin.norm_text(v), ''),
    'uncategorized')
$fn$;

-- Mirrors infer_category(): the workbook map wins, then the ordered rules, then the
-- source's own category, then give up and send it to Review.
create or replace function fin.infer_category(p_description text, p_native text default '')
returns text language sql stable set search_path = '' as $fn$
  select coalesce(
    (select m.category from fin.description_map m where m.description_key = upper(fin.norm_text(p_description))),
    (select r.category from fin.category_rules r
      where (r.match_type = 'any'
             and exists (select 1 from unnest(r.terms) t where position(t in fin.norm_text(p_description)) > 0))
         or (r.match_type = 'all'
             and not exists (select 1 from unnest(r.terms) t where position(t in fin.norm_text(p_description)) = 0))
      order by r.seq
      limit 1),
    nullif(fin.canonical_category(p_native), 'uncategorized'),
    'uncategorized')
$fn$;

-- Description patterns that beat whatever category the source supplied: tax refunds and
-- payments the workbook filed under salary, and deposited cheques likewise.
create or replace function fin.override_category(p_description text, p_category text)
returns text language sql stable set search_path = '' as $fn$
  select coalesce(
    (select o.category from fin.override_rules o
      where exists (select 1 from unnest(o.terms) t where position(t in fin.norm_text(p_description)) > 0)
      order by o.seq limit 1),
    case when position('mobile deposit' in fin.norm_text(p_description)) > 0 and p_category = 'salary'
         then 'cash' end,
    p_category)
$fn$;

create or replace function fin.plaid_category(p_detailed text, p_primary text)
returns text language sql stable set search_path = '' as $fn$
  select coalesce(
    (select m.category from fin.plaid_category_map m
      where m.level = 'detailed' and m.plaid_category = upper(btrim(coalesce(p_detailed, '')))),
    (select m.category from fin.plaid_category_map m
      where m.level = 'primary' and m.plaid_category = upper(btrim(coalesce(p_primary, '')))),
    'uncategorized')
$fn$;

-- The whole classification path for one Plaid row, in the order add_tx() applies it.
--
-- Description rules run first and alone: they are tuned to the merchants that actually
-- appear on these statements and beat any generic taxonomy. Plaid's own enum is only
-- consulted when they find nothing, which is why the native category is withheld from
-- infer_category here rather than passed through.
create or replace function fin.categorize_plaid(
  p_description text, p_native text, p_detailed text, p_primary text,
  p_account text, p_counterparty text)
returns text language sql stable set search_path = '' as $fn$
  with base as (
    select case
             when fin.infer_category(p_description, '') = 'uncategorized'
             then fin.plaid_category(p_detailed, p_primary)
             else fin.infer_category(p_description, '')
           end as cat
  ),
  overridden as (select fin.override_category(p_description, cat) as cat from base)
  select case
    -- Amex "mom" rows that mention travel are her paying for a trip, not a transfer.
    when p_account = 'Amex' and o.cat = 'mom'
         and (position('hotel' in fin.norm_text(p_description)) > 0
              or position('amextravel' in fin.norm_text(p_description)) > 0
              or position('travel' in fin.norm_text(p_description)) > 0)
      then 'travel'
    -- Person-to-person Venmo is food by default, except Nick, who cuts hair.
    when o.cat = 'uncategorized' and p_account = 'Venmo'
      then case when position('nick' in fin.norm_text(p_counterparty)) > 0 then 'haircut' else 'food' end
    else o.cat
  end
  from overridden o
$fn$;

-- The primary key add_tx() builds. Counterparty is appended only when present, and
-- occurrence only from the second repeat, so existing ids are unchanged.
create or replace function fin.make_tx_id(
  p_account text, p_date date, p_description text, p_amount numeric,
  p_source text, p_counterparty text default '', p_occurrence integer default 1)
returns text language sql immutable set search_path = '' as $fn$
  select p_account || '|' || to_char(p_date, 'YYYY-MM-DD') || '|'
      || btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g')) || '|'
      || to_char(round(p_amount, 2), 'FM9999999990.00') || '|' || p_source
      || case when coalesce(btrim(regexp_replace(coalesce(p_counterparty,''), '\s+',' ','g')), '') <> ''
              then '|' || btrim(regexp_replace(p_counterparty, '\s+', ' ', 'g')) else '' end
      || case when p_occurrence > 1 then '|#' || p_occurrence else '' end
$fn$;

alter table fin.category_rules enable row level security;
alter table fin.category_aliases enable row level security;
alter table fin.override_rules enable row level security;
alter table fin.plaid_category_map enable row level security;
alter table fin.description_map enable row level security;

revoke all on all tables in schema fin from public, anon, authenticated, service_role;
revoke all on all functions in schema fin from public, anon, authenticated, service_role;
grant execute on function fin.api_financial_state() to authenticated;
grant execute on function fin.api_set_category(text, text, text) to authenticated;;
