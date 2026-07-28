-- Versioned copy of the OmniSupply read model currently deployed in Supabase.
-- The browser can execute the owner-gated RPC, but cannot read these tables.

create table if not exists cos.omnisupply_snapshots (
  snapshot_id text primary key,
  published_at timestamptz not null default now(),
  producer jsonb not null default '{}'::jsonb,
  freshness jsonb not null default '{}'::jsonb,
  graph_stats jsonb not null default '{}'::jsonb,
  answer_count integer not null default 0,
  illustrative_count integer not null default 0,
  is_current boolean not null default false,
  note text not null default ''
);

create unique index if not exists omnisupply_snapshots_one_current
  on cos.omnisupply_snapshots (is_current)
  where is_current;
create index if not exists omnisupply_snapshots_published_at
  on cos.omnisupply_snapshots (published_at desc);

create table if not exists cos.omnisupply_answers (
  snapshot_id text not null
    references cos.omnisupply_snapshots(snapshot_id) on delete cascade,
  key text not null,
  section text not null,
  title text not null,
  basis text not null,
  as_of text not null,
  sources jsonb not null default '[]'::jsonb,
  note text not null default '',
  params jsonb not null default '{}'::jsonb,
  figures jsonb not null default '[]'::jsonb,
  data_rows jsonb not null default '[]'::jsonb,
  row_provenance jsonb,
  ordinal integer not null default 0,
  constraint omnisupply_answers_pkey primary key (snapshot_id, key),
  constraint omnisupply_answers_basis_known
    check (basis in ('measured', 'derived', 'estimate', 'illustrative')),
  constraint omnisupply_answers_as_of_present
    check (length(btrim(as_of)) > 0),
  constraint omnisupply_answers_figures_are_an_array
    check (jsonb_typeof(figures) = 'array'),
  constraint omnisupply_answers_rows_are_an_array
    check (jsonb_typeof(data_rows) = 'array'),
  constraint omnisupply_answers_figures_carry_provenance
    check (
      not jsonb_path_exists(
        figures,
        '$[*] ? (!exists(@.source) || !exists(@.as_of) || !exists(@.basis) || @.source == "" || @.as_of == "")'
      )
    )
);

create index if not exists omnisupply_answers_snapshot_section
  on cos.omnisupply_answers (snapshot_id, section, ordinal);
create index if not exists omnisupply_answers_basis
  on cos.omnisupply_answers (snapshot_id, basis);

alter table cos.omnisupply_snapshots enable row level security;
alter table cos.omnisupply_answers enable row level security;
revoke all on table cos.omnisupply_snapshots from public, anon, authenticated;
revoke all on table cos.omnisupply_answers from public, anon, authenticated;

create or replace function cos.api_omnisupply_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot cos.omnisupply_snapshots%rowtype;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  select * into v_snapshot
  from cos.omnisupply_snapshots
  where is_current
  limit 1;

  if not found then
    return jsonb_build_object(
      'generated_at', now(),
      'snapshot', null,
      'freshness', '{}'::jsonb,
      'sections', '{}'::jsonb,
      'illustrative', '[]'::jsonb,
      'note', 'No OmniSupply snapshot published yet. Run `sckg publish`.'
    );
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'snapshot', jsonb_build_object(
      'snapshot_id', v_snapshot.snapshot_id,
      'published_at', v_snapshot.published_at,
      'producer', v_snapshot.producer,
      'graph_stats', v_snapshot.graph_stats,
      'answer_count', v_snapshot.answer_count,
      'illustrative_count', v_snapshot.illustrative_count,
      'note', v_snapshot.note
    ),
    'freshness', v_snapshot.freshness,
    'sections', (
      select coalesce(jsonb_object_agg(s.section, s.items), '{}'::jsonb)
      from (
        select a.section,
               jsonb_agg(
                 jsonb_build_object(
                   'key', a.key,
                   'title', a.title,
                   'basis', a.basis,
                   'as_of', a.as_of,
                   'sources', a.sources,
                   'note', a.note,
                   'params', a.params,
                   'figures', a.figures,
                   'rows', a.data_rows,
                   'row_provenance', a.row_provenance
                 ) order by a.ordinal, a.key
               ) as items
        from cos.omnisupply_answers a
        where a.snapshot_id = v_snapshot.snapshot_id
          and a.basis <> 'illustrative'
        group by a.section
      ) s
    ),
    'illustrative', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'key', a.key,
            'title', a.title,
            'basis', a.basis,
            'as_of', a.as_of,
            'sources', a.sources,
            'note', a.note,
            'params', a.params,
            'figures', a.figures,
            'rows', a.data_rows,
            'row_provenance', a.row_provenance
          ) order by a.ordinal, a.key
        ),
        '[]'::jsonb
      )
      from cos.omnisupply_answers a
      where a.snapshot_id = v_snapshot.snapshot_id
        and a.basis = 'illustrative'
    )
  );
end
$$;

revoke all on function cos.api_omnisupply_state() from public, anon;
grant execute on function cos.api_omnisupply_state() to authenticated;
