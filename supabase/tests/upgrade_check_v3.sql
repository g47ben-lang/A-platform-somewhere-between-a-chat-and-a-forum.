-- Runs AFTER the current schema.sql on a database upgraded from v3.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 3' and attachment is null and not forwarded) then
    raise exception 'FAIL: v3 message kept';
  end if;
  if (select count(*) from reactions where emoji = '👍') <> 1 or exists (select 1 from reactions where emoji = 'like') then
    raise exception 'FAIL: likes became 👍';
  end if;
end $$;
\echo UPGRADE CHECK PASSED
