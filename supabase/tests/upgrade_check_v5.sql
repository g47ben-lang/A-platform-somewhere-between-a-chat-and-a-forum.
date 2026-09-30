-- Runs AFTER the current schema.sql on a database upgraded from v5.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 5') then raise exception 'FAIL: v5 message kept'; end if;
  if (select terms_accepted_at from profiles) is not null then raise exception 'FAIL: existing members must accept the rules on next visit'; end if;
end $$;
\echo UPGRADE CHECK PASSED
