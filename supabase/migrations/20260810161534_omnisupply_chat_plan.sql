-- Store the latest complete plan snapshot emitted by a chat agent. Codex keeps
-- the todo-list item id stable and repeats the full list on every update, so one
-- row per job avoids exposing a partially replaced plan.

create table if not exists cos.chat_plan (
  job_id text primary key,
  work_id text,
  plan_item_id text,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_plan_work_idx on cos.chat_plan (work_id);

alter table cos.chat_plan enable row level security;
revoke all on table cos.chat_plan from public, anon, authenticated;

create or replace function cos.api_chat_job_progress(
  p_job_id text,
  p_after_seq integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  select job_id, work_id, state, job_type, active_provider,
         failure_kind, failure_detail, created_at, updated_at
    into j
    from cos.job_queue
   where job_id = p_job_id
     and job_type = 'omnisupply_chat';

  if not found then
    return jsonb_build_object(
      'ok', true,
      'job', null,
      'steps', '[]'::jsonb,
      'plan', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'job_id', j.job_id,
      'work_id', j.work_id,
      'state', j.state,
      'provider', j.active_provider,
      'failure_kind', j.failure_kind,
      'failure_detail', j.failure_detail,
      'created_at', j.created_at,
      'updated_at', j.updated_at
    ),
    'steps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'seq', p.seq,
          'at', p.created_at,
          'kind', p.kind,
          'label', p.label,
          'detail', p.detail
        ) order by p.seq
      )
      from cos.job_progress p
      where p.job_id = j.job_id
        and p.seq > p_after_seq
    ), '[]'::jsonb),
    'plan', (
      select jsonb_build_object(
        'item_id', p.plan_item_id,
        'items', p.items,
        'updated_at', p.updated_at
      )
      from cos.chat_plan p
      where p.job_id = j.job_id
    )
  );
end
$$;

revoke all on function cos.api_chat_job_progress(text, integer)
  from public, anon;
grant execute on function cos.api_chat_job_progress(text, integer)
  to authenticated;
