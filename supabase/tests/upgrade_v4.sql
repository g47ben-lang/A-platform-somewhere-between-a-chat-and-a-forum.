-- Seeds data on a v4 database; run BEFORE the current schema.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@x.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@x.com');
update profiles set status = 'active';
insert into messages (channel_id, author_id, body)
  values ((select id from channels where is_main), '00000000-0000-0000-0000-00000000000b', 'הודעה מגרסה 4');
insert into reactions (message_id, user_id, emoji) select id, '00000000-0000-0000-0000-00000000000a', '👍' from messages;
insert into reactions (message_id, user_id, emoji) select id, '00000000-0000-0000-0000-00000000000b', '👍' from messages;
insert into reactions (message_id, user_id, emoji) select id, '00000000-0000-0000-0000-00000000000a', '😂' from messages;
