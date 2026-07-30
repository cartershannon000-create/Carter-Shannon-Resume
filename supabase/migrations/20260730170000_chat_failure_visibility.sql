-- Make chat progress and failures observable by the exact job that owns a turn.
-- The runner normally closes the reply itself; the API projection is a defensive
-- fallback so a terminal job can never leave the browser spinning forever.

update cos.chat_messages m
   set status = 'failed',
       error = coalesce(
         nullif(m.error, ''),
         concat(
           coalesce(q.failure_kind, 'execution_failed'),
           ': ',
           coalesce(q.failure_detail, 'The analysis stopped before an answer was recorded.'),
           ' (job ', q.job_id, ')'
         )
       ),
       content = coalesce(
         nullif(m.content, ''),
         'This question could not be answered.'
       )
  from cos.job_queue q
 where q.job_id = m.job_id
   and q.job_type = 'omnisupply_chat'
   and q.state = 'FAILED'
   and m.status in ('pending', 'streaming');

create or replace function cos.api_chat_messages(p_conversation_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'conversation', (
      select to_jsonb(v)
      from cos.chat_conversations v
      where v.conversation_id = p_conversation_id
    ),
    'messages', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'message_id', m.message_id,
            'seq', m.seq,
            'role', m.role,
            'content', m.content,
            'figures', m.figures,
            'citations', m.citations,
            'basis', m.basis,
            'job_id', m.job_id,
            'status', case
              when m.status in ('pending', 'streaming') and q.state = 'FAILED'
                then 'failed'
              else m.status
            end,
            'error', coalesce(
              nullif(m.error, ''),
              case when q.state = 'FAILED' then
                concat(
                  coalesce(q.failure_kind, 'execution_failed'),
                  ': ',
                  coalesce(
                    q.failure_detail,
                    'The analysis stopped before an answer was recorded.'
                  ),
                  ' (job ', q.job_id, ')'
                )
              end
            ),
            'provider', m.provider,
            'model', m.model,
            'effort', m.effort,
            'job_state', q.state,
            'failure_kind', q.failure_kind,
            'failure_detail', q.failure_detail,
            'created_at', m.created_at
          ) order by m.seq
        ),
        '[]'::jsonb
      )
      from cos.chat_messages m
      left join cos.job_queue q on q.job_id = m.job_id
      where m.conversation_id = p_conversation_id
    )
  );
end
$$;

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
      'steps', '[]'::jsonb
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
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function cos.api_chat_messages(text) from public, anon;
grant execute on function cos.api_chat_messages(text) to authenticated;
revoke all on function cos.api_chat_job_progress(text, integer)
  from public, anon;
grant execute on function cos.api_chat_job_progress(text, integer)
  to authenticated;
