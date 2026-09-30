-- Runs AFTER the current schema.sql on a database upgraded from v8.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 8' and poll_id is null) then raise exception 'FAIL: v8 message kept'; end if;
  if to_regclass('public.poll_votes') is null then raise exception 'FAIL: polls added'; end if;
end $$;
\echo UPGRADE CHECK PASSED
