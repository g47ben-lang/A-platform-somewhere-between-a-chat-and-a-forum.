-- Seeds data on an old schema version; run BEFORE the current schema.sql.
-- :ver is 1 or 2 (psql variable).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@x.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@x.com');
update profiles set status = 'active';
insert into threads (channel_id, author_id, title, body) values
  ((select id from channels where name = 'כללי'), '00000000-0000-0000-0000-00000000000a', 'נושא ישן', 'גוף'),
  ((select id from channels where name = 'שאלות ועזרה'), '00000000-0000-0000-0000-00000000000b', 'שאלה', null);
insert into messages (thread_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000b', 'תגובה ישנה' from threads where title = 'נושא ישן';
insert into reactions (message_id, user_id, emoji)
  select id, '00000000-0000-0000-0000-00000000000a', case when :ver = 1 then '😂' else 'like' end from messages;
