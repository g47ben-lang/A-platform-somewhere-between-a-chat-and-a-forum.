-- Runs AFTER the current schema.sql on a database upgraded from v7.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 7') then raise exception 'FAIL: v7 message kept'; end if;
  if (select role::text from profiles) <> 'moderator' then raise exception 'FAIL: roles kept'; end if;
  if not exists (select 1 from pg_enum where enumlabel = 'inspector') then raise exception 'FAIL: inspector role added'; end if;
end $$;
\echo UPGRADE CHECK PASSED
