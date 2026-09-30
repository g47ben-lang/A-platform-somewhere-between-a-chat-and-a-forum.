-- Runs AFTER the current schema.sql on an upgraded database.
\set ON_ERROR_STOP 1
do $$
begin
  if (select count(*) from channels where is_main) <> 1 then raise exception 'FAIL: main room'; end if;
  if (select name from channels where is_main) <> 'הצ''אט הראשי' then raise exception 'FAIL: main room name'; end if;
  if not exists (select 1 from messages m join channels c on c.id = m.channel_id
                 where c.is_main and m.body = E'נושא ישן\nגוף') then raise exception 'FAIL: thread became message in main room'; end if;
  if not exists (select 1 from messages r join messages s on s.id = r.reply_to
                 where r.body = 'תגובה ישנה' and s.body = E'נושא ישן\nגוף') then raise exception 'FAIL: reply linked to thread message'; end if;
  if not exists (select 1 from messages m join channels c on c.id = m.channel_id
                 where c.name = 'שאלות ועזרה' and m.body = 'שאלה') then raise exception 'FAIL: thread kept its room'; end if;
  if exists (select 1 from messages where channel_id is null) then raise exception 'FAIL: message without room'; end if;
  if (select count(*) from reactions) <> 1 or exists (select 1 from reactions where emoji <> 'like') then raise exception 'FAIL: likes'; end if;
  if (select count(*) from threads where migrated_message_id is null) <> 0 then raise exception 'FAIL: unmigrated threads'; end if;
end $$;
\echo UPGRADE CHECK PASSED
