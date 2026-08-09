-- Supabase grants service_role access to Vault by default, including
-- vault.decrypted_secrets, which returns PLAINTEXT. Storing the Plaid tokens there
-- without this would hand the agent runner credentials that can read every bank
-- transaction -- a worse leak than the `fin` data we went to some length to keep it
-- away from.
--
-- Revoking USAGE on the schema is the effective lever, exactly as with `fin`: without
-- it no table or function inside can be named, whatever their own grants say. (A
-- blanket function revoke is not possible here; several vault functions are owned by
-- supabase_admin, not postgres.)
--
-- Safe specifically because the Vault is empty and the only database object referencing
-- it is fin.sync_plaid, which is SECURITY DEFINER owned by postgres and therefore reads
-- the secrets as its owner rather than as the caller.
--
-- If a Supabase integration is added later that needs service_role to reach Vault (some
-- wrappers and webhook features do), this is the grant to reinstate -- and the Plaid
-- tokens should be moved elsewhere before doing so.
revoke all on vault.secrets from service_role;
revoke all on vault.decrypted_secrets from service_role;
revoke usage on schema vault from service_role;;
