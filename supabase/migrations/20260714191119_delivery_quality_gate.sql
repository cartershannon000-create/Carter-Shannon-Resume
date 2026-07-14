-- Delivery-quality gate
--
-- Process success is only a candidate delivery. New jobs must prove every
-- approved benefit with mechanical checks and activation evidence, then pass a
-- read-only review by the opposite provider before release can be approved.

alter table cos.job_queue add column if not exists quality_required boolean;
update cos.job_queue set quality_required=false where quality_required is null;
alter table cos.job_queue alter column quality_required set default true;
alter table cos.job_queue alter column quality_required set not null;

alter table cos.job_queue add column if not exists quality_status text;
update cos.job_queue set quality_status='not_required' where quality_status is null;
alter table cos.job_queue alter column quality_status set default 'pending';
alter table cos.job_queue alter column quality_status set not null;
alter table cos.job_queue drop constraint if exists job_queue_quality_status_check;
alter table cos.job_queue add constraint job_queue_quality_status_check
  check (quality_status in
         ('not_required','pending','passed','revisions_required','blocked'));

alter table cos.job_queue drop constraint if exists job_queue_failure_kind_check;
alter table cos.job_queue add constraint job_queue_failure_kind_check
  check (failure_kind is null or failure_kind in
         ('provider_exhausted','execution_failed','execution_timeout','quality_failed',
          'configuration','runner_error','unknown'));

create table if not exists cos.delivery_quality_reviews (
  review_id text primary key,
  work_id text not null references cos.work_items(work_id),
  job_id text not null references cos.job_queue(job_id),
  attempt integer not null check (attempt > 0),
  builder_provider text not null check (builder_provider in ('claude','codex')),
  reviewer_provider text not null check (reviewer_provider in ('claude','codex')),
  gate_status text not null
    check (gate_status in ('passed','revisions_required','blocked')),
  score integer not null check (score between 0 and 20),
  manifest_json jsonb not null check (jsonb_typeof(manifest_json)='object'),
  review_json jsonb not null check (jsonb_typeof(review_json)='object'),
  benefit_count integer not null check (benefit_count > 0),
  benefits_passed integer not null check (
    benefits_passed >= 0 and benefits_passed <= benefit_count),
  required_check_count integer not null check (required_check_count >= 0),
  checks_passed integer not null check (
    checks_passed >= 0 and checks_passed <= required_check_count),
  critical_findings integer not null default 0 check (critical_findings >= 0),
  major_findings integer not null default 0 check (major_findings >= 0),
  limitations_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(limitations_json)='array'),
  created_at timestamptz not null default now(),
  unique(job_id,attempt),
  check (builder_provider <> reviewer_provider),
  check (gate_status <> 'passed' or (
    score >= 17 and benefits_passed=benefit_count
    and checks_passed=required_check_count
    and required_check_count > 0
    and critical_findings=0 and major_findings=0))
);

create index if not exists delivery_quality_reviews_work_created_idx
  on cos.delivery_quality_reviews(work_id,created_at desc);
create index if not exists delivery_quality_reviews_job_idx
  on cos.delivery_quality_reviews(job_id);
create index if not exists job_queue_quality_pending_idx
  on cos.job_queue(created_at) where quality_required and quality_status <> 'passed';

alter table cos.job_queue add column if not exists quality_review_id text;
alter table cos.job_queue drop constraint if exists job_queue_quality_review_id_fkey;
alter table cos.job_queue add constraint job_queue_quality_review_id_fkey
  foreign key (quality_review_id) references cos.delivery_quality_reviews(review_id);
create index if not exists job_queue_quality_review_idx
  on cos.job_queue(quality_review_id) where quality_review_id is not null;

alter table cos.delivery_quality_reviews enable row level security;
revoke all on table cos.delivery_quality_reviews from public,anon,authenticated;

comment on table cos.delivery_quality_reviews is
  'Immutable opposite-provider reviews of structured delivery evidence.';
comment on column cos.job_queue.quality_required is
  'False only for jobs created before the delivery-quality gate was installed.';

create or replace function cos.derive_acceptance_contract(p_plan jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'schema_version',1,
    'task_type',coalesce(nullif(p_plan->'job'->>'job_type',''),'repo_change'),
    'expected_benefits',jsonb_build_array(
      jsonb_build_object(
        'id','approved_outcome',
        'statement',coalesce(nullif(trim(p_plan->>'objective'),''),'Complete the approved work')),
      jsonb_build_object(
        'id','operational_activation',
        'statement',left(coalesce(
          nullif(trim(p_plan->'job'->'params'->>'task'),''),
          'The approved outcome is active in the real user or runtime path, not only scaffolded.'),1000))),
    'minimum_review_score',17,
    'require_independent_review',true,
    'require_activation_evidence',true,
    'require_mechanical_checks',true)
$$;

revoke all on function cos.derive_acceptance_contract(jsonb) from public,anon,authenticated;

create or replace function cos.api_quality_state()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'generated_at',now(),
    'reviews',(select coalesce(jsonb_agg(r order by r.created_at desc),'[]'::jsonb)
      from (
        select d.review_id,d.work_id,d.job_id,d.attempt,d.builder_provider,
          d.reviewer_provider,d.gate_status,d.score,d.benefit_count,
          d.benefits_passed,d.required_check_count,d.checks_passed,
          d.critical_findings,d.major_findings,d.limitations_json limitations,
          d.manifest_json manifest,d.review_json review,d.created_at
        from cos.delivery_quality_reviews d
        order by d.created_at desc limit 100
      ) r),
    'contracts',(select coalesce(jsonb_agg(c order by c.created_at desc),'[]'::jsonb)
      from (
        select p.plan_id,p.work_id,a.approval_id,q.job_id,
          coalesce(q.quality_required,true) quality_required,
          coalesce(q.quality_status,'pending') quality_status,q.quality_review_id,
          coalesce(p.plan_json->'acceptance_contract',
                   cos.derive_acceptance_contract(p.plan_json)) acceptance_contract,
          p.created_at
        from cos.execution_plans p
        left join cos.job_queue q on q.plan_id=p.plan_id
        left join cos.approval_requests a on a.plan_id=p.plan_id and a.status='pending'
        order by p.created_at desc limit 100
      ) c),
    'skill_summary',(select jsonb_build_object(
      'observations',count(*),
      'skill_observations',count(*) filter(where invocation_type <> 'no_skill'),
      'no_skill_baselines',count(*) filter(where invocation_type='no_skill'),
      'verified',count(*) filter(where verification='verified'),
      'latest_observation_at',max(invoked_at))
      from cos.skill_invocation_events),
    'skill_weekly',(select coalesce(jsonb_agg(s order by s.week_start desc,s.provider,
      s.task_type,s.skill_name),'[]'::jsonb)
      from (select * from cos.weekly_skill_effectiveness
            order by week_start desc limit 200) s)
  );
end $$;

revoke all on function cos.api_quality_state() from public,anon;
grant execute on function cos.api_quality_state() to authenticated;

-- Bind the explicit benefit contract and selected provider order into the same
-- hash that the owner approves. The compatibility overload still routes here.
create or replace function cos.api_decide_approval(
  p_approval_id text,p_approved boolean,p_note text,p_start_provider text)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare
  a record; cur_hash text; chosen_hash text; new_status text; prior text;
  target text; plan jsonb; routing jsonb; jobspec jsonb; j_id text;
  provider_order jsonb; acceptance_contract jsonb;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  select * into a from cos.approval_requests
   where approval_id=p_approval_id for update;
  if not found then raise exception 'unknown approval'; end if;
  if a.status <> 'pending' then raise exception 'approval already %',a.status; end if;

  if a.plan_id is not null then
    select payload_hash,plan_json into cur_hash,plan
      from cos.execution_plans where plan_id=a.plan_id for update;
    if cur_hash is distinct from a.payload_hash then
      update cos.approval_requests set status='expired',decided_at=now(),
        decision_note='plan changed after approval was requested'
       where approval_id=p_approval_id;
      raise exception 'plan changed since approval was requested — approval invalidated';
    end if;
  end if;

  chosen_hash := cur_hash;
  if p_approved and a.gate_type in ('plan','recovery') then
    if p_start_provider not in ('claude','codex') then
      raise exception 'invalid start provider: %',p_start_provider;
    end if;
    if plan is null then raise exception 'approval has no execution plan'; end if;

    provider_order := case p_start_provider
      when 'codex' then jsonb_build_array('codex','claude')
      else jsonb_build_array('claude','codex') end;
    routing := coalesce(plan->'model_routing','{}'::jsonb)
      || jsonb_build_object(
        'start_provider',p_start_provider,
        'provider_order',provider_order,
        'fallback_on',jsonb_build_array('provider_exhausted'),
        'failure_policy','notify_pause_and_require_fresh_approval');
    acceptance_contract := coalesce(
      plan->'acceptance_contract',cos.derive_acceptance_contract(plan));
    plan := jsonb_set(plan,'{model_routing}',routing,true);
    plan := jsonb_set(plan,'{acceptance_contract}',acceptance_contract,true);
    chosen_hash := encode(sha256(convert_to(plan::text,'utf8')),'hex');

    update cos.execution_plans
       set plan_json=plan,model_routing_json=routing,payload_hash=chosen_hash
     where plan_id=a.plan_id;
  end if;

  new_status := case when p_approved then 'approved' else 'rejected' end;
  update cos.approval_requests
     set status=new_status,approver='cartershannon000@gmail.com',decision_note=p_note,
         decided_at=now(),payload_hash=coalesce(chosen_hash,payload_hash)
   where approval_id=p_approval_id;

  if a.gate_type in ('plan','recovery') then
    select state into prior from cos.work_items where work_id=a.work_id for update;
    target := case when p_approved then 'APPROVED' else 'DRAFT' end;
    if prior='PENDING_PLAN_APPROVAL' then
      update cos.work_items set state=target,updated_at=now() where work_id=a.work_id;
      insert into cos.run_events(
        event_id,work_id,actor,event_type,prior_state,new_state,reason,payload_hash,data_json)
      values (
        'evt_'||replace(gen_random_uuid()::text,'-',''),a.work_id,'human:carter',
        'approval_decided',prior,target,
        new_status||':'||a.gate_type||case when p_approved then ':start='||p_start_provider else '' end,
        coalesce(chosen_hash,a.payload_hash),
        jsonb_build_object(
          'start_provider',case when p_approved then p_start_provider else null end,
          'acceptance_contract',case when p_approved then acceptance_contract else null end));

      if p_approved and a.plan_id is not null then
        jobspec := plan->'job';
        if jobspec is not null and not exists (
          select 1 from cos.job_queue where idempotency_key='plan_'||a.plan_id) then
          j_id := 'job_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
          insert into cos.job_queue(
            job_id,work_id,plan_id,job_type,params_json,idempotency_key,
            provider_order,active_provider,state)
          values (
            j_id,a.work_id,a.plan_id,jobspec->>'job_type',
            coalesce(jobspec->'params','{}'::jsonb),'plan_'||a.plan_id,
            provider_order,null,'QUEUED');
          update cos.work_items set state='QUEUED',updated_at=now() where work_id=a.work_id;
          insert into cos.run_events(
            event_id,work_id,job_id,actor,event_type,prior_state,new_state,reason,
            payload_hash,data_json)
          values (
            'evt_'||replace(gen_random_uuid()::text,'-',''),a.work_id,j_id,'system',
            'job_enqueued','APPROVED','QUEUED',
            (jobspec->>'job_type')||':'||a.gate_type||':start='||p_start_provider,
            chosen_hash,jsonb_build_object(
              'start_provider',p_start_provider,'provider_order',provider_order,
              'acceptance_contract',acceptance_contract));
        end if;
      end if;
    end if;
  end if;

  return json_build_object(
    'ok',true,'status',new_status,'gate_type',a.gate_type,
    'start_provider',case when p_approved then p_start_provider else null end,
    'provider_order',case when p_approved then provider_order else null end,
    'acceptance_contract',case when p_approved then acceptance_contract else null end,
    'payload_hash',coalesce(chosen_hash,a.payload_hash));
end $$;

revoke all on function cos.api_decide_approval(text,boolean,text,text) from public,anon;
grant execute on function cos.api_decide_approval(text,boolean,text,text) to authenticated;

create or replace function cos.api_release(
  p_work_id text,p_note text default 'released'::text)
returns json
language plpgsql
security definer
set search_path to 'cos','public'
as $$
declare prior text; q record;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  select state into prior from cos.work_items where work_id=p_work_id for update;
  if prior is null then raise exception 'unknown work item'; end if;
  if prior <> 'READY_FOR_RELEASE_APPROVAL' then
    raise exception 'work item is not awaiting release (state=%)',prior;
  end if;

  select j.quality_required,j.quality_status,d.gate_status,d.score,
         d.benefit_count,d.benefits_passed,d.required_check_count,d.checks_passed,
         d.critical_findings,d.major_findings
    into q
    from cos.job_queue j
    left join cos.delivery_quality_reviews d on d.review_id=j.quality_review_id
   where j.work_id=p_work_id
   order by j.created_at desc limit 1;
  if found and q.quality_required and not (
    q.quality_status='passed' and q.gate_status='passed' and q.score>=17
    and q.benefit_count=q.benefits_passed
    and q.required_check_count>0 and q.required_check_count=q.checks_passed
    and q.critical_findings=0 and q.major_findings=0
  ) then
    raise exception 'release blocked: delivery quality evidence has not passed';
  end if;

  update cos.work_items set state='COMPLETED',updated_at=now()
   where work_id=p_work_id;
  insert into cos.run_events(
    event_id,work_id,actor,event_type,prior_state,new_state,reason)
  values ('evt_'||replace(gen_random_uuid()::text,'-',''),p_work_id,'human:carter',
          'state_transition',prior,'COMPLETED',p_note);
  return json_build_object('ok',true);
end $$;

revoke all on function cos.api_release(text,text) from public,anon;
grant execute on function cos.api_release(text,text) to authenticated;
