-- Cover the foreign keys introduced by the failure-recovery protocol. These
-- indexes keep approval and notification cleanup/lookups bounded as history grows.
create index if not exists job_queue_recovery_approval_idx
  on cos.job_queue(recovery_approval_id)
  where recovery_approval_id is not null;
create index if not exists notification_outbox_work_idx
  on cos.notification_outbox(work_id);
create index if not exists notification_outbox_job_idx
  on cos.notification_outbox(job_id)
  where job_id is not null;
