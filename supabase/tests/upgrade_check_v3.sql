-- Runs AFTER the current schema.sql on a database upgraded from v3.
\set ON_ERROR_STOP 1
do $$
begin
  if not exists (select 1 from messages where body = 'הודעה מגרסה 3' and attachment is null and not forwarded) then
    raise exception 'FAIL: v3 message kept';
  end if;
  -- v3 "like" -> 👍 (v4) -> reputation like (v5); shown once, as a like
  if (select count(*) from message_likes) <> 1 or exists (select 1 from reactions where emoji in ('like', '👍')) then
    raise exception 'FAIL: v3 like became a reputation like';
  end if;
end $$;
\echo UPGRADE CHECK PASSED
