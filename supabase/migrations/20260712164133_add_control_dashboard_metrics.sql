-- Supabase-backed operating metrics for the authenticated CS Ventures /dev console.
-- Private ledgers remain inaccessible through the Data API; one owner-gated RPC
-- returns aggregate/read-model data to the browser.

create schema if not exists cos;

create table if not exists cos.control_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into cos.control_owners (user_id)
select id from auth.users where lower(email) = 'cartershannon000@gmail.com'
on conflict (user_id) do nothing;

create table if not exists cos.continuity_tasks (
  task_id text primary key,
  project_root text not null,
  objective text not null,
  status text not null check (status in ('active','completed','blocked')),
  owner_agent text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  outcome text,
  acceptance text
);

create table if not exists cos.continuity_checkpoints (
  checkpoint_id text primary key,
  task_id text not null references cos.continuity_tasks(task_id) on delete cascade,
  version integer not null check (version > 0),
  agent text not null,
  created_at timestamptz not null,
  summary text not null,
  next_action text not null,
  branch text,
  git_head text,
  decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(decisions) = 'array'),
  blockers jsonb not null default '[]'::jsonb check (jsonb_typeof(blockers) = 'array'),
  artifacts jsonb not null default '[]'::jsonb check (jsonb_typeof(artifacts) = 'array'),
  tests jsonb not null default '[]'::jsonb check (jsonb_typeof(tests) = 'array'),
  unique (task_id, version)
);

create index if not exists continuity_tasks_status_updated_idx
  on cos.continuity_tasks (status, updated_at desc);
create index if not exists continuity_checkpoints_task_version_idx
  on cos.continuity_checkpoints (task_id, version desc);

alter table cos.control_owners enable row level security;
alter table cos.continuity_tasks enable row level security;
alter table cos.continuity_checkpoints enable row level security;

revoke all on table cos.control_owners from public, anon, authenticated;
revoke all on table cos.continuity_tasks from public, anon, authenticated;
revoke all on table cos.continuity_checkpoints from public, anon, authenticated;

create or replace function cos.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from cos.control_owners o where o.user_id = (select auth.uid())
  )
$$;

revoke all on function cos.is_owner() from public, anon, authenticated;

insert into cos.continuity_tasks
  (task_id, project_root, objective, status, owner_agent, created_at, updated_at, completed_at, outcome, acceptance)
select * from jsonb_to_recordset($tasks$[
  {"task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","project_root":"/Users/cartershannon/CS-Ventures/AI_Info","objective":"Pilot cross-agent continuity and deck research on a real deck","status":"active","owner_agent":"codex","created_at":"2026-07-10T22:41:31.723202+00:00","updated_at":"2026-07-11T16:10:57.060873+00:00","completed_at":null,"outcome":null,"acceptance":null},
  {"task_id":"create-a-shared-agent-architect-that-a5d2909b","project_root":"/Users/cartershannon/CS-Ventures/AI_Info","objective":"Create a shared Agent Architect that designs context-efficient Claude multi-agent systems","status":"active","owner_agent":"codex","created_at":"2026-07-11T18:38:18.567214+00:00","updated_at":"2026-07-11T18:38:18.567214+00:00","completed_at":null,"outcome":null,"acceptance":null},
  {"task_id":"design-the-cs-ventures-website-to-da-8c8d220e","project_root":"/Users/cartershannon/CS-Ventures/AI_Info","objective":"Build a CS Ventures control-plane dashboard that tracks durable work, agent operations, model usage, token coverage, delivery quality, and system readiness without inventing telemetry.","status":"active","owner_agent":"codex","created_at":"2026-07-11T18:50:18.698997+00:00","updated_at":"2026-07-12T16:19:50.420123+00:00","completed_at":null,"outcome":null,"acceptance":null}
]$tasks$::jsonb) as x(
  task_id text, project_root text, objective text, status text, owner_agent text,
  created_at timestamptz, updated_at timestamptz, completed_at timestamptz, outcome text, acceptance text
)
on conflict (task_id) do update set
  objective = excluded.objective,
  status = excluded.status,
  owner_agent = excluded.owner_agent,
  updated_at = excluded.updated_at,
  completed_at = excluded.completed_at,
  outcome = excluded.outcome,
  acceptance = excluded.acceptance;

insert into cos.continuity_checkpoints
  (checkpoint_id, task_id, version, agent, created_at, summary, next_action, artifacts, tests)
select checkpoint_id, task_id, version, agent, created_at, summary, next_action, artifacts, tests
from jsonb_to_recordset($checkpoints$[
  {"checkpoint_id":"cp_dbe6292d4b164f3cacd61914fa74d098","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":1,"agent":"codex","created_at":"2026-07-10T22:41:31.723202+00:00","summary":"Built and installed shared Work Continuity and Deck Research skills for Claude and Codex; configured and authenticated the project-scoped Supabase MCP server in Codex; installed Supabase agent skills.","next_action":"Choose the first real deck topic and run deck-research to create its evidence package.","artifacts":["skills/work-continuity","skills/deck-research"],"tests":["8 unit and integration tests passed","Both skill validators passed"]},
  {"checkpoint_id":"cp_63ccbecf6d5a40f78afada28aff962a4","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":2,"agent":"codex","created_at":"2026-07-11T00:06:57.667469+00:00","summary":"Built Agent Atlas, a reusable interactive catalog that visualizes agent purpose, workflow, architecture, capabilities, safety boundaries, commands, live task state, and tested evidence. Seeded it with Cross-Agent Work Continuity and added on-demand live ledger refresh.","next_action":"Review the Work Continuity visualization, then add Deck Research as the second Agent Atlas entry.","artifacts":["agent-visualizer/index.html","agent-visualizer/catalog/work-continuity.json","agent-visualizer/scripts/build_catalog.py","agent-visualizer/serve.py"],"tests":["Agent Atlas returned HTTP 200 on port 8097","Live catalog rebuilt with current task and checkpoint metrics","Desktop and full-height browser renders visually inspected"]},
  {"checkpoint_id":"cp_b98692c624074e01a5d54907a09cea27","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":3,"agent":"codex","created_at":"2026-07-11T00:33:59.480171+00:00","summary":"Added Decision-Ready Deck Research as the second Agent Atlas entry; generalized the UI so agent-specific copy and validation evidence come from descriptors; added fail-fast descriptor validation; connected privacy-minimized live research package metrics; strengthened the Deck Research ready-handoff validator and documented both contracts.","next_action":"Add AI Work Audit as the third Agent Atlas entry with privacy-safe live workflow metrics.","artifacts":["agent-visualizer/catalog/deck-research.json","agent-visualizer/app.js","agent-visualizer/scripts/build_catalog.py","agent-visualizer/README.md","skills/deck-research/SKILL.md","skills/deck-research/scripts/validate_research.py","tests/test_agent_visualizer.py","tests/test_deck_research.py"],"tests":["python3 -m unittest discover -s tests -v: 11 tests passed","python3 agent-visualizer/scripts/build_catalog.py: 2 agents built","node --check agent-visualizer/app.js: passed","Agent Atlas HTTP check: 200","1440x1800 Chrome headless render: visually inspected"]},
  {"checkpoint_id":"cp_fbb1b220132a4ebc99a46446b5d01ebc","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":4,"agent":"codex","created_at":"2026-07-11T00:37:37.386187+00:00","summary":"Expanded Agent Atlas to three operational entries: Work Continuity, Deck Research, and Human-Gated AI Work Audit. Added privacy-safe live audit metrics from 1,676 events, strict nested descriptor validation and safe repository-relative source paths, generic live summary rendering, live collector fault isolation, and time-based research package recency.","next_action":"Design and implement deterministic task-outcome instrumentation in AI Work Audit without treating session or token volume as productivity.","artifacts":["agent-visualizer/catalog/audit-ai-work.json","agent-visualizer/catalog/deck-research.json","agent-visualizer/app.js","agent-visualizer/scripts/build_catalog.py","agent-visualizer/README.md","skills/deck-research/scripts/validate_research.py","tests/test_agent_visualizer.py","tests/test_deck_research.py"],"tests":["python3 -m unittest discover -s tests -v: 12 tests passed","python3 agent-visualizer/scripts/build_catalog.py: 3 agents built","node --check agent-visualizer/app.js: passed","Agent Atlas HTTP check: 200","AI Work Audit and Deck Research Chrome renders: visually inspected at 1440x1800"]},
  {"checkpoint_id":"cp_efa3e0f5d3f349f5afb87e036d52fe7d","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":5,"agent":"codex","created_at":"2026-07-11T00:40:56.553580+00:00","summary":"Implemented deterministic task-outcome instrumentation in AI Work Audit schema v3. Added append-only explicit outcome records, CLI recording, verification/retry/recovery/artifact metrics, audit-context integration, dashboard KPIs, Postgres reference schema parity, Agent Atlas exposure, and the first verified real task progression record.","next_action":"Add an optional explicit Work Continuity completion bridge that records a verified AI Work Audit outcome without inferring success from conversation activity.","artifacts":["skills/audit-ai-work/scripts/audit_ai_work.py","skills/audit-ai-work/SKILL.md","skills/audit-ai-work/references/data-model.md","skills/audit-ai-work/references/postgres-schema.sql","tests/test_audit_ai_work.py","agent-visualizer/catalog/audit-ai-work.json","agent-visualizer/scripts/build_catalog.py","dashboard/index.html"],"tests":["python3 -m unittest discover -s tests -v: 13 tests passed","AI Work Audit production status: schema v3, 1 outcome record, 1 task, 1 verified state","python3 agent-visualizer/scripts/build_catalog.py: 3 agents built","node --check agent-visualizer/app.js: passed"]},
  {"checkpoint_id":"cp_6f44a2696016458ca7c745e1eaa50f37","task_id":"pilot-cross-agent-continuity-and-dec-71cdd551","version":6,"agent":"codex","created_at":"2026-07-11T16:10:57.060873+00:00","summary":"Replaced the flat Agent Atlas workflow row with a Remit-style interactive system graphic for every catalog agent. Added clickable component nodes, color-coded input/action/learning connectors, an animated feedback loop, contextual detail panel, descriptor-driven content, and a stacked mobile fallback.","next_action":"Allow each agent descriptor to customize system-map topology and connector semantics when its workflow differs from the default six-node feedback loop.","artifacts":["agent-visualizer/app.js","agent-visualizer/styles.css","agent-visualizer/map.css","agent-visualizer/index.html","agent-visualizer/README.md"],"tests":["python3 -m unittest discover -s tests -v: 14 tests passed","node --check agent-visualizer/app.js: passed","Agent Atlas HTTP check: 200","Desktop 1440x1500 Remit-style map render: visually inspected"]},
  {"checkpoint_id":"cp_76c1b56a809d48d2a3695fd2c3b26c6a","task_id":"create-a-shared-agent-architect-that-a5d2909b","version":1,"agent":"codex","created_at":"2026-07-11T18:38:18.567214+00:00","summary":"Created and installed the agent-architect skill for Claude and Codex. It scaffolds Opus 4.8-led systems with pointer-only orchestrator context, token-budgeted Sonnet/Haiku workers, read-only reviewers, bounded surgical revisers, explicit human gates, deterministic validation, reusable packet templates, automated tests, and an Agent Atlas entry. An independent city-photo workflow forward test exposed and fixed manual initialization friction.","next_action":"Use Agent Architect to generate a v2 harness for chs.product-team-loop and compare context, routing, review, and revision contracts before changing the existing skill.","artifacts":["skills/agent-architect/SKILL.md","skills/agent-architect/scripts/init_agent_system.py","skills/agent-architect/scripts/validate_agent_system.py","skills/agent-architect/references/context-contract.md","skills/agent-architect/references/model-routing.md","skills/agent-architect/references/evaluation-contract.md","skills/agent-architect/assets/agent-system.json","tests/test_agent_architect.py","agent-visualizer/catalog/agent-architect.json"],"tests":["python3 -m unittest discover -s tests -v: 17 tests passed","skill-creator quick_validate: passed","independent city-photo harness forward test: validation passed with 4 roles","Agent Atlas catalog build: 4 agents"]},
  {"checkpoint_id":"cp_546f7b4acd92471587f6bb46db61e7b8","task_id":"design-the-cs-ventures-website-to-da-8c8d220e","version":1,"agent":"codex","created_at":"2026-07-11T18:50:18.698997+00:00","summary":"Reviewed Carter’s whiteboard and produced a full CS Ventures Control Plane architecture. Defined the website as the human approval surface, the database as a durable typed coordination ledger, and a local CoS runner with an Opus 4.8 orchestrator plus bounded Claude/Codex workers. Built an interactive responsive visual with trust boundaries, clickable contracts, model routing, approval/evidence flows, and an eight-stage run simulation.","next_action":"Select the MVP pilot repository and define the typed repo_audit job input and evidence-output schemas.","artifacts":["cos-control-plane/PLAN.md","cos-control-plane/index.html","cos-control-plane/styles.css","cos-control-plane/mobile.css","cos-control-plane/app.js","tests/test_agent_visualizer.py"],"tests":["python3 -m unittest discover -s tests -v: 17 tests passed","node --check cos-control-plane/app.js: passed","Control-plane visual HTTP check: 200","Desktop 1440x1700 and mobile 390px renders: visually inspected"]},
  {"checkpoint_id":"cp_9914ba7951ed45e082a7153ce86971c5","task_id":"design-the-cs-ventures-website-to-da-8c8d220e","version":2,"agent":"codex","created_at":"2026-07-11T18:57:05.271909+00:00","summary":"Reworked the control-plane visual to match Carter’s whiteboard topology: CS Ventures website on the upper right, control-plane database on the left as the explicit go-between, and the local computer below as the execution plane. Added labeled bidirectional website/database and database/local flows, a visible no-direct-command boundary, and nested the Opus/Sonnet/Haiku/reviewer agent team under the local runner.","next_action":"Select the MVP pilot repository and define the typed repo_audit job input and evidence-output schemas.","artifacts":["cos-control-plane/index.html","cos-control-plane/triangle.css","cos-control-plane/mobile.css"],"tests":["python3 -m unittest discover -s tests -q: 17 tests passed","node --check cos-control-plane/app.js: passed","Control-plane visual HTTP check: 200","Revised 1440x1800 topology render: visually inspected"]},
  {"checkpoint_id":"cp_c9ee8e1763c74311997997f3350076d3","task_id":"design-the-cs-ventures-website-to-da-8c8d220e","version":3,"agent":"codex","created_at":"2026-07-12T14:10:01.223287+00:00","summary":"Rebuilt the CS Ventures Control Plane as a modern multi-tab operating dashboard with a dark-green CS Ventures header. Added Overview, Work Queue, Agents, Usage, Approvals, and System tabs; real local Claude/Codex activity, session and token-coverage metrics; continuity work items; outcome and recommendation counts; readiness tracking; deep links; and a privacy-safe live data collector/server. Codex tokens are correctly marked unavailable rather than zero.","next_action":"Define the typed control-plane work_item, approval, job, lease, event, and artifact schemas and wire the Work Queue and Approvals tabs to them.","artifacts":["cos-control-plane/index.html","cos-control-plane/dashboard.css","cos-control-plane/app.js","cos-control-plane/serve.py","cos-control-plane/scripts/build_dashboard_data.py","cos-control-plane/data/dashboard.json","cos-control-plane/PLAN.md","tests/test_cos_dashboard.py"],"tests":["python3 -m unittest discover -s tests -v: 18 tests passed","node --check cos-control-plane/app.js: passed","python3 -m py_compile dashboard scripts: passed","Live dashboard data assertions: Claude 706880 captured tokens; Codex token telemetry unavailable","Desktop Overview/Usage and mobile Overview renders: visually inspected"]},
  {"checkpoint_id":"cp_4637970124a0475891ce9357133e25a8","task_id":"design-the-cs-ventures-website-to-da-8c8d220e","version":4,"agent":"codex","created_at":"2026-07-12T15:05:32.905075+00:00","summary":"Implemented a dedicated Metrics tab backed by deterministic audit and continuity aggregates; added 12 metric definitions with measured, partial, and unavailable coverage states; expanded Usage with provider/model token tables and project activity; documented provisional targets and instrumentation backlog; added responsive styling and regression assertions.","next_action":"Implement Codex Stop-hook token capture and attach task_id, run_id, role, and model_call_id to each model-call event so token and outcome efficiency can be measured per work item.","artifacts":["cos-control-plane/METRICS_PLAN.md","cos-control-plane/index.html","cos-control-plane/metrics.css","cos-control-plane/dashboard.css","cos-control-plane/app.js","cos-control-plane/scripts/build_dashboard_data.py","cos-control-plane/data/dashboard.json","cos-control-plane/PLAN.md","tests/test_cos_dashboard.py"],"tests":["python3 -m unittest discover -s tests -v: 18 tests passed","node --check cos-control-plane/app.js: passed","python3 -m py_compile cos-control-plane/scripts/build_dashboard_data.py cos-control-plane/serve.py: passed","live dashboard JSON contract: 12 metrics and 11 model rows"]}
]$checkpoints$::jsonb) as x(
  checkpoint_id text, task_id text, version integer, agent text, created_at timestamptz,
  summary text, next_action text, artifacts jsonb, tests jsonb
)
on conflict (checkpoint_id) do nothing;

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
         count(*) filter (where provider='claude' and (coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0)),
         count(*) filter (where provider='codex'),
         count(*) filter (where provider='codex' and (coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0))
  into v_claude_events, v_claude_tokenized, v_codex_events, v_codex_tokenized
  from audit.conversation_events;

  select count(*) into v_pending_recommendations from audit.recommendations where status='proposed';
  select count(*) filter (where status='pending'), count(*) filter (where decided_at is not null),
         avg(extract(epoch from (decided_at-requested_at))) filter (where decided_at is not null)
  into v_pending_approvals, v_decided_approvals, v_approval_latency from cos.approval_requests;

  return jsonb_build_object(
    'generated_at', now(),
    'data_contract_version', 2,
    'overview', jsonb_build_object(
      'active_work',v_active_tasks,
      'pending_review',v_pending_recommendations,
      'pending_approvals',v_pending_approvals,
      'events',(select count(*) from audit.conversation_events),
      'captured_tokens',(select coalesce(sum(tokens_in),0)+coalesce(sum(tokens_out),0) from audit.conversation_events where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0),
      'outcome_tasks',v_outcome_tasks,
      'verified_outcomes',v_verified
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
        select provider,count(*) events,count(distinct nullif(session_id,'')) sessions,
          count(*) filter(where response_available=1) completed,
          coalesce(sum(tokens_in),0) tokens_in,coalesce(sum(tokens_out),0) tokens_out,
          coalesce(sum(tokens_in),0)+coalesce(sum(tokens_out),0) tokens_total,
          count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0) tokenized_events,
          (count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0) > 0) tokens_available,
          round(count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0)::numeric/nullif(count(*),0),4) token_coverage
        from audit.conversation_events group by provider
      ) p),
      'weekly',(select coalesce(jsonb_agg(w order by w.week_start,w.provider),'[]'::jsonb) from (
        select week_start,provider,count(*) events,
          coalesce(sum(tokens_in),0)+coalesce(sum(tokens_out),0) tokens
        from audit.conversation_events group by week_start,provider
      ) w),
      'models',(select coalesce(jsonb_agg(m order by m.provider,m.events desc),'[]'::jsonb) from (
        select provider,coalesce(nullif(model,''),'unknown') model,count(*) events,
          count(distinct nullif(session_id,'')) sessions,
          coalesce(sum(tokens_in),0) tokens_in,coalesce(sum(tokens_out),0) tokens_out,
          coalesce(sum(tokens_in),0)+coalesce(sum(tokens_out),0) tokens_total,
          count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0) tokenized_events,
          (count(*) filter(where coalesce(tokens_in,0)>0 or coalesce(tokens_out,0)>0) > 0) tokens_available
        from audit.conversation_events group by provider,coalesce(nullif(model,''),'unknown')
      ) m),
      'projects',(select coalesce(jsonb_agg(p order by p.events desc),'[]'::jsonb) from (
        select coalesce(nullif(project_normalized,''),'Unassigned') project,count(*) events,
          count(distinct nullif(session_id,'')) sessions,
          coalesce(sum(tokens_in),0)+coalesce(sum(tokens_out),0) tokens
        from audit.conversation_events group by coalesce(nullif(project_normalized,''),'Unassigned')
        order by count(*) desc limit 10
      ) p),
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
        select to_char(created_at,'IYYY-IW') week,count(*) checkpoints from cos.continuity_checkpoints group by 1
      ) w)
    ),
    'metrics',jsonb_build_array(
      jsonb_build_object('key','task_completion','label','Task completion','domain','Delivery','available',v_total_tasks>0,'value',case when v_total_tasks>0 then round(v_completed_tasks::numeric/v_total_tasks,4) end,'numerator',v_completed_tasks,'denominator',v_total_tasks,'unit','ratio','target',0.8,'direction','higher','status',case when v_total_tasks=0 then 'unavailable' when v_completed_tasks::numeric/v_total_tasks>=0.8 then 'on_target' else 'needs_attention' end,'source','Work Continuity tasks'),
      jsonb_build_object('key','active_freshness','label','Active-task freshness','domain','Delivery','available',v_active_tasks>0,'value',case when v_active_tasks>0 then round(v_fresh_tasks::numeric/v_active_tasks,4) end,'numerator',v_fresh_tasks,'denominator',v_active_tasks,'unit','ratio','target',1.0,'direction','higher','status',case when v_active_tasks=0 then 'unavailable' when v_fresh_tasks=v_active_tasks then 'on_target' else 'needs_attention' end,'source','Latest checkpoint timestamps'),
      jsonb_build_object('key','blocker_rate','label','Active blocker rate','domain','Delivery','available',v_active_tasks>0,'value',case when v_active_tasks>0 then round(v_blocked_tasks::numeric/v_active_tasks,4) end,'numerator',v_blocked_tasks,'denominator',v_active_tasks,'unit','ratio','target',0.1,'direction','lower','status',case when v_active_tasks=0 then 'unavailable' when v_blocked_tasks::numeric/v_active_tasks<=0.1 then 'on_target' else 'needs_attention' end,'source','Checkpoint blockers'),
      jsonb_build_object('key','verified_outcomes','label','Verified-outcome rate','domain','Quality','available',v_outcome_records>0,'value',case when v_outcome_records>0 then round(v_verified::numeric/v_outcome_records,4) end,'numerator',v_verified,'denominator',v_outcome_records,'unit','ratio','target',0.9,'direction','higher','status',case when v_outcome_records=0 then 'unavailable' when v_verified::numeric/v_outcome_records>=0.9 then 'on_target' else 'needs_attention' end,'source','Explicit task outcomes'),
      jsonb_build_object('key','outcome_coverage','label','Outcome coverage','domain','Quality','available',v_total_tasks>0,'value',case when v_total_tasks>0 then round(v_outcome_tasks::numeric/v_total_tasks,4) end,'numerator',v_outcome_tasks,'denominator',v_total_tasks,'unit','ratio','target',0.9,'direction','higher','status',case when v_total_tasks=0 then 'unavailable' when v_outcome_tasks::numeric/v_total_tasks>=0.9 then 'on_target' else 'needs_attention' end,'source','Outcomes joined to tracked tasks'),
      jsonb_build_object('key','retry_rate','label','Retries per outcome','domain','Quality','available',v_outcome_records>0,'value',case when v_outcome_records>0 then round(v_retries::numeric/v_outcome_records,4) end,'numerator',v_retries,'denominator',v_outcome_records,'unit','ratio','target',0.2,'direction','lower','status',case when v_outcome_records=0 then 'unavailable' when v_retries::numeric/v_outcome_records<=0.2 then 'on_target' else 'needs_attention' end,'source','Explicit task outcomes'),
      jsonb_build_object('key','evidence_density','label','Evidence per checkpoint','domain','Quality','available',v_checkpoints>0,'value',case when v_checkpoints>0 then round((v_artifacts+v_tests)::numeric/v_checkpoints,4) end,'numerator',v_artifacts+v_tests,'denominator',v_checkpoints,'unit','number','target',2,'direction','higher','status',case when v_checkpoints=0 then 'unavailable' when (v_artifacts+v_tests)::numeric/v_checkpoints>=2 then 'on_target' else 'needs_attention' end,'source','Checkpoint artifacts and tests'),
      jsonb_build_object('key','claude_token_coverage','label','Claude token coverage','domain','Telemetry','available',v_claude_events>0,'value',case when v_claude_events>0 then round(v_claude_tokenized::numeric/v_claude_events,4) end,'numerator',v_claude_tokenized,'denominator',v_claude_events,'unit','ratio','target',0.95,'direction','higher','status',case when v_claude_events=0 then 'unavailable' when v_claude_tokenized::numeric/v_claude_events>=0.95 then 'on_target' else 'needs_attention' end,'source','Conversation-event telemetry'),
      jsonb_build_object('key','codex_token_coverage','label','Codex token coverage','domain','Telemetry','available',v_codex_events>0,'value',case when v_codex_events>0 then round(v_codex_tokenized::numeric/v_codex_events,4) end,'numerator',v_codex_tokenized,'denominator',v_codex_events,'unit','ratio','target',0.95,'direction','higher','status',case when v_codex_events=0 then 'unavailable' when v_codex_tokenized::numeric/v_codex_events>=0.95 then 'on_target' else 'needs_attention' end,'source','Conversation-event telemetry'),
      jsonb_build_object('key','cost_per_outcome','label','Cost per verified outcome','domain','Efficiency','available',false,'value',null,'target',null,'status','unavailable','reason','Call-level cost ledger not implemented'),
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

-- Existing SECURITY DEFINER RPCs are owner-gated, but PostgreSQL grants EXECUTE
-- to PUBLIC by default. Make the intended API surface explicit.
revoke all on function cos.api_audit_state() from public, anon;
revoke all on function cos.api_state() from public, anon;
revoke all on function cos.api_decide_approval(text,boolean,text) from public, anon;
revoke all on function cos.api_release(text,text) from public, anon;
grant execute on function cos.api_audit_state() to authenticated;
grant execute on function cos.api_state() to authenticated;
grant execute on function cos.api_decide_approval(text,boolean,text) to authenticated;
grant execute on function cos.api_release(text,text) to authenticated;
