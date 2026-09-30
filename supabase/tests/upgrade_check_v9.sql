-- Runs AFTER the current schema.sql on a database upgraded from v9.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 9') then raise exception 'FAIL: v9 message kept'; end if;
  if to_regclass('public.feedback') is null then raise exception 'FAIL: feedback added'; end if;
end $$;
\echo UPGRADE CHECK PASSED
