-- Align the durable read model with SCKG's complete provenance vocabulary and
-- make the documented PostgREST service-key publisher a real fallback.

alter table cos.omnisupply_answers
  drop constraint if exists omnisupply_answers_basis_known;
alter table cos.omnisupply_answers
  add constraint omnisupply_answers_basis_known
  check (
    basis in (
      'measured',
      'derived',
      'estimate',
      'illustrative',
      'unvetted'
    )
  );

-- Only these two snapshot tables are writable by the trusted service role.
-- Browser roles retain RPC-only access; no anonymous or authenticated table
-- grants are introduced.
grant usage on schema cos to service_role;
grant select, insert, update, delete
  on table cos.omnisupply_snapshots, cos.omnisupply_answers
  to service_role;
