-- Skill telemetry is private operating data. The owner dashboard reads it only
-- through cos.api_quality_state(); no browser role gets direct table/view access.
alter table cos.skill_invocation_events enable row level security;
revoke all on table cos.skill_invocation_events
  from public,anon,authenticated;
revoke all on table cos.weekly_skill_effectiveness
  from public,anon,authenticated;

comment on table cos.skill_invocation_events is
  'Private append-only runner observations; exposed only through owner-gated aggregates.';
