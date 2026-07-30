-- Let the owner choose the model for each OmniSupply chat turn. The selected
-- provider is durable on the pending reply and the job packet so evaluation
-- results can be compared without inferring them from prose.

alter table cos.chat_messages
  add column if not exists provider text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_provider_check'
      and conrelid = 'cos.chat_messages'::regclass
  ) then
    alter table cos.chat_messages
      add constraint chat_messages_provider_check
      check (provider is null or provider in ('claude', 'codex'));
  end if;
end
$$;

drop function if exists cos.api_chat_send(text, text, text);

create or replace function cos.api_chat_send(
  p_conversation_id text,
  p_text text,
  p_title text default null,
  p_provider text default 'claude'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation text := p_conversation_id;
  v_provider text := lower(coalesce(btrim(p_provider), ''));
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
    (message_id, conversation_id, seq, role, content, job_id, status, provider)
  values
    (
      v_reply_msg, v_conversation, v_seq + 1, 'assistant', '', v_job,
      'pending', v_provider
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
      'provider', v_provider
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
    'seq', v_seq
  );
end
$$;

revoke all on function cos.api_chat_send(text, text, text, text)
  from public, anon;
grant execute on function cos.api_chat_send(text, text, text, text)
  to authenticated;
