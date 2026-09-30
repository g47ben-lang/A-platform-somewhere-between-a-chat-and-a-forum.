-- Runs AFTER the current schema.sql on a database upgraded from v10.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 10' and not system) then raise exception 'FAIL: v10 message kept'; end if;
  if to_regclass('public.email_queue') is null or to_regclass('public.nicknames') is null then raise exception 'FAIL: new tables'; end if;
end $$;
\echo UPGRADE CHECK PASSED
