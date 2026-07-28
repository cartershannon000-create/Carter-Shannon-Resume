-- Owner-gated browser contract for OmniSupply operational state.

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
               v.created_at, v.updated_at,
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
    )
  );
end
$$;

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
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation text := p_conversation_id;
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
    (message_id, conversation_id, seq, role, content, job_id, status)
  values
    (v_reply_msg, v_conversation, v_seq + 1, 'assistant', '', v_job, 'pending');

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
      'reply_message_id', v_reply_msg
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
    'seq', v_seq
  );
end
$$;

create or replace function cos.api_chat_archive(p_conversation_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  update cos.chat_conversations
  set archived = true,
      updated_at = now()
  where conversation_id = p_conversation_id;
  return jsonb_build_object('archived', p_conversation_id);
end
$$;

create or replace function cos.api_reports_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'reports', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'report_id', r.report_id,
            'title', r.title,
            'summary', r.summary,
            'conversation_id', r.conversation_id,
            'snapshot_id', r.snapshot_id,
            'sections', r.sections,
            'basis', r.basis,
            'as_of', r.as_of,
            'pinned', r.pinned,
            'created_at', r.created_at
          ) order by r.pinned desc, r.created_at desc
        ),
        '[]'::jsonb
      )
      from cos.reports r
    )
  );
end
$$;

create or replace function cos.api_fleet_state(p_trail_minutes integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz :=
    now() - make_interval(mins => greatest(p_trail_minutes, 5));
begin
  if not cos.is_owner() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'aircraft', (
      select coalesce(jsonb_agg(a order by a.tail), '[]'::jsonb)
      from (
        select f.icao24, f.tail, f.model, f.operator, f.source,
               p.seen_at, p.callsign, p.lat, p.lon, p.altitude_m,
               p.velocity_ms, p.heading_deg, p.on_ground
        from cos.fleet_aircraft f
        left join lateral (
          select *
          from cos.fleet_positions q
          where q.icao24 = f.icao24
          order by q.seen_at desc
          limit 1
        ) p on true
        where f.active
      ) a
    ),
    'trails', (
      select coalesce(jsonb_object_agg(t.icao24, t.points), '{}'::jsonb)
      from (
        select q.icao24,
               jsonb_agg(
                 jsonb_build_object(
                   'lat', q.lat,
                   'lon', q.lon,
                   'seen_at', q.seen_at
                 ) order by q.seen_at
               ) as points
        from cos.fleet_positions q
        where q.seen_at >= v_cutoff
          and q.lat is not null
        group by q.icao24
      ) t
    ),
    'coverage', (
      select jsonb_build_object(
        'aircraft_tracked', (
          select count(*) from cos.fleet_aircraft where active
        ),
        'aircraft_seen', (
          select count(distinct icao24)
          from cos.fleet_positions
          where seen_at >= v_cutoff
        ),
        'latest_fix_at', (
          select max(seen_at) from cos.fleet_positions
        ),
        'source', 'OpenSky Network ADS-B',
        'basis', 'measured'
      )
    )
  );
end
$$;

revoke all on function cos.api_chat_state() from public, anon;
revoke all on function cos.api_chat_messages(text) from public, anon;
revoke all on function cos.api_chat_send(text, text, text) from public, anon;
revoke all on function cos.api_chat_archive(text) from public, anon;
revoke all on function cos.api_reports_state() from public, anon;
revoke all on function cos.api_fleet_state(integer) from public, anon;

grant execute on function cos.api_chat_state() to authenticated;
grant execute on function cos.api_chat_messages(text) to authenticated;
grant execute on function cos.api_chat_send(text, text, text) to authenticated;
grant execute on function cos.api_chat_archive(text) to authenticated;
grant execute on function cos.api_reports_state() to authenticated;
grant execute on function cos.api_fleet_state(integer) to authenticated;
