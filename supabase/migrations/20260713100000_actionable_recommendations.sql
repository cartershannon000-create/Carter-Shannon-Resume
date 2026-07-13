-- Recommendations become actionable from the /dev Approvals tab:
--   * cos.api_decide_recommendation('dismiss')  -> status change + feedback trail
--   * cos.api_decide_recommendation('accept')   -> creates a cos work item + claude_task
--     plan + plan-gate approval request (shows up in Execution approvals)
--   * cos.api_decide_approval now auto-enqueues the plan's job when a plan gate is
--     approved, so website approval alone puts work in front of the runner daemon.

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
         reviewer_note = nullif(p_note,''), updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US+00:00')
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

  -- accept -> spawn control-plane work: work item + claude_task plan + plan-gate approval
  task_text := r.title || E'.\n\n' || coalesce(r.description,'')
               || case when coalesce(r.proposed_action,'') <> '' then E'\n\nProposed action: '||r.proposed_action else '' end
               || E'\n\nSource: AI Work Audit recommendation '||r.recommendation_id
               || '. Deliver on a branch with a PR; include evidence the change works.';
  w_id := 'work_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.work_items(work_id, title, description, project, requester, priority, state)
  values (w_id, r.title, coalesce(r.proposed_action, r.description, ''), 'ai_info',
          'recommendation:'||r.recommendation_id,
          case when r.priority in ('critical','high','medium','low') then r.priority else 'medium' end,
          'PENDING_PLAN_APPROVAL');

  plan := jsonb_build_object(
    'objective', r.title,
    'source_recommendation', r.recommendation_id,
    'job', jsonb_build_object(
      'job_type', 'claude_task',
      'params', jsonb_build_object('task', task_text, 'mode', 'branch_pr',
                                   'cwd', '/Users/cartershannon/CS-Ventures')));
  h := encode(sha256(convert_to(plan::text,'utf8')),'hex');
  p_id := 'plan_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.execution_plans(plan_id, work_id, version, plan_json, payload_hash)
  values (p_id, w_id, 1, plan, h);
  a_id := 'appr_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into cos.approval_requests(approval_id, work_id, plan_id, gate_type, payload_hash, status)
  values (a_id, w_id, p_id, 'plan', h, 'pending');
  insert into cos.run_events(event_id, work_id, actor, event_type, prior_state, new_state, reason, payload_hash)
  values ('evt_'||replace(gen_random_uuid()::text,'-',''), w_id, 'human:carter',
          'work_created_from_recommendation', null, 'PENDING_PLAN_APPROVAL', r.recommendation_id, h);

  return json_build_object('ok', true, 'status', 'accepted', 'work_id', w_id, 'approval_id', a_id);
end $$;

revoke all on function cos.api_decide_recommendation(text,text,text) from public, anon;
grant execute on function cos.api_decide_recommendation(text,text,text) to authenticated;

-- Plan approval from any surface now enqueues the plan's job for the runner daemon.
create or replace function cos.api_decide_approval(p_approval_id text, p_approved boolean, p_note text default ''::text)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare a record; cur_hash text; new_status text; prior text; target text;
        plan jsonb; jobspec jsonb; j_id text;
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
  if a.gate_type = 'plan' then
    select state into prior from cos.work_items where work_id = a.work_id for update;
    target := case when p_approved then 'APPROVED' else 'DRAFT' end;
    if prior = 'PENDING_PLAN_APPROVAL' then
      update cos.work_items set state=target, updated_at=now() where work_id = a.work_id;
      insert into cos.run_events(event_id,work_id,actor,event_type,prior_state,new_state,reason,payload_hash)
        values ('evt_'||replace(gen_random_uuid()::text,'-',''), a.work_id, 'human:carter',
                'approval_decided', prior, target, new_status, a.payload_hash);
      -- If the approved plan carries an executable job spec, enqueue it now so the
      -- runner daemon picks it up without a separate CLI step.
      if p_approved and a.plan_id is not null then
        select plan_json into plan from cos.execution_plans where plan_id = a.plan_id;
        jobspec := plan->'job';
        if jobspec is not null and not exists (
             select 1 from cos.job_queue where idempotency_key = 'plan_'||a.plan_id) then
          j_id := 'job_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
          insert into cos.job_queue(job_id, work_id, plan_id, job_type, params_json,
                                    idempotency_key, state)
          values (j_id, a.work_id, a.plan_id, jobspec->>'job_type',
                  coalesce(jobspec->'params','{}'::jsonb), 'plan_'||a.plan_id, 'QUEUED');
          update cos.work_items set state='QUEUED', updated_at=now() where work_id = a.work_id;
          insert into cos.run_events(event_id,work_id,job_id,actor,event_type,prior_state,new_state,reason)
            values ('evt_'||replace(gen_random_uuid()::text,'-',''), a.work_id, j_id, 'system',
                    'job_enqueued', 'APPROVED', 'QUEUED', jobspec->>'job_type');
        end if;
      end if;
    end if;
  end if;
  return json_build_object('ok', true, 'status', new_status);
end $$;
