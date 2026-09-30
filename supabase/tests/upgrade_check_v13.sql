-- Runs AFTER the current schema.sql on a database upgraded from v13.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 13') then raise exception 'FAIL: v13 message kept'; end if;
  if (select muted_until from profiles limit 1) is not null then raise exception 'FAIL: nobody muted by the upgrade'; end if;
  if to_regclass('public.push_queue') is null or to_regclass('public.message_reports') is null then raise exception 'FAIL: new tables'; end if;
end $$;
\echo UPGRADE CHECK PASSED
