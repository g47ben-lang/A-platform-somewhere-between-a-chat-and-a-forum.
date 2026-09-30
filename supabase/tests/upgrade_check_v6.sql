-- Runs AFTER the current schema.sql on a database upgraded from v6.
\set ON_ERROR_STOP 1
do $$
begin
  if (select terms_accepted_at from profiles) is null then raise exception 'FAIL: rules acceptance kept'; end if;
  if (select join_seen from profiles) is not true or (select joined_via from profiles) is not null then raise exception 'FAIL: existing members need no review'; end if;
  if not exists (select 1 from preapproved_emails where email = 'p@x.com') then raise exception 'FAIL: pre-approved list kept'; end if;
  if name_tokens('הופמן משה-אהרון') <> name_tokens('אהרן  משה הופמן') then raise exception 'FAIL: name_tokens'; end if;
end $$;
\echo UPGRADE CHECK PASSED
