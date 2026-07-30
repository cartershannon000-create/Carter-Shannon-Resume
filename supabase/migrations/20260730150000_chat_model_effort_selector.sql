-- Persist and enforce the exact model and effort chosen for each chat turn.
-- The four-argument RPC remains as a compatibility wrapper during rollout.

alter table cos.chat_messages
  add column if not exists model text,
  add column if not exists effort text;

alter table cos.chat_messages
  drop constraint if exists chat_messages_model_check,
  drop constraint if exists chat_messages_effort_check,
  drop constraint if exists chat_messages_provider_model_check;

alter table cos.chat_messages
  add constraint chat_messages_model_check
    check (
      model is null or model in (
        'claude-opus-5',
        'claude-sonnet-5',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna'
      )
    ),
  add constraint chat_messages_effort_check
    check (
      effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max')
    ),
  add constraint chat_messages_provider_model_check
    check (
      model is null
      or provider is null
      or (provider = 'claude' and model in ('claude-opus-5', 'claude-sonnet-5'))
      or (
        provider = 'codex'
        and model in ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna')
      )
    );

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
            'status', m.status,
            'error', m.error,
            'provider', m.provider,
            'model', m.model,
            'effort', m.effort,
            'created_at', m.created_at
          ) order by m.seq
        ),
        '[]'::jsonb
      )
      from cos.chat_messages m
      where m.conversation_id = p_conversation_id
    )
  );
end
$$;

create or replace function cos.api_chat_send(
  p_conversation_id text,
  p_text text,
  p_title text,
  p_provider text,
  p_model text,
  p_effort text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation text := p_conversation_id;
  v_provider text := lower(coalesce(btrim(p_provider), ''));
  v_model text := lower(coalesce(btrim(p_model), ''));
  v_effort text := lower(coalesce(btrim(p_effort), ''));
  v_seq integer;
  v_user_msg text;
  v_reply_msg text;
  v_work text;
  v_job text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_text), '') = '' then
    raise exception 'a chat turn needs a question';
  end if;
  if v_provider not in ('claude', 'codex') then
    raise exception 'chat provider must be claude or codex';
  end if;
  if (
    v_provider = 'claude'
    and v_model not in ('claude-opus-5', 'claude-sonnet-5')
  ) or (
    v_provider = 'codex'
    and v_model not in ('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna')
  ) then
    raise exception 'chat model % is not valid for provider %', v_model, v_provider;
  end if;
  if v_effort not in ('low', 'medium', 'high', 'xhigh', 'max') then
    raise exception 'chat effort must be low, medium, high, xhigh, or max';
  end if;

  if v_conversation is null then
    v_conversation := 'conv_' || v_suffix;
    insert into cos.chat_conversations (conversation_id, title)
    values (
      v_conversation,
      coalesce(nullif(btrim(p_title), ''), left(btrim(p_text), 80))
    );
  end if;

  select coalesce(max(m.seq), 0) + 1 into v_seq
  from cos.chat_messages m
  where m.conversation_id = v_conversation;

  v_user_msg := 'msg_' || v_suffix || '_q';
  v_reply_msg := 'msg_' || v_suffix || '_a';
  v_work := 'work_chat_' || v_suffix;
  v_job := 'job_chat_' || v_suffix;

  insert into cos.chat_messages
    (message_id, conversation_id, seq, role, content)
  values
    (v_user_msg, v_conversation, v_seq, 'user', btrim(p_text));

  insert into cos.chat_messages
    (message_id, conversation_id, seq, role, content, job_id, status,
     provider, model, effort)
  values
    (
      v_reply_msg, v_conversation, v_seq + 1, 'assistant', '', v_job,
      'pending', v_provider, v_model, v_effort
    );

  insert into cos.work_items
    (work_id, title, description, project, state)
  values
    (v_work, left(btrim(p_text), 120), btrim(p_text), 'omnisupply', 'QUEUED');

  insert into cos.job_queue
    (job_id, work_id, job_type, params_json, required_capability,
     idempotency_key, state, quality_required)
  values (
    v_job,
    v_work,
    'omnisupply_chat',
    jsonb_build_object(
      'conversation_id', v_conversation,
      'question', btrim(p_text),
      'user_message_id', v_user_msg,
      'reply_message_id', v_reply_msg,
      'provider', v_provider,
      'model', v_model,
      'effort', v_effort
    ),
    'sckg',
    v_reply_msg,
    'QUEUED',
    false
  );

  update cos.chat_conversations
  set message_count = message_count + 2,
      updated_at = now()
  where conversation_id = v_conversation;

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'job_id', v_job,
    'user_message_id', v_user_msg,
    'reply_message_id', v_reply_msg,
    'provider', v_provider,
    'model', v_model,
    'effort', v_effort,
    'seq', v_seq
  );
end
$$;

create or replace function cos.api_chat_send(
  p_conversation_id text,
  p_text text,
  p_title text default null,
  p_provider text default 'claude'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cos.api_chat_send(
    p_conversation_id,
    p_text,
    p_title,
    p_provider,
    case
      when lower(coalesce(btrim(p_provider), '')) = 'codex'
        then 'gpt-5.6-sol'
      else 'claude-opus-5'
    end,
    'high'
  )
$$;

revoke all on function cos.api_chat_send(text, text, text, text, text, text)
  from public, anon;
grant execute on function cos.api_chat_send(text, text, text, text, text, text)
  to authenticated;

revoke all on function cos.api_chat_send(text, text, text, text)
  from public, anon;
grant execute on function cos.api_chat_send(text, text, text, text)
  to authenticated;

revoke all on function cos.api_chat_messages(text) from public, anon;
grant execute on function cos.api_chat_messages(text) to authenticated;

notify pgrst, 'reload schema';
