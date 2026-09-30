-- Runs AFTER the current schema.sql on a database upgraded from v11.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 11' and not gag) then raise exception 'FAIL: v11 message kept'; end if;
  if (select count(*) from channels where purpose = 'blessings') <> 1 then raise exception 'FAIL: blessings room created once'; end if;
  if to_regclass('public.events') is null then raise exception 'FAIL: events added'; end if;
end $$;
\echo UPGRADE CHECK PASSED
