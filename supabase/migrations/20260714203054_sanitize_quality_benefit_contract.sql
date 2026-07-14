-- Keep execution mechanics out of the promised-benefit statement. New
-- quality-gated direct requests are staged on a review branch by the runner;
-- provider and delivery routing remain plan metadata, not a user benefit.
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
          nullif(trim(split_part(split_part(
            p_plan->'job'->'params'->>'task',E'\n\nSource:',1),
            'Direct mode:',1)),''),
          'The approved outcome is active in the real user or runtime path, not only scaffolded.'),1000))),
    'minimum_review_score',17,
    'require_independent_review',true,
    'require_activation_evidence',true,
    'require_mechanical_checks',true)
$$;

revoke all on function cos.derive_acceptance_contract(jsonb)
  from public,anon,authenticated;
