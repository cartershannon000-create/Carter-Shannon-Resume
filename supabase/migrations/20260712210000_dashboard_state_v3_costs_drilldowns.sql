-- Dashboard data contract v3: real token telemetry (incl. cache), estimated
-- API-equivalent costs from audit.model_prices, data-freshness, 24h/7d windows,
-- and drill-down payloads for the interactive /dev console.

create or replace function cos.api_dashboard_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_tasks integer;
  v_completed_tasks integer;
  v_active_tasks integer;
  v_fresh_tasks integer;
  v_blocked_tasks integer;
  v_checkpoints integer;
  v_artifacts integer;
  v_tests integer;
  v_outcome_records integer;
  v_outcome_tasks integer;
  v_verified integer;
  v_retries integer;
  v_claude_events integer;
  v_claude_tokenized integer;
  v_codex_events integer;
  v_codex_tokenized integer;
  v_pending_recommendations integer;
  v_pending_approvals integer;
  v_decided_approvals integer;
  v_approval_latency numeric;
  v_total_cost numeric;
  v_cost_7d numeric;
  v_events_24h integer;
  v_cutoff_24h text := to_char(now() at time zone 'utc' - interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_cutoff_7d text := to_char((now() - interval '7 days')::date, 'YYYY-MM-DD');
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  select count(*), count(*) filter (where status='completed'), count(*) filter (where status='active')
  into v_total_tasks, v_completed_tasks, v_active_tasks
  from cos.continuity_tasks;

  select count(*) filter (where t.updated_at >= now() - interval '7 days'),
         count(*) filter (where jsonb_array_length(coalesce(c.blockers,'[]'::jsonb)) > 0)
  into v_fresh_tasks, v_blocked_tasks
  from cos.continuity_tasks t
  left join lateral (
    select blockers from cos.continuity_checkpoints c
    where c.task_id=t.task_id order by c.version desc limit 1
  ) c on true
  where t.status='active';

  select count(*), coalesce(sum(jsonb_array_length(artifacts)),0), coalesce(sum(jsonb_array_length(tests)),0)
  into v_checkpoints, v_artifacts, v_tests from cos.continuity_checkpoints;

  select count(*), count(distinct task_id), count(*) filter (where verification='verified'), coalesce(sum(retry_count),0)
  into v_outcome_records, v_outcome_tasks, v_verified, v_retries from audit.task_outcomes;

  select count(*) filter (where provider='claude'),
         count(*) filter (where provider='claude' and (coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0 or coalesce(tokens_cache_read,0)>0)),
         count(*) filter (where provider='codex'),
         count(*) filter (where provider='codex' and (coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0 or coalesce(tokens_cache_read,0)>0))
  into v_claude_events, v_claude_tokenized, v_codex_events, v_codex_tokenized
  from audit.conversation_events;

  select coalesce(sum(est_cost_usd),0),
         coalesce(sum(est_cost_usd) filter (where week_start >= v_cutoff_7d),0),
         count(*) filter (where created_at_utc >= v_cutoff_24h)
  into v_total_cost, v_cost_7d, v_events_24h
  from audit.event_costs;

  select count(*) into v_pending_recommendations from audit.recommendations where status='proposed';
  select count(*) filter (where status='pending'), count(*) filter (where decided_at is not null),
         avg(extract(epoch from (decided_at-requested_at))) filter (where decided_at is not null)
  into v_pending_approvals, v_decided_approvals, v_approval_latency from cos.approval_requests;

  return jsonb_build_object(
    'generated_at', now(),
    'data_contract_version', 3,
    'overview', jsonb_build_object(
      'active_work',v_active_tasks,
      'pending_review',v_pending_recommendations,
      'pending_approvals',v_pending_approvals,
      'events',(select count(*) from audit.conversation_events),
      'events_24h',v_events_24h,
      'captured_tokens',(select coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) from audit.conversation_events),
      'est_cost_total',round(v_total_cost,2),
      'est_cost_7d',round(v_cost_7d,2),
      'outcome_tasks',v_outcome_tasks,
      'verified_outcomes',v_verified
    ),
    'freshness', jsonb_build_object(
      'providers',(select coalesce(jsonb_agg(f order by f.provider),'[]'::jsonb) from (
        select provider, max(created_at_utc) as last_event_at, count(*) filter (where created_at_utc >= v_cutoff_24h) as events_24h
        from audit.conversation_events group by provider
      ) f),
      'watermarks',(select coalesce(jsonb_agg(w order by w.source_key),'[]'::jsonb) from (
        select source_key,last_created_at,updated_at from audit.source_watermarks
      ) w),
      'last_audit_run',(select to_jsonb(r) from (
        select run_id,created_at,status,new_events,total_events from audit.audit_runs order by created_at desc limit 1
      ) r)
    ),
    'control_plane', jsonb_build_object(
      'website','operational',
      'database','operational',
      'local_runner',case when exists(select 1 from cos.runner_devices where status='active' and last_heartbeat_at >= now()-interval '5 minutes') then 'connected' else 'not_connected' end,
      'agent_architect','operational',
      'approval_queue_connected',true
    ),
    'audit', jsonb_build_object(
      'providers',(select coalesce(jsonb_agg(p order by p.provider),'[]'::jsonb) from (
        select e.provider,count(*) events,count(distinct nullif(e.session_id,'')) sessions,
          count(*) filter(where e.response_available=1) completed,
          coalesce(sum(e.tokens_in),0) tokens_in,coalesce(sum(e.tokens_out),0) tokens_out,
          coalesce(sum(e.tokens_cache_read),0) tokens_cache_read,
          coalesce(sum(e.tokens_cache_write),0) tokens_cache_write,
          coalesce(sum(coalesce(e.tokens_in,0)+coalesce(e.tokens_out,0)+coalesce(e.tokens_cache_read,0)+coalesce(e.tokens_cache_write,0)),0) tokens_total,
          count(*) filter(where coalesce(e.tokens_in,0)>0 or coalesce(e.tokens_out,0)>0 or coalesce(e.tokens_cache_read,0)>0) tokenized_events,
          (count(*) filter(where coalesce(e.tokens_in,0)>0 or coalesce(e.tokens_out,0)>0 or coalesce(e.tokens_cache_read,0)>0) > 0) tokens_available,
          round(count(*) filter(where coalesce(e.tokens_in,0)>0 or coalesce(e.tokens_out,0)>0 or coalesce(e.tokens_cache_read,0)>0)::numeric/nullif(count(*),0),4) token_coverage,
          round(coalesce(sum(c.est_cost_usd),0)::numeric,2) est_cost,
          round(coalesce(sum(c.est_cost_usd) filter (where c.week_start >= v_cutoff_7d),0)::numeric,2) est_cost_7d,
          bool_or(coalesce(c.is_estimate,true)) cost_is_estimate,
          max(e.created_at_utc) last_event_at
        from audit.conversation_events e
        left join audit.event_costs c on c.event_id=e.event_id
        group by e.provider
      ) p),
      'weekly',(select coalesce(jsonb_agg(w order by w.week_start,w.provider),'[]'::jsonb) from (
        select week_start,provider,count(*) events,
          coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) tokens,
          round(coalesce(sum(est_cost_usd),0)::numeric,2) est_cost
        from audit.event_costs group by week_start,provider
      ) w),
      'models',(select coalesce(jsonb_agg(m order by m.provider,m.events desc),'[]'::jsonb) from (
        select provider,coalesce(nullif(model,''),'unknown') model,count(*) events,
          count(distinct nullif(session_id,'')) sessions,
          coalesce(sum(tokens_in),0) tokens_in,coalesce(sum(tokens_out),0) tokens_out,
          coalesce(sum(tokens_cache_read),0) tokens_cache_read,
          coalesce(sum(tokens_cache_write),0) tokens_cache_write,
          coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) tokens_total,
          count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0 or coalesce(tokens_cache_read,0)>0) tokenized_events,
          (count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0 or coalesce(tokens_cache_read,0)>0) > 0) tokens_available,
          round(coalesce(sum(est_cost_usd),0)::numeric,2) est_cost,
          bool_or(coalesce(is_estimate,true)) cost_is_estimate,
          max(created_at_utc) last_event_at
        from audit.event_costs group by provider,coalesce(nullif(model,''),'unknown')
      ) m),
      'model_weekly',(select coalesce(jsonb_agg(mw order by mw.provider,mw.model,mw.week_start),'[]'::jsonb) from (
        select provider,coalesce(nullif(model,''),'unknown') model,week_start,count(*) events,
          coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) tokens,
          round(coalesce(sum(est_cost_usd),0)::numeric,2) est_cost
        from audit.event_costs group by provider,coalesce(nullif(model,''),'unknown'),week_start
      ) mw),
      'projects',(select coalesce(jsonb_agg(p order by p.events desc),'[]'::jsonb) from (
        select coalesce(nullif(project_normalized,''),'Unassigned') project,count(*) events,
          count(distinct nullif(session_id,'')) sessions,
          count(*) filter (where provider='claude') claude_events,
          count(*) filter (where provider='codex') codex_events,
          coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) tokens,
          round(coalesce(sum(est_cost_usd),0)::numeric,2) est_cost,
          max(created_at_utc) last_event_at
        from audit.event_costs group by coalesce(nullif(project_normalized,''),'Unassigned')
        order by count(*) desc limit 12
      ) p),
      'sessions_recent',(select coalesce(jsonb_agg(s order by s.est_cost desc nulls last),'[]'::jsonb) from (
        select provider,session_id,coalesce(nullif(project_normalized,''),'Unassigned') project,
          count(*) events,
          coalesce(sum(coalesce(tokens_in,0)+coalesce(tokens_out,0)+coalesce(tokens_cache_read,0)+coalesce(tokens_cache_write,0)),0) tokens,
          round(coalesce(sum(est_cost_usd),0)::numeric,2) est_cost,
          min(created_at_utc) started_at, max(created_at_utc) last_at
        from audit.event_costs
        where week_start >= to_char((now() - interval '14 days')::date, 'YYYY-MM-DD') and coalesce(session_id,'') <> ''
        group by provider,session_id,coalesce(nullif(project_normalized,''),'Unassigned')
        order by round(coalesce(sum(est_cost_usd),0)::numeric,2) desc nulls last limit 12
      ) s),
      'recommendations',(select coalesce(jsonb_agg(r order by r.priority_rank,r.updated_at desc),'[]'::jsonb) from (
        select recommendation_id,recommendation_key,title,description,category,work_type,priority,status,
          coalesce(nullif(target_agents_json,''),'[]')::jsonb target_agents,proposed_action,updated_at,
          case priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end priority_rank
        from audit.recommendations
      ) r),
      'outcomes',(select jsonb_build_object('records',count(*),'tasks',count(distinct task_id),
        'completed',count(*) filter(where status='completed'),'blocked',count(*) filter(where status='blocked'),
        'verified',count(*) filter(where verification='verified'),'artifacts',coalesce(sum(artifact_count),0),
        'retries',coalesce(sum(retry_count),0),'recoveries',coalesce(sum(recovery_count),0)) from audit.task_outcomes),
      'audit_runs',(select coalesce(jsonb_agg(r order by r.created_at desc),'[]'::jsonb) from (
        select run_id,created_at,status,new_events,total_events from audit.audit_runs order by created_at desc limit 8
      ) r),
      'watermarks',(select coalesce(jsonb_agg(w order by w.source_key),'[]'::jsonb) from (
        select source_key,last_created_at,updated_at from audit.source_watermarks
      ) w)
    ),
    'continuity', jsonb_build_object(
      'tasks',(select coalesce(jsonb_agg(t order by (t.status='active') desc,t.updated_at desc),'[]'::jsonb) from (
        select x.task_id,x.objective,x.status,x.owner_agent,x.created_at,x.updated_at,x.completed_at,x.outcome,x.acceptance,
          c.version checkpoint_version,c.summary,c.next_action,c.blockers,c.artifacts,c.tests,c.created_at checkpoint_at
        from cos.continuity_tasks x left join lateral (
          select * from cos.continuity_checkpoints c where c.task_id=x.task_id order by c.version desc limit 1
        ) c on true
      ) t),
      'summary',jsonb_build_object('tasks',v_total_tasks,'active',v_active_tasks,'completed',v_completed_tasks,
        'latest_task_at',(select max(updated_at) from cos.continuity_tasks)),
      'evidence',jsonb_build_object('checkpoints',v_checkpoints,'artifacts',v_artifacts,'tests',v_tests,
        'latest_checkpoint_at',(select max(created_at) from cos.continuity_checkpoints)),
      'checkpoint_weekly',(select coalesce(jsonb_agg(w order by w.week),'[]'::jsonb) from (
        select to_char(date_trunc('week', created_at),'YYYY-MM-DD') week,count(*) checkpoints
        from cos.continuity_checkpoints group by 1
      ) w)
    ),
    'metrics',jsonb_build_array(
      jsonb_build_object('key','task_completion','label','Task completion','domain','Delivery','available',v_total_tasks>0,'value',case when v_total_tasks>0 then round(v_completed_tasks::numeric/v_total_tasks,4) end,'numerator',v_completed_tasks,'denominator',v_total_tasks,'unit','ratio','target',0.8,'direction','higher','status',case when v_total_tasks=0 then 'unavailable' when v_total_tasks<5 then 'baseline' when v_completed_tasks::numeric/v_total_tasks>=0.8 then 'on_target' else 'needs_attention' end,'source','Work Continuity tasks','reason',case when v_total_tasks>0 and v_total_tasks<5 then 'Sample too small for a target (n='||v_total_tasks||')' end),
      jsonb_build_object('key','active_freshness','label','Active-task freshness','domain','Delivery','available',v_active_tasks>0,'value',case when v_active_tasks>0 then round(v_fresh_tasks::numeric/v_active_tasks,4) end,'numerator',v_fresh_tasks,'denominator',v_active_tasks,'unit','ratio','target',1.0,'direction','higher','status',case when v_active_tasks=0 then 'unavailable' when v_fresh_tasks=v_active_tasks then 'on_target' else 'needs_attention' end,'source','Latest checkpoint timestamps'),
      jsonb_build_object('key','blocker_rate','label','Active blocker rate','domain','Delivery','available',v_active_tasks>0,'value',case when v_active_tasks>0 then round(v_blocked_tasks::numeric/v_active_tasks,4) end,'numerator',v_blocked_tasks,'denominator',v_active_tasks,'unit','ratio','target',0.1,'direction','lower','status',case when v_active_tasks=0 then 'unavailable' when v_blocked_tasks::numeric/v_active_tasks<=0.1 then 'on_target' else 'needs_attention' end,'source','Checkpoint blockers'),
      jsonb_build_object('key','verified_outcomes','label','Verified-outcome rate','domain','Quality','available',v_outcome_records>0,'value',case when v_outcome_records>0 then round(v_verified::numeric/v_outcome_records,4) end,'numerator',v_verified,'denominator',v_outcome_records,'unit','ratio','target',0.9,'direction','higher','status',case when v_outcome_records=0 then 'unavailable' when v_outcome_records<5 then 'baseline' when v_verified::numeric/v_outcome_records>=0.9 then 'on_target' else 'needs_attention' end,'source','Explicit task outcomes','reason',case when v_outcome_records>0 and v_outcome_records<5 then 'Sample too small for a target (n='||v_outcome_records||')' end),
      jsonb_build_object('key','outcome_coverage','label','Outcome coverage','domain','Quality','available',v_total_tasks>0,'value',case when v_total_tasks>0 then round(v_outcome_tasks::numeric/v_total_tasks,4) end,'numerator',v_outcome_tasks,'denominator',v_total_tasks,'unit','ratio','target',0.9,'direction','higher','status',case when v_total_tasks=0 then 'unavailable' when v_total_tasks<5 then 'baseline' when v_outcome_tasks::numeric/v_total_tasks>=0.9 then 'on_target' else 'needs_attention' end,'source','Outcomes joined to tracked tasks','reason',case when v_total_tasks>0 and v_total_tasks<5 then 'Sample too small for a target (n='||v_total_tasks||')' end),
      jsonb_build_object('key','retry_rate','label','Retries per outcome','domain','Quality','available',v_outcome_records>0,'value',case when v_outcome_records>0 then round(v_retries::numeric/v_outcome_records,4) end,'numerator',v_retries,'denominator',v_outcome_records,'unit','ratio','target',0.2,'direction','lower','status',case when v_outcome_records=0 then 'unavailable' when v_outcome_records<5 then 'baseline' when v_retries::numeric/v_outcome_records<=0.2 then 'on_target' else 'needs_attention' end,'source','Explicit task outcomes','reason',case when v_outcome_records>0 and v_outcome_records<5 then 'Sample too small for a target (n='||v_outcome_records||')' end),
      jsonb_build_object('key','evidence_density','label','Evidence per checkpoint','domain','Quality','available',v_checkpoints>0,'value',case when v_checkpoints>0 then round((v_artifacts+v_tests)::numeric/v_checkpoints,4) end,'numerator',v_artifacts+v_tests,'denominator',v_checkpoints,'unit','number','target',2,'direction','higher','status',case when v_checkpoints=0 then 'unavailable' when (v_artifacts+v_tests)::numeric/v_checkpoints>=2 then 'on_target' else 'needs_attention' end,'source','Checkpoint artifacts and tests'),
      jsonb_build_object('key','claude_token_coverage','label','Claude token coverage','domain','Telemetry','available',v_claude_events>0,'value',case when v_claude_events>0 then round(v_claude_tokenized::numeric/v_claude_events,4) end,'numerator',v_claude_tokenized,'denominator',v_claude_events,'unit','ratio','target',0.95,'direction','higher','status',case when v_claude_events=0 then 'unavailable' when v_claude_tokenized::numeric/v_claude_events>=0.95 then 'on_target' else 'needs_attention' end,'source','Conversation-event telemetry'),
      jsonb_build_object('key','codex_token_coverage','label','Codex token coverage','domain','Telemetry','available',v_codex_events>0,'value',case when v_codex_events>0 then round(v_codex_tokenized::numeric/v_codex_events,4) end,'numerator',v_codex_tokenized,'denominator',v_codex_events,'unit','ratio','target',0.95,'direction','higher','status',case when v_codex_events=0 then 'unavailable' when v_codex_tokenized::numeric/v_codex_events>=0.95 then 'on_target' else 'needs_attention' end,'source','Conversation-event telemetry'),
      jsonb_build_object('key','cost_per_outcome','label','Cost per verified outcome','domain','Efficiency','available',v_verified>0 and v_total_cost>0,'value',case when v_verified>0 and v_total_cost>0 then round(v_total_cost/v_verified,2) end,'numerator',round(v_total_cost,2),'denominator',v_verified,'unit','usd','target',null,'direction','baseline','status',case when v_verified>0 and v_total_cost>0 then 'baseline' else 'unavailable' end,'source','Estimated API-equivalent cost over verified outcomes','reason',case when v_verified=0 or v_total_cost=0 then 'Needs verified outcomes and priced events' end),
      jsonb_build_object('key','runner_availability','label','Runner availability','domain','Reliability','available',false,'value',null,'target',null,'status','unavailable','reason','Heartbeat history and scheduled-minute denominator not implemented'),
      jsonb_build_object('key','approval_latency','label','Approval latency','domain','Reliability','available',v_decided_approvals>0,'value',case when v_decided_approvals>0 then round(v_approval_latency,1) end,'numerator',v_approval_latency,'denominator',v_decided_approvals,'unit','seconds','target',null,'direction','baseline','status',case when v_decided_approvals>0 then 'baseline' else 'unavailable' end,'source','Approval request and decision timestamps','reason',case when v_decided_approvals=0 then 'No decided approvals yet' end)
    ),
    'operations', jsonb_build_object(
      'work',(select coalesce(jsonb_agg(w order by w.updated_at desc),'[]'::jsonb) from (
        select work_id,title,description,project,requester,priority,state,created_at,updated_at from cos.work_items
      ) w),
      'approvals',(select coalesce(jsonb_agg(a order by a.requested_at),'[]'::jsonb) from (
        select ar.approval_id,ar.work_id,ar.plan_id,ar.gate_type,ar.payload_hash,ar.status,ar.requested_at,ar.decided_at,wi.title
        from cos.approval_requests ar left join cos.work_items wi on wi.work_id=ar.work_id where ar.status='pending'
      ) a),
      'events',(select coalesce(jsonb_agg(e order by e.created_at desc),'[]'::jsonb) from (
        select created_at,actor,event_type,prior_state,new_state,reason from cos.run_events order by created_at desc limit 40
      ) e),
      'runners',(select coalesce(jsonb_agg(r order by r.registered_at desc),'[]'::jsonb) from (
        select device_id,name,capabilities_json capabilities,status,last_heartbeat_at,registered_at from cos.runner_devices
      ) r)
    )
  );
end
$$;

revoke all on function cos.api_dashboard_state() from public, anon;
grant execute on function cos.api_dashboard_state() to authenticated;
