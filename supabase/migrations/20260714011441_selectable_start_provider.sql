-- Let the owner select which implementation model starts an approved shipping
-- attempt. The selection is made inside the approval transaction, folded into
-- the plan hash, copied to the queued job, and recorded in append-only events.
-- The existing 3-argument RPC remains as a Claude-first compatibility wrapper.

create or replace function cos.api_decide_approval(
  p_approval_id text,
  p_approved boolean,
  p_note text,
  p_start_provider text)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare
  a record;
  cur_hash text;
  chosen_hash text;
  new_status text;
  prior text;
  target text;
  plan jsonb;
  routing jsonb;
  jobspec jsonb;
  j_id text;
  provider_order jsonb;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  select * into a
    from cos.approval_requests
   where approval_id = p_approval_id
   for update;
  if not found then raise exception 'unknown approval'; end if;
  if a.status <> 'pending' then raise exception 'approval already %', a.status; end if;

  if a.plan_id is not null then
    select payload_hash, plan_json into cur_hash, plan
      from cos.execution_plans
     where plan_id = a.plan_id
     for update;
    if cur_hash is distinct from a.payload_hash then
      update cos.approval_requests
         set status='expired', decided_at=now(),
             decision_note='plan changed after approval was requested'
       where approval_id = p_approval_id;
      raise exception 'plan changed since approval was requested — approval invalidated';
    end if;
  end if;

  chosen_hash := cur_hash;
  if p_approved and a.gate_type in ('plan','recovery') then
    if p_start_provider not in ('claude','codex') then
      raise exception 'invalid start provider: %', p_start_provider;
    end if;
    if plan is null then raise exception 'approval has no execution plan'; end if;

    provider_order := case p_start_provider
      when 'codex' then jsonb_build_array('codex','claude')
      else jsonb_build_array('claude','codex')
    end;
    routing := coalesce(plan->'model_routing', '{}'::jsonb)
      || jsonb_build_object(
           'start_provider', p_start_provider,
           'provider_order', provider_order,
           'fallback_on', jsonb_build_array('provider_exhausted'),
           'failure_policy', 'notify_pause_and_require_fresh_approval');
    plan := jsonb_set(plan, '{model_routing}', routing, true);
    chosen_hash := encode(sha256(convert_to(plan::text,'utf8')),'hex');

    update cos.execution_plans
       set plan_json=plan,
           model_routing_json=routing,
           payload_hash=chosen_hash
     where plan_id=a.plan_id;
  end if;

  new_status := case when p_approved then 'approved' else 'rejected' end;
  update cos.approval_requests
     set status=new_status,
         approver='cartershannon000@gmail.com',
         decision_note=p_note,
         decided_at=now(),
         payload_hash=coalesce(chosen_hash, payload_hash)
   where approval_id=p_approval_id;

  if a.gate_type in ('plan','recovery') then
    select state into prior
      from cos.work_items
     where work_id=a.work_id
     for update;
    target := case when p_approved then 'APPROVED' else 'DRAFT' end;
    if prior = 'PENDING_PLAN_APPROVAL' then
      update cos.work_items
         set state=target, updated_at=now()
       where work_id=a.work_id;
      insert into cos.run_events(
        event_id,work_id,actor,event_type,prior_state,new_state,reason,payload_hash,data_json)
      values (
        'evt_'||replace(gen_random_uuid()::text,'-',''), a.work_id, 'human:carter',
        'approval_decided', prior, target,
        new_status||':'||a.gate_type||case when p_approved then ':start='||p_start_provider else '' end,
        coalesce(chosen_hash,a.payload_hash),
        jsonb_build_object('start_provider',case when p_approved then p_start_provider else null end));

      if p_approved and a.plan_id is not null then
        jobspec := plan->'job';
        if jobspec is not null and not exists (
          select 1 from cos.job_queue where idempotency_key='plan_'||a.plan_id
        ) then
          j_id := 'job_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
          insert into cos.job_queue(
            job_id,work_id,plan_id,job_type,params_json,idempotency_key,
            provider_order,active_provider,state)
          values (
            j_id,a.work_id,a.plan_id,jobspec->>'job_type',
            coalesce(jobspec->'params','{}'::jsonb),'plan_'||a.plan_id,
            provider_order,null,'QUEUED');
          update cos.work_items
             set state='QUEUED',updated_at=now()
           where work_id=a.work_id;
          insert into cos.run_events(
            event_id,work_id,job_id,actor,event_type,prior_state,new_state,reason,payload_hash,data_json)
          values (
            'evt_'||replace(gen_random_uuid()::text,'-',''),a.work_id,j_id,'system',
            'job_enqueued','APPROVED','QUEUED',
            (jobspec->>'job_type')||':'||a.gate_type||':start='||p_start_provider,
            chosen_hash,
            jsonb_build_object('start_provider',p_start_provider,'provider_order',provider_order));
        end if;
      end if;
    end if;
  end if;

  return json_build_object(
    'ok',true,
    'status',new_status,
    'gate_type',a.gate_type,
    'start_provider',case when p_approved then p_start_provider else null end,
    'provider_order',case when p_approved then provider_order else null end,
    'payload_hash',coalesce(chosen_hash,a.payload_hash));
end $$;

-- Backward-compatible surface for a cached client or older caller.
create or replace function cos.api_decide_approval(
  p_approval_id text,
  p_approved boolean,
  p_note text default ''::text)
returns json
language sql
security definer
set search_path to 'cos','public'
as $$
  select cos.api_decide_approval(
    p_approval_id,p_approved,p_note,'claude'::text);
$$;

revoke all on function cos.api_decide_approval(text,boolean,text,text) from public,anon;
revoke all on function cos.api_decide_approval(text,boolean,text) from public,anon;
grant execute on function cos.api_decide_approval(text,boolean,text,text) to authenticated;
grant execute on function cos.api_decide_approval(text,boolean,text) to authenticated;
