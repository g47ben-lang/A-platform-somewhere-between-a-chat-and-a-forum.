-- Runs AFTER the current schema.sql on a database upgraded from v4.
\set ON_ERROR_STOP 1
do $$
begin
  -- a's 👍 on b's message becomes a like; b's own 👍 does not; emoji reactions stay
  if (select count(*) from message_likes) <> 1
     or not exists (select 1 from message_likes where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: 👍 reactions from others became likes';
  end if;
  if (select count(*) from reactions) <> 3 then raise exception 'FAIL: reactions kept'; end if;
end $$;
\echo UPGRADE CHECK PASSED
