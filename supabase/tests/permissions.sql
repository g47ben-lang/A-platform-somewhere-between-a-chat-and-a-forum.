-- Permission tests. Runs against a plain Postgres with a mocked Supabase `auth` schema
-- (see supabase/tests/run.sh). Every check raises an exception on failure.
\set ON_ERROR_STOP 1
\o /dev/null
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x.com', '{"display_name":"מנהלת"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.com',   '{"display_name":"בוב"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@x.com',  '{"display_name":"דייב"}');

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

-- expects `sql` to be rejected (RLS / permission / raised business error)
create or replace function pg_temp.denied(sql text, what text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception
    when insufficient_privilege or raise_exception or check_violation then
      raise notice 'ok  %', what;
      return;
  end;
  raise exception 'FAIL (was allowed): %', what;
end $$;

set client_min_messages = notice;

-- ===== Membership =====
select pg_temp.check((select role = 'admin' and status = 'active' from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'first user is active admin');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'second user pending');
select pg_temp.check((select display_name = 'carol' from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'display name falls back to email prefix');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from channels), 'pending user cannot read spaces');
select pg_temp.check((select count(*) = 1 from profiles), 'pending user sees only own profile');
update profiles set status = 'active', role = 'admin' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'pending' and role = 'member' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'pending user cannot self-approve/promote');
update profiles set display_name = 'בוב החדש', bio = 'שלום' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select display_name = 'בוב החדש' and bio = 'שלום' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'user can edit own profile');
select pg_temp.denied($$select create_thread(2, 'x', 'y')$$, 'pending user cannot post');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');
update profiles set display_name = 'hacked' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'active' and display_name = 'בוב החדש' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'admin approves but cannot rename others');
reset role;

-- ===== Spaces, threads, replies =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 3 from channels), 'member sees spaces');
select pg_temp.denied($$insert into channels (name) values ('hack')$$, 'member cannot create space');
select pg_temp.denied($$select create_thread((select id from channels where admin_only_post), 't', 'b')$$, 'member cannot post in announcements');
select pg_temp.denied($$insert into threads (channel_id, author_id, title) values (2, auth.uid(), 'direct')$$, 'direct thread insert is blocked');
select create_thread((select id from channels where name = 'כללי'), 'שלום לכולם', 'פתיחה');
select pg_temp.denied($$insert into messages (thread_id, author_id, body) values (1, auth.uid(), 'direct')$$, 'direct reply insert is blocked');
select post_message((select id from threads where title = 'שלום לכולם'), 'תגובה ראשונה');
select post_message((select id from threads where title = 'שלום לכולם'), 'שנייה', (select id from messages where body = 'תגובה ראשונה'));
select pg_temp.check((select message_count = 2 from threads where id = (select id from threads where title = 'שלום לכולם')), 'reply counter bumped');
select pg_temp.check((select reply_to = (select id from messages where body = 'תגובה ראשונה') from messages where body = 'שנייה'), 'reply_to kept within thread');
delete from threads where id = (select id from threads where title = 'שלום לכולם');
select pg_temp.check((select count(*) = 1 from threads), 'author cannot delete thread that has replies');
update threads set pinned = true, locked = true, message_count = 999 where id = (select id from threads where title = 'שלום לכולם');
select pg_temp.check((select not pinned and not locked and message_count = 2 from threads where id = (select id from threads where title = 'שלום לכולם')), 'member cannot pin/lock or fake counters');
update messages set body = 'ערוך' where body = 'שנייה';
select pg_temp.check((select edited_at is not null from messages where body = 'ערוך'), 'edit sets edited_at');
reset role;

-- ===== Likes & reputation =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$insert into reactions (message_id, user_id) values ((select id from messages where body = 'תגובה ראשונה'), auth.uid())$$, 'cannot like own reply');
select pg_temp.denied($$insert into thread_likes (thread_id, user_id) values ((select id from threads where title = 'שלום לכולם'), auth.uid())$$, 'cannot like own thread');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into reactions (message_id, user_id) values ((select id from messages where body = 'תגובה ראשונה'), auth.uid());
insert into thread_likes (thread_id, user_id) values ((select id from threads where title = 'שלום לכולם'), auth.uid());
select pg_temp.denied($$insert into reactions (message_id, user_id) values ((select id from messages where body = 'תגובה ראשונה'), '00000000-0000-0000-0000-00000000000d')$$, 'cannot like on behalf of others');
-- bob: 1 thread, 2 replies, 2 likes -> 2*5 + 1*2 + 2 = 14
select pg_temp.check((select reputation = 14 and likes = 2 from member_stats() where id = '00000000-0000-0000-0000-00000000000b'), 'reputation computed');
reset role;

-- ===== Moderation =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update messages set body = 'rewritten' where body = 'ערוך';
select pg_temp.check((select count(*) = 1 from messages where body = 'ערוך'), 'mod cannot rewrite others reply');
update threads set title = 'rewritten' where id = (select id from threads where title = 'שלום לכולם');
select pg_temp.check((select count(*) = 1 from threads where title = 'שלום לכולם'), 'mod cannot rewrite others thread');
update messages set deleted = true where body = 'ערוך';
select pg_temp.check((select deleted and body = '' from messages where id = (select id from messages where body in ('שנייה','ערוך','') and not anonymous)), 'mod soft delete wipes body');
update threads set locked = true, pinned = true where id = (select id from threads where title = 'שלום לכולם');
select pg_temp.check((select locked and pinned from threads where id = (select id from threads where title = 'שלום לכולם')), 'mod can pin/lock');
select pg_temp.check((select count(*) = 0 from thread_reads), 'thread_reads are private');
delete from reactions;
select pg_temp.check((select count(*) = 1 from reactions), 'cannot remove others likes');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$select post_message((select id from threads where title = 'שלום לכולם'), 'x')$$, 'member cannot reply in locked thread');
update messages set deleted = false, body = 'back' where id = (select id from messages where body in ('שנייה','ערוך','') and not anonymous);
select pg_temp.check((select deleted and body = '' from messages where id = (select id from messages where body in ('שנייה','ערוך','') and not anonymous)), 'deleted reply stays deleted');
reset role;

-- ===== Anonymous posts =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select create_thread(2, null, 'שאלה אנונימית', true);
select post_message((select id from threads where body = 'שאלה אנונימית'), 'תגובה אנונימית', null, true);
select pg_temp.check((select author_id is null and anonymous from threads where body = 'שאלה אנונימית'), 'anonymous thread stores no author');
select pg_temp.check((select author_id is null and anonymous from messages where thread_id = (select id from threads where body = 'שאלה אנונימית')), 'anonymous reply stores no author');
select pg_temp.check((select count(*) = 2 from anon_authors), 'author sees own anonymous items');
update messages set body = 'עריכה אנונימית' where thread_id = (select id from threads where body = 'שאלה אנונימית');
select pg_temp.check((select body = 'עריכה אנונימית' from messages where thread_id = (select id from threads where body = 'שאלה אנונימית')), 'anonymous author can edit own reply');
select pg_temp.denied($$insert into reactions (message_id, user_id) select id, auth.uid() from messages where thread_id = (select id from threads where body = 'שאלה אנונימית')$$, 'cannot like own anonymous reply');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from anon_authors), 'others cannot see anonymous authorship');
update messages set body = 'hijack' where thread_id = (select id from threads where body = 'שאלה אנונימית');
select pg_temp.check((select body = 'עריכה אנונימית' from messages where thread_id = (select id from threads where body = 'שאלה אנונימית')), 'others cannot edit anonymous reply');
insert into reactions (message_id, user_id) select id, auth.uid() from messages where thread_id = (select id from threads where body = 'שאלה אנונימית');
select pg_temp.check((select reputation = 0 from member_stats() where id = '00000000-0000-0000-0000-00000000000c'), 'anonymous content earns no reputation (no leak)');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 0 from anon_authors), 'admins cannot see anonymous authorship');
reset role;

-- ===== Walls =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select post_wall('00000000-0000-0000-0000-00000000000b', 'כל הכבוד!', false);
select post_wall('00000000-0000-0000-0000-00000000000b', 'מעריץ סודי', true);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 2 and count(author_id) = 1 from wall_posts), 'wall visible; anonymous post hides author');
delete from wall_posts;
select pg_temp.check((select count(*) = 2 from wall_posts), 'stranger cannot delete wall posts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update profiles set accept_anonymous = false where id = auth.uid();
delete from wall_posts where anonymous;
select pg_temp.check((select count(*) = 1 from wall_posts), 'wall owner can delete posts on their wall');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select post_wall('00000000-0000-0000-0000-00000000000b', 'x', true)$$, 'opt-out blocks anonymous wall posts');
reset role;

-- ===== Direct conversations =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select start_dm('00000000-0000-0000-0000-00000000000b', true)$$, 'opt-out blocks anonymous DMs');
select pg_temp.check((select start_dm('00000000-0000-0000-0000-00000000000d') = start_dm('00000000-0000-0000-0000-00000000000d')), 'regular DM is reused');
select send_dm(1, 'היי דייב');
select pg_temp.check((select start_dm('00000000-0000-0000-0000-00000000000d', true) = start_dm('00000000-0000-0000-0000-00000000000d', true)), 'anonymous DM is reused');
select send_dm(2, 'הודעה סודית');
select pg_temp.check((select sender_id is null from dm_messages where conversation_id = 2), 'anonymous DM stores no sender');
select pg_temp.check((select count(*) = 2 and bool_and(last_from_me) from my_conversations()), 'sender sees both conversations as theirs');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 1 from dm_participants where conversation_id = 2), 'recipient cannot see hidden sender');
select pg_temp.check((select other_id is null and unread = 1 from my_conversations() where id = 2), 'recipient list hides anonymous sender');
select pg_temp.check((select other_id = '00000000-0000-0000-0000-00000000000c' from my_conversations() where id = 1), 'regular DM shows the other side');
select send_dm(2, 'מי אתה?');
select mark_dm_read(2);
select pg_temp.check((select unread = 0 from my_conversations() where id = 2), 'mark read clears unread');
select set_dm_closed(2, true);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select send_dm(2, 'עוד')$$, 'blocked anonymous chat rejects sender');
select pg_temp.denied($$select set_dm_closed(2, false)$$, 'anonymous sender cannot unblock');
update dm_messages set deleted = true where conversation_id = 2 and sender_id is null;
select pg_temp.check((select deleted from dm_messages where conversation_id = 2 and sender_id is null), 'anonymous sender can delete own DM');
update dm_messages set body = 'x' where conversation_id = 2 and sender_id is not null;
select pg_temp.check((select body = 'מי אתה?' from dm_messages where conversation_id = 2 and sender_id is not null), 'cannot edit the other side''s DM');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 0 from dm_messages), 'admins cannot read private conversations');
select pg_temp.denied($$select send_dm(1, 'intrude')$$, 'outsider cannot write into a conversation');
reset role;

-- ===== Bans =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'banned' where id = '00000000-0000-0000-0000-00000000000d';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from messages), 'banned user cannot read replies');
select pg_temp.check((select count(*) = 0 from dm_messages), 'banned user cannot read DMs');
select pg_temp.denied($$select send_dm(1, 'x')$$, 'banned user cannot send DMs');
reset role;

\o
\echo ALL PERMISSION TESTS PASSED
