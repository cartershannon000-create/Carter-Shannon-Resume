-- Live run progress (GitHub Actions-style): the runner streams each worker event
-- (phase, tool call, agent text, result) into cos.job_progress as it happens, and
-- the /dev Work Queue tails it through the owner-gated RPC below. Append-only;
-- rows are never updated, so a seq cursor gives cheap incremental polling.

create table if not exists cos.job_progress (
  progress_id bigint generated always as identity primary key,
  job_id text not null references cos.job_queue(job_id) on delete cascade,
  work_id text not null,
  seq integer not null,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('phase','tool','text','result','error')),
  label text not null,
  detail text,
  unique (job_id, seq)
);
create index if not exists job_progress_work_idx on cos.job_progress (work_id, seq);

alter table cos.job_progress enable row level security;
revoke all on table cos.job_progress from public, anon, authenticated;

-- Tail a work item's newest job: current job state plus progress rows after a cursor.
create or replace function cos.api_job_progress(p_work_id text, p_after_seq integer default 0)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare j record;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  select job_id, state, job_type, params_json->>'mode' as mode, created_at, updated_at
    into j
    from cos.job_queue where work_id = p_work_id
   order by created_at desc limit 1;
  if not found then
    return json_build_object('ok', true, 'job', null, 'progress', '[]'::json);
  end if;
  return json_build_object(
    'ok', true,
    'work_state', (select state from cos.work_items where work_id = p_work_id),
    'job', json_build_object(
      'job_id', j.job_id, 'state', j.state, 'job_type', j.job_type, 'mode', j.mode,
      'created_at', j.created_at, 'updated_at', j.updated_at),
    'progress', coalesce((
      select json_agg(json_build_object(
               'seq', p.seq, 'at', p.created_at, 'kind', p.kind,
               'label', p.label, 'detail', p.detail) order by p.seq)
        from cos.job_progress p
       where p.job_id = j.job_id and p.seq > p_after_seq), '[]'::json));
end $$;

revoke all on function cos.api_job_progress(text,integer) from public, anon;
grant execute on function cos.api_job_progress(text,integer) to authenticated;
