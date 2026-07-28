-- Durable state for OmniSupply chat, saved reports, and the USA Jet fleet map.
-- Direct browser table access stays closed; the following migration adds the
-- narrow owner-gated RPC surface.

create table if not exists cos.chat_conversations (
  conversation_id text primary key,
  title text not null default 'New conversation',
  scenario jsonb not null default '{}'::jsonb,
  message_count integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_recent
  on cos.chat_conversations (updated_at desc)
  where not archived;

create table if not exists cos.chat_messages (
  message_id text primary key,
  conversation_id text not null
    references cos.chat_conversations(conversation_id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  figures jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  basis text not null default 'measured',
  job_id text,
  status text not null default 'complete',
  error text,
  created_at timestamptz not null default now(),
  constraint chat_messages_seq_unique unique (conversation_id, seq),
  constraint chat_messages_basis_known
    check (basis in ('measured', 'derived', 'estimate', 'illustrative', 'unvetted')),
  constraint chat_messages_status_check
    check (status in ('pending', 'streaming', 'complete', 'failed')),
  constraint chat_messages_figures_are_an_array
    check (jsonb_typeof(figures) = 'array'),
  constraint chat_messages_figures_carry_provenance
    check (
      not jsonb_path_exists(
        figures,
        '$[*] ? (!exists(@.source) || !exists(@.as_of) || !exists(@.basis) || @.source == "" || @.as_of == "")'
      )
    )
);

create index if not exists chat_messages_thread
  on cos.chat_messages (conversation_id, seq);

create table if not exists cos.reports (
  report_id text primary key,
  title text not null,
  summary text not null default '',
  conversation_id text
    references cos.chat_conversations(conversation_id) on delete set null,
  snapshot_id text
    references cos.omnisupply_snapshots(snapshot_id) on delete set null,
  sections jsonb not null default '[]'::jsonb,
  basis text not null default 'measured'
    check (basis in ('measured', 'derived', 'estimate', 'illustrative', 'unvetted')),
  as_of text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_sections_are_an_array
    check (jsonb_typeof(sections) = 'array')
);

create index if not exists reports_recent
  on cos.reports (created_at desc);

create table if not exists cos.fleet_aircraft (
  icao24 text primary key,
  tail text,
  model text,
  operator text not null,
  source text not null default 'faa_registry',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists fleet_aircraft_operator
  on cos.fleet_aircraft (operator)
  where active;

create table if not exists cos.fleet_positions (
  position_id bigint generated always as identity primary key,
  icao24 text not null,
  seen_at timestamptz not null,
  callsign text,
  lat double precision,
  lon double precision,
  altitude_m double precision,
  velocity_ms double precision,
  heading_deg double precision,
  on_ground boolean not null default false,
  captured_at timestamptz not null default now(),
  constraint fleet_positions_unique_fix unique (icao24, seen_at)
);

create index if not exists fleet_positions_recent
  on cos.fleet_positions (icao24, seen_at desc);

insert into cos.fleet_aircraft (icao24, tail, model, operator, source)
values
  ('a17c91', 'N195US', 'DC-9 15RC', 'USA Jet Airlines', 'opensky_registry'),
  ('a9bba9', 'N726US', '727-223 (1981)', 'USA Jet Airlines', 'opensky_registry'),
  ('a9bf60', 'N727US', '727-223 (1981)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab0d14', 'N811AA', 'FAN JET FALCON SER D (1968)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab384a', 'N822AA', 'FAN JET FALCON (1969)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab4add', 'N827AA', 'FAN JET FALCON (1974)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab5de4', 'N831US', 'MD 83 (1989)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab619b', 'N832US', 'MD-88 (1991)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab6552', 'N833US', 'MD-88 (1991)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab6909', 'N834US', 'MD-88 (1990)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab6cc0', 'N835US', 'MCDONNELL-DOUGLAS MD-88', 'USA Jet Airlines', 'opensky_registry'),
  ('ab7077', 'N836US', 'MD-88 (1991)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab742e', 'N837US', 'MD-88 (1991)', 'USA Jet Airlines', 'opensky_registry'),
  ('ab891a', 'N842US', 'MD-88 (1992)', 'USA Jet Airlines', 'opensky_registry'),
  ('ac9e6f', 'N912DL', 'MD-88 (1987)', 'USA Jet Airlines', 'opensky_registry'),
  ('aca98e', 'N915DE', 'MD-88 (1993)', 'USA Jet Airlines', 'opensky_registry'),
  ('acb102', 'N917DL', 'MD-88 (1988)', 'USA Jet Airlines', 'opensky_registry'),
  ('ad4ee3', 'N957CJ', 'FALCON 20 (1976)', 'USA Jet Airlines', 'opensky_registry'),
  ('ad566c', 'N959DL', 'MD-88 (1990)', 'USA Jet Airlines', 'opensky_registry'),
  ('ad6395', 'N962AA', 'FAN JET FALCON (1967)', 'USA Jet Airlines', 'opensky_registry')
on conflict (icao24) do update set
  tail = excluded.tail,
  model = excluded.model,
  operator = excluded.operator,
  source = excluded.source,
  active = true,
  updated_at = now();

alter table cos.chat_conversations enable row level security;
alter table cos.chat_messages enable row level security;
alter table cos.reports enable row level security;
alter table cos.fleet_aircraft enable row level security;
alter table cos.fleet_positions enable row level security;

revoke all on table cos.chat_conversations from public, anon, authenticated;
revoke all on table cos.chat_messages from public, anon, authenticated;
revoke all on table cos.reports from public, anon, authenticated;
revoke all on table cos.fleet_aircraft from public, anon, authenticated;
revoke all on table cos.fleet_positions from public, anon, authenticated;
revoke all on sequence cos.fleet_positions_position_id_seq
  from public, anon, authenticated;
