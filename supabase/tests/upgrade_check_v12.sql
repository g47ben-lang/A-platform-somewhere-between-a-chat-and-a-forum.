-- Runs AFTER the current schema.sql on a database upgraded from v12.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 12') then raise exception 'FAIL: v12 message kept'; end if;
  if to_regclass('public.confessions') is null or to_regclass('public.quote_quizzes') is null then raise exception 'FAIL: new tables'; end if;
end $$;
\echo UPGRADE CHECK PASSED
