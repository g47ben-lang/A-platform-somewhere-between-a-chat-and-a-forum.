-- Seeds data on a v7 database; run BEFORE the current schema.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@x.com');
update profiles set role = 'moderator';
insert into messages (channel_id, author_id, body) values ((select id from channels where is_main), '00000000-0000-0000-0000-00000000000a', 'הודעה מגרסה 7');
