-- notification_outbox now carries business notifications (invoice/dunning) alongside
-- execution notifications; work_id is null when a notification is business-scoped.

do $$
declare
  kind_constraint record;
begin
  for kind_constraint in
    select constraint_row.conname
      from pg_constraint as constraint_row
      join pg_attribute as column_row
        on column_row.attrelid = constraint_row.conrelid
       and column_row.attnum = any (constraint_row.conkey)
     where constraint_row.conrelid = 'cos.notification_outbox'::regclass
       and constraint_row.contype = 'c'
       and column_row.attname = 'kind'
  loop
    execute format(
      'alter table cos.notification_outbox drop constraint if exists %I',
      kind_constraint.conname
    );
  end loop;
end
$$;

alter table cos.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('provider_fallback', 'work_failed', 'providers_exhausted', 'invoice_overdue'));

alter table cos.notification_outbox
  alter column work_id drop not null;
