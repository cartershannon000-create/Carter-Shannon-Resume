-- Agent failure recovery protocol
--
-- Shipping work approved from the dashboard follows one bounded provider chain:
--   Claude -> (quota-window exhaustion only) Codex -> pause + fresh approval.
-- Build/test/runtime/configuration failures never fall through to another provider:
-- they stop, notify Carter through the runner's durable outbox, and create a new
-- recovery approval bound to a cloned, versioned plan.

alter table cos.approval_requests
  drop constraint if exists approval_requests_gate_type_check;
alter table cos.approval_requests
  add constraint approval_requests_gate_type_check
  check (gate_type in ('plan','recovery','action','release'));

alter table cos.job_queue
  add column if not exists provider_order jsonb not null default '["claude","codex"]'::jsonb,
  add column if not exists active_provider text,
  add column if not exists fallback_count integer not null default 0,
  add column if not exists failure_kind text,
  add column if not exists failure_detail text,
  add column if not exists recovery_approval_id text;

alter table cos.job_queue
  drop constraint if exists job_queue_active_provider_check;
alter table cos.job_queue
  add constraint job_queue_active_provider_check
  check (active_provider is null or active_provider in ('claude','codex'));
alter table cos.job_queue
  drop constraint if exists job_queue_fallback_count_check;
alter table cos.job_queue
  add constraint job_queue_fallback_count_check check (fallback_count >= 0);
alter table cos.job_queue
  drop constraint if exists job_queue_failure_kind_check;
alter table cos.job_queue
  add constraint job_queue_failure_kind_check
  check (failure_kind is null or failure_kind in
         ('provider_exhausted','execution_failed','execution_timeout',
          'configuration','runner_error','unknown'));
alter table cos.job_queue
  drop constraint if exists job_queue_recovery_approval_id_fkey;
alter table cos.job_queue
  add constraint job_queue_recovery_approval_id_fkey
  foreign key (recovery_approval_id) references cos.approval_requests(approval_id);

create table if not exists cos.notification_outbox (
  notification_id text primary key,
  work_id text not null references cos.work_items(work_id),
  job_id text references cos.job_queue(job_id),
  kind text not null check (kind in ('provider_fallback','work_failed','providers_exhausted')),
  message text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz
);
create index if not exists notification_outbox_delivery_idx
  on cos.notification_outbox(status, created_at);
alter table cos.notification_outbox enable row level security;
revoke all on table cos.notification_outbox from public, anon, authenticated;

-- New dashboard recommendations bind the provider order and failure boundary into
-- the approved payload. The runner still enforces the same order mechanically.
create or replace function cos.api_decide_recommendation(
  p_recommendation_id text, p_action text, p_note text default '')
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare
  r record; w_id text; p_id text; a_id text; h text; plan jsonb; task_text text;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  if p_action not in ('accept','dismiss') then raise exception 'unknown action %', p_action; end if;

  select * into r from audit.recommendations where recommendation_id = p_recommendation_id for update;
  if not found then raise exception 'unknown recommendation'; end if;
  if r.status <> 'proposed' then raise exception 'recommendation already %', r.status; end if;

  update audit.recommendations
     set status = case when p_action='accept' then 'accepted' else 'dismissed' end,
         reviewer_note = nullif(p_note,''),
         updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00')
   where recommendation_id = p_recommendation_id;
  insert into audit.recommendation_feedback(feedback_id, recommendation_id, actor, action,
         old_value_json, new_value_json, note, created_at)
  values ('fb_'||replace(gen_random_uuid()::text,'-',''), p_recommendation_id,
          'human:carter', p_action||'_via_dashboard',
          json_build_object('status','proposed')::text,
          json_build_object('status', case when p_action='accept' then 'accepted' else 'dismissed' end)::text,
          p_note, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00'));

  if p_action = 'dismiss' then
    return json_build_object('ok', true, 'status', 'dismissed');
  end if;

  task_text := r.title || E'.\n\n' || coalesce(r.description,'')
               || case when coalesce(r.proposed_action,'') <> '' then E'\n\nProposed action: '||r.proposed_action else '' end
               || E'\n\nSource: AI Work Audit recommendation '||r.recommendation_id
               || '. Direct mode: commit on the default branch and push to production; include evidence the change works.';
  w_id := 'work_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.work_items(work_id, title, description, project, requester, priority, state)
  values (w_id, r.title, coalesce(r.proposed_action, r.description, ''), 'ai_info',
          'recommendation:'||r.recommendation_id,
          case when r.priority in ('critical','high','medium','low') then r.priority else 'medium' end,
          'PENDING_PLAN_APPROVAL');

  plan := jsonb_build_object(
    'objective', r.title,
    'source_recommendation', r.recommendation_id,
    'model_routing', jsonb_build_object(
      'provider_order', jsonb_build_array('claude','codex'),
      'fallback_on', jsonb_build_array('provider_exhausted'),
      'failure_policy', 'notify_pause_and_require_fresh_approval'),
    'job', jsonb_build_object(
      'job_type', 'claude_task',
      'params', jsonb_build_object('task', task_text, 'mode', 'direct',
                                   'cwd', '/Users/cartershannon/CS-Ventures')));
  h := encode(sha256(convert_to(plan::text,'utf8')),'hex');
  p_id := 'plan_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.execution_plans(plan_id, work_id, version, plan_json,
                                  model_routing_json, payload_hash)
  values (p_id, w_id, 1, plan, plan->'model_routing', h);
  a_id := 'appr_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.approval_requests(approval_id, work_id, plan_id, gate_type, payload_hash, status)
  values (a_id, w_id, p_id, 'plan', h, 'pending');
  insert into cos.run_events(event_id, work_id, actor, event_type, prior_state, new_state, reason, payload_hash)
  values ('evt_'||replace(gen_random_uuid()::text,'-',''), w_id, 'human:carter',
          'work_created_from_recommendation', null, 'PENDING_PLAN_APPROVAL', r.recommendation_id, h);

  return json_build_object('ok', true, 'status', 'accepted', 'work_id', w_id,
                           'approval_id', a_id, 'mode', 'direct',
                           'provider_order', json_build_array('claude','codex'));
end $$;

-- Plan and recovery gates both enqueue exactly one job per plan. A recovery uses a
-- new plan_id/version, so the old failed job can never be replayed accidentally.
create or replace function cos.api_decide_approval(
  p_approval_id text, p_approved boolean, p_note text default ''::text)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare a record; cur_hash text; new_status text; prior text; target text;
        plan jsonb; jobspec jsonb; j_id text; provider_order jsonb;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  select * into a from cos.approval_requests where approval_id = p_approval_id for update;
  if not found then raise exception 'unknown approval'; end if;
  if a.status <> 'pending' then raise exception 'approval already %', a.status; end if;
  if a.plan_id is not null then
    select payload_hash into cur_hash from cos.execution_plans where plan_id = a.plan_id;
    if cur_hash is distinct from a.payload_hash then
      update cos.approval_requests set status='expired', decided_at=now(),
        decision_note='plan changed after approval was requested' where approval_id = p_approval_id;
      raise exception 'plan changed since approval was requested — approval invalidated';
    end if;
  end if;
  new_status := case when p_approved then 'approved' else 'rejected' end;
  update cos.approval_requests set status=new_status, approver='cartershannon000@gmail.com',
    decision_note=p_note, decided_at=now() where approval_id = p_approval_id;
  if a.gate_type in ('plan','recovery') then
    select state into prior from cos.work_items where work_id = a.work_id for update;
    target := case when p_approved then 'APPROVED' else 'DRAFT' end;
    if prior = 'PENDING_PLAN_APPROVAL' then
      update cos.work_items set state=target, updated_at=now() where work_id = a.work_id;
      insert into cos.run_events(event_id,work_id,actor,event_type,prior_state,new_state,reason,payload_hash)
        values ('evt_'||replace(gen_random_uuid()::text,'-',''), a.work_id, 'human:carter',
                'approval_decided', prior, target, new_status||':'||a.gate_type, a.payload_hash);
      if p_approved and a.plan_id is not null then
        select plan_json into plan from cos.execution_plans where plan_id = a.plan_id;
        jobspec := plan->'job';
        provider_order := coalesce(plan->'model_routing'->'provider_order',
                                   '["claude","codex"]'::jsonb);
        if jobspec is not null and not exists (
             select 1 from cos.job_queue where idempotency_key = 'plan_'||a.plan_id) then
          j_id := 'job_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
          insert into cos.job_queue(job_id, work_id, plan_id, job_type, params_json,
                                    idempotency_key, provider_order, state)
          values (j_id, a.work_id, a.plan_id, jobspec->>'job_type',
                  coalesce(jobspec->'params','{}'::jsonb), 'plan_'||a.plan_id,
                  provider_order, 'QUEUED');
          update cos.work_items set state='QUEUED', updated_at=now() where work_id = a.work_id;
          insert into cos.run_events(event_id,work_id,job_id,actor,event_type,prior_state,new_state,reason)
            values ('evt_'||replace(gen_random_uuid()::text,'-',''), a.work_id, j_id, 'system',
                    'job_enqueued', 'APPROVED', 'QUEUED',
                    (jobspec->>'job_type')||':'||a.gate_type);
        end if;
      end if;
    end if;
  end if;
  return json_build_object('ok', true, 'status', new_status, 'gate_type', a.gate_type);
end $$;

revoke all on function cos.api_decide_recommendation(text,text,text) from public, anon;
revoke all on function cos.api_decide_approval(text,boolean,text) from public, anon;
grant execute on function cos.api_decide_recommendation(text,text,text) to authenticated;
grant execute on function cos.api_decide_approval(text,boolean,text) to authenticated;
