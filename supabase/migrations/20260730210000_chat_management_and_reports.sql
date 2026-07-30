-- Owner-gated conversation management and deterministic report generation.
-- Reports survive conversation deletion because reports.conversation_id uses
-- ON DELETE SET NULL. Active jobs must finish or fail before hard deletion.

create or replace function cos.api_chat_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'generated_at', now(),
    'conversations', (
      select coalesce(jsonb_agg(c order by c.updated_at desc), '[]'::jsonb)
      from (
        select v.conversation_id, v.title, v.scenario, v.message_count,
               v.archived, v.created_at, v.updated_at,
               (
                 select m.content
                 from cos.chat_messages m
                 where m.conversation_id = v.conversation_id
                   and m.role = 'user'
                 order by m.seq
                 limit 1
               ) as opening_question,
               (
                 select m.created_at
                 from cos.chat_messages m
                 where m.conversation_id = v.conversation_id
                 order by m.seq desc
                 limit 1
               ) as last_message_at
        from cos.chat_conversations v
        where not v.archived
        order by v.updated_at desc
        limit 100
      ) c
    ),
    'archived_conversations', (
      select coalesce(jsonb_agg(c order by c.updated_at desc), '[]'::jsonb)
      from (
        select v.conversation_id, v.title, v.scenario, v.message_count,
               v.archived, v.created_at, v.updated_at,
               (
                 select m.content
                 from cos.chat_messages m
                 where m.conversation_id = v.conversation_id
                   and m.role = 'user'
                 order by m.seq
                 limit 1
               ) as opening_question,
               (
                 select m.created_at
                 from cos.chat_messages m
                 where m.conversation_id = v.conversation_id
                 order by m.seq desc
                 limit 1
               ) as last_message_at
        from cos.chat_conversations v
        where v.archived
        order by v.updated_at desc
        limit 100
      ) c
    )
  );
end
$$;

create or replace function cos.api_chat_set_archived(
  p_conversation_id text,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  update cos.chat_conversations
     set archived = p_archived,
         updated_at = now()
   where conversation_id = p_conversation_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'conversation not found'; end if;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'archived', p_archived
  );
end
$$;

create or replace function cos.api_chat_delete(p_conversation_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  if exists (
    select 1
    from cos.chat_messages m
    where m.conversation_id = p_conversation_id
      and m.status in ('pending', 'streaming')
  ) then
    raise exception 'a running conversation cannot be deleted';
  end if;

  delete from cos.chat_conversations
   where conversation_id = p_conversation_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'conversation not found'; end if;

  return jsonb_build_object('deleted', p_conversation_id);
end
$$;

create or replace function cos.api_report_from_conversation(
  p_conversation_id text,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id text;
  v_conversation_title text;
  v_title text;
  v_summary text;
  v_sections jsonb;
  v_basis_rank integer;
  v_basis text;
  v_as_of text;
  v_created boolean := false;
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;

  select c.title
    into v_conversation_title
    from cos.chat_conversations c
   where c.conversation_id = p_conversation_id;

  if not found then raise exception 'conversation not found'; end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', 'conversation-' || m.seq::text,
          'title', coalesce(
            (
              select nullif(btrim(q.content), '')
              from cos.chat_messages q
              where q.conversation_id = m.conversation_id
                and q.role = 'user'
                and q.seq < m.seq
              order by q.seq desc
              limit 1
            ),
            'Conversation answer ' || m.seq::text
          ),
          'sources', coalesce(m.citations, '[]'::jsonb),
          'basis', m.basis,
          'as_of', to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD'),
          'figures', coalesce(m.figures, '[]'::jsonb),
          'rows', '[]'::jsonb,
          'note', m.content
        )
        order by m.seq
      ),
      '[]'::jsonb
    ),
    coalesce(
      max(
        case m.basis
          when 'illustrative' then 5
          when 'unvetted' then 4
          when 'estimate' then 3
          when 'derived' then 2
          else 1
        end
      ),
      1
    ),
    to_char(max(m.created_at) at time zone 'UTC', 'YYYY-MM-DD')
    into v_sections, v_basis_rank, v_as_of
    from cos.chat_messages m
   where m.conversation_id = p_conversation_id
     and m.role = 'assistant'
     and m.status = 'complete'
     and nullif(btrim(m.content), '') is not null;

  if jsonb_array_length(v_sections) = 0 then
    raise exception 'the conversation has no completed answers to report';
  end if;

  v_basis := case v_basis_rank
    when 5 then 'illustrative'
    when 4 then 'unvetted'
    when 3 then 'estimate'
    when 2 then 'derived'
    else 'measured'
  end;
  v_title := coalesce(nullif(btrim(p_title), ''), v_conversation_title);

  select left(regexp_replace(m.content, E'\\s+', ' ', 'g'), 320)
    into v_summary
    from cos.chat_messages m
   where m.conversation_id = p_conversation_id
     and m.role = 'assistant'
     and m.status = 'complete'
     and nullif(btrim(m.content), '') is not null
   order by m.seq desc
   limit 1;

  select r.report_id
    into v_report_id
    from cos.reports r
   where r.conversation_id = p_conversation_id
   order by r.updated_at desc
   limit 1;

  if v_report_id is null then
    v_report_id := 'report_' || replace(gen_random_uuid()::text, '-', '');
    insert into cos.reports
      (report_id, title, summary, conversation_id, sections, basis, as_of)
    values
      (v_report_id, v_title, v_summary, p_conversation_id, v_sections, v_basis, v_as_of);
    v_created := true;
  else
    update cos.reports
       set title = v_title,
           summary = v_summary,
           sections = v_sections,
           basis = v_basis,
           as_of = v_as_of,
           updated_at = now()
     where report_id = v_report_id;
  end if;

  return jsonb_build_object(
    'report_id', v_report_id,
    'conversation_id', p_conversation_id,
    'created', v_created,
    'section_count', jsonb_array_length(v_sections)
  );
end
$$;

revoke all on function cos.api_chat_state()
  from public, anon, authenticated;
revoke all on function cos.api_chat_set_archived(text, boolean)
  from public, anon, authenticated;
revoke all on function cos.api_chat_delete(text)
  from public, anon, authenticated;
revoke all on function cos.api_report_from_conversation(text, text)
  from public, anon, authenticated;

grant execute on function cos.api_chat_state() to authenticated;
grant execute on function cos.api_chat_set_archived(text, boolean)
  to authenticated;
grant execute on function cos.api_chat_delete(text) to authenticated;
grant execute on function cos.api_report_from_conversation(text, text)
  to authenticated;
