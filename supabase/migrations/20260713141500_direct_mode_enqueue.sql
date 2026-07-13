-- Direct mode ON (Carter's call, 2026-07-13): accepted recommendations now enqueue
-- claude_task jobs with mode='direct' — the runner commits on the default branch and
-- pushes straight to production, then texts Carter. The human gate is the plan
-- approval on the website; there is no second PR-merge/release gate in this mode.
-- Runner-side kill-switch: safety.allow_direct_push in cos-control-plane/config/cos.json
-- (the runner refuses direct jobs when that is false).

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
    'job', jsonb_build_object(
      'job_type', 'claude_task',
      'params', jsonb_build_object('task', task_text, 'mode', 'direct',
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

  return json_build_object('ok', true, 'status', 'accepted', 'work_id', w_id, 'approval_id', a_id,
                           'mode', 'direct');
end $$;

revoke all on function cos.api_decide_recommendation(text,text,text) from public, anon;
grant execute on function cos.api_decide_recommendation(text,text,text) to authenticated;
