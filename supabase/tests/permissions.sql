-- Permission tests. Runs against a plain Postgres with a mocked Supabase `auth` schema
-- (see supabase/tests/run.sh). Every check raises an exception on failure.
\set ON_ERROR_STOP 1
\o /dev/null
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x.com', '{"display_name":"מנהלת"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.com',   '{"display_name":"בוב"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.com', '{}');

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;

set client_min_messages = notice;

-- First user is admin/active; others pending; name fallback to email prefix.
select pg_temp.check((select role = 'admin' and status = 'active' from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'first user is active admin');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'second user pending');
select pg_temp.check((select display_name = 'carol' from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'display name falls back to email prefix');

-- Pending user sees nothing and cannot self-approve.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from channels), 'pending user cannot read channels');
select pg_temp.check((select count(*) = 1 from profiles), 'pending user sees only own profile');
update profiles set status = 'active', role = 'admin' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'pending' and role = 'member' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'pending user cannot self-approve/promote');
update profiles set display_name = 'בוב החדש' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select display_name = 'בוב החדש' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'user can rename self');
reset role;

-- Admin approves bob.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'active' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'admin can approve');
reset role;

-- Bob as active member.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 3 from channels), 'member sees channels');
do $$ begin
  insert into channels (name) values ('hack');
  raise exception 'FAIL: member created channel';
exception when insufficient_privilege then raise notice 'ok  member cannot create channel'; end $$;
do $$ begin
  insert into threads (channel_id, author_id, title) select id, auth.uid(), 'x' from channels where admin_only_post;
  raise exception 'FAIL: member posted in announcements';
exception when insufficient_privilege then raise notice 'ok  member cannot open thread in announcements'; end $$;
do $$ begin
  insert into threads (channel_id, author_id, title) select id, '00000000-0000-0000-0000-00000000000a', 'spoof' from channels where not admin_only_post limit 1;
  raise exception 'FAIL: member impersonated';
exception when insufficient_privilege then raise notice 'ok  member cannot post as someone else'; end $$;
insert into threads (channel_id, author_id, title, body)
  select id, auth.uid(), 'שלום לכולם', 'פתיחה' from channels where name = 'כללי';
insert into messages (thread_id, author_id, body) select id, auth.uid(), 'הודעה ראשונה' from threads;
insert into messages (thread_id, author_id, body) select id, auth.uid(), 'שנייה' from threads;
select pg_temp.check((select message_count = 2 from threads), 'message_count bumped by trigger');
delete from threads;
select pg_temp.check((select count(*) = 1 from threads), 'author cannot delete thread that has replies');
update threads set pinned = true, locked = true, message_count = 999;
select pg_temp.check((select not pinned and not locked and message_count = 2 from threads), 'member cannot pin/lock or fake counters');
update messages set body = 'ערוך' where body = 'שנייה';
select pg_temp.check((select edited_at is not null from messages where body = 'ערוך'), 'edit sets edited_at');
insert into reactions (message_id, user_id, emoji) select min(id), auth.uid(), '👍' from messages;
insert into thread_reads (user_id, thread_id) select auth.uid(), id from threads;
reset role;

-- Admin moderates: cannot rewrite others' text, can delete, pin, lock.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update messages set body = 'rewritten' where body = 'ערוך';
select pg_temp.check((select count(*) = 1 from messages where body = 'ערוך'), 'mod cannot rewrite others message');
update messages set deleted = true where body = 'ערוך';
select pg_temp.check((select deleted and body = '' from messages where id = (select max(id) from messages)), 'mod soft delete wipes body');
update threads set locked = true, pinned = true;
select pg_temp.check((select locked and pinned from threads), 'mod can pin/lock');
select pg_temp.check((select count(*) = 0 from thread_reads), 'thread_reads are private');
select pg_temp.check((select count(*) = 1 from reactions), 'reactions visible to others');
do $$ begin
  delete from reactions;
  if (select count(*) from reactions) <> 1 then raise exception 'FAIL: deleted others reaction'; end if;
  raise notice 'ok  cannot delete others reactions';
end $$;
reset role;

-- Bob cannot post to locked thread; undelete is impossible.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  insert into messages (thread_id, author_id, body) select id, auth.uid(), 'x' from threads;
  raise exception 'FAIL: posted in locked thread';
exception when insufficient_privilege then raise notice 'ok  member cannot post in locked thread'; end $$;
update messages set deleted = false, body = 'back' where deleted;
select pg_temp.check((select deleted and body = '' from messages where id = (select max(id) from messages)), 'deleted message stays deleted');
reset role;

-- Banned user loses read access.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'banned' where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from messages), 'banned user cannot read messages');
reset role;

\o
\echo ALL PERMISSION TESTS PASSED
